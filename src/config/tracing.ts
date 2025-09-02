import * as trace from '@google-cloud/trace-agent';
import { trace as otelTrace, SpanStatusCode, SpanKind } from '@opentelemetry/api';

// Initialize Google Cloud Trace
export function initializeTracing(): void {
  // Check for GCP project ID in different environments
  const projectId = process.env.GCP_PROJECT_ID || process.env.GCP_PROJECT_ID_STAGING;
  
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
        // Maximum number of stack frames to capture
        maximumLabelValueSize: 16384,
        // Service context
        serviceContext: {
          service: 'organic-fresh-coffee-game-server',
          version: process.env.npm_package_version || '1.0.0',
        },
      });

      // eslint-disable-next-line no-console
      console.log(`Google Cloud Trace initialized for project: ${projectId}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('Failed to initialize Google Cloud Trace:', error);
      // eslint-disable-next-line no-console
      console.log('Continuing without GCP tracing - local development mode');
    }
  } else {
    // eslint-disable-next-line no-console
    console.log('GCP_PROJECT_ID or GCP_PROJECT_ID_STAGING not set - running in local development mode without GCP tracing');
  }
}

// Helper function to create custom spans
export function createSpan<T>(name: string, fn: () => Promise<T>, attributes?: Record<string, string | number | boolean>): Promise<T> {
  // Check if tracing is enabled (GCP project ID is set)
  const isTracingEnabled = !!(process.env.GCP_PROJECT_ID || process.env.GCP_PROJECT_ID_STAGING);
  
  if (!isTracingEnabled) {
    // If tracing is disabled, just execute the function without span
    return fn();
  }

  const tracer = otelTrace.getTracer('game-server', '1.0.0');
  
  return tracer.startActiveSpan(name, { 
    kind: SpanKind.INTERNAL,
    attributes: {
      'service.name': 'organic-fresh-coffee-game-server',
      'service.version': process.env.npm_package_version || '1.0.0',
      ...attributes,
    }
  }, async (span) => {
    const startTime = Date.now();
    
    try {
      // Add custom attributes
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttributes({ [key]: value });
        });
      }

      const result = await fn();
      
      // Mark span as successful
      span.setStatus({ 
        code: SpanStatusCode.OK,
        message: 'Operation completed successfully'
      });
      
      const duration = Date.now() - startTime;
      span.setAttributes({
        'operation.duration_ms': duration,
        'operation.success': true,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      // Mark span as failed
      span.setStatus({ 
        code: SpanStatusCode.ERROR, 
        message: errorMessage
      });
      
      span.setAttributes({
        'operation.duration_ms': duration,
        'operation.success': false,
        'error.name': error instanceof Error ? error.name : 'UnknownError',
        'error.message': errorMessage,
      });
      
      span.recordException(error as Error);
      throw error;
    } finally {
      span.end();
    }
  });
}

// Helper function to add attributes to current span
export function addSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  // Only add attributes if tracing is enabled
  if (!(process.env.GCP_PROJECT_ID || process.env.GCP_PROJECT_ID_STAGING)) return;
  
  const currentSpan = otelTrace.getActiveSpan();
  if (currentSpan) {
    currentSpan.setAttributes(attributes);
  }
}

// Helper function to add events to current span
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  // Only add events if tracing is enabled
  if (!(process.env.GCP_PROJECT_ID || process.env.GCP_PROJECT_ID_STAGING)) return;
  
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

// Wrapper for WebSocket operations
export async function traceWebSocketOperation<T>(
  operation: string,
  fn: () => Promise<T>,
  wsAttributes?: Record<string, string | number | boolean>
): Promise<T> {
  return createSpan(`websocket.${operation}`, fn, {
    'websocket.operation': operation,
    'protocol': 'websocket',
    ...wsAttributes,
  });
}

// Helper to trace WebSocket message handling
export function traceWebSocketMessage<T>(
  messageType: string,
  payload: unknown,
  fn: () => Promise<T>,
  clientId?: string,
  userId?: string
): Promise<T> {
  const payloadSize = JSON.stringify(payload).length;
  
  return traceWebSocketOperation(`message.${messageType}`, fn, {
    'websocket.message.type': messageType,
    'websocket.message.size_bytes': payloadSize,
    'websocket.client.id': clientId || 'unknown',
    'user.id': userId || 'unknown',
  });
}

// Helper to add payload information to current span
export function addPayloadInfo(payload: unknown, direction: 'inbound' | 'outbound'): void {
  if (!(process.env.GCP_PROJECT_ID || process.env.GCP_PROJECT_ID_STAGING)) return;
  
  const currentSpan = otelTrace.getActiveSpan();
  if (currentSpan && payload) {
    const payloadStr = JSON.stringify(payload);
    const payloadSize = payloadStr.length;
    
    currentSpan.setAttributes({
      [`payload.${direction}.size_bytes`]: payloadSize,
      [`payload.${direction}.type`]: typeof payload,
    });
    
    // Add payload content for small payloads (under 1KB)
    if (payloadSize < 1024) {
      currentSpan.setAttributes({
        [`payload.${direction}.content`]: payloadStr,
      });
    }
  }
}
