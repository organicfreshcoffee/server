import * as trace from '@google-cloud/trace-agent';
import { trace as otelTrace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

// Initialize Google Cloud Trace
export function initializeTracing() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  
  // Only initialize GCP tracing if project ID is provided
  if (projectId) {
    try {
      // Start the trace agent - this should be done as early as possible
      trace.start({
        projectId: projectId,
        // Set sampling rate (1.0 = trace all requests, 0.1 = trace 10%)
        samplingRate: parseFloat(process.env.TRACE_SAMPLING_RATE || '1.0'),
        // Buffer traces in memory before sending
        bufferSize: 1000,
        // Send traces every 30 seconds
        flushDelaySeconds: 30,
        // Enable enhanced database reporting
        enhancedDatabaseReporting: true,
      });

      console.log(`Google Cloud Trace initialized for project: ${projectId}`);
    } catch (error) {
      console.warn('Failed to initialize Google Cloud Trace:', error);
      console.log('Continuing without GCP tracing - local development mode');
    }
  } else {
    console.log('GOOGLE_CLOUD_PROJECT_ID not set - running in local development mode without GCP tracing');
  }
}

// Helper function to create custom spans
export function createSpan(name: string, fn: () => Promise<any>, attributes?: Record<string, string | number | boolean>) {
  // Check if tracing is enabled (GCP project ID is set)
  const isTracingEnabled = !!process.env.GOOGLE_CLOUD_PROJECT_ID;
  
  if (!isTracingEnabled) {
    // If tracing is disabled, just execute the function without span
    return fn();
  }

  const tracer = otelTrace.getTracer('game-server');
  
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL }, async (span) => {
    try {
      // Add custom attributes
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttributes({ [key]: value });
        });
      }

      const result = await fn();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      });
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Helper function to add attributes to current span
export function addSpanAttributes(attributes: Record<string, string | number | boolean>) {
  // Only add attributes if tracing is enabled
  if (!process.env.GOOGLE_CLOUD_PROJECT_ID) return;
  
  const currentSpan = otelTrace.getActiveSpan();
  if (currentSpan) {
    currentSpan.setAttributes(attributes);
  }
}

// Helper function to add events to current span
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>) {
  // Only add events if tracing is enabled
  if (!process.env.GOOGLE_CLOUD_PROJECT_ID) return;
  
  const currentSpan = otelTrace.getActiveSpan();
  if (currentSpan) {
    currentSpan.addEvent(name, attributes);
  }
}

// Wrapper for database operations
export async function traceDbOperation<T>(
  operation: string,
  collection: string,
  fn: () => Promise<T>
): Promise<T> {
  return createSpan(`db.${operation}`, fn, {
    'db.operation': operation,
    'db.collection': collection,
    'db.system': 'mongodb',
  });
}

// Wrapper for HTTP requests (like auth service calls)
export async function traceHttpRequest<T>(
  method: string,
  url: string,
  fn: () => Promise<T>
): Promise<T> {
  return createSpan(`http.${method.toLowerCase()}`, fn, {
    'http.method': method,
    'http.url': url,
    'http.scheme': 'https',
  });
}

// Wrapper for game logic operations
export async function traceGameOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  gameAttributes?: Record<string, string | number | boolean>
): Promise<T> {
  return createSpan(`game.${operation}`, fn, {
    'service.name': 'game-server',
    'service.operation': operation,
    ...gameAttributes,
  });
}
