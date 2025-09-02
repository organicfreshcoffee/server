import { Request, Response, NextFunction } from 'express';
import { createSpan, addSpanAttributes, addPayloadInfo } from '../config/tracing';

/**
 * Express middleware to automatically trace HTTP requests
 */
export function tracingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Create a more descriptive operation name
    const routePath = req.route?.path || req.path || 'unknown';
    const operationName = `${req.method} ${routePath}`;
    
    // Create a span for this HTTP request
    const span = createSpan(operationName, async () => {
      return new Promise<void>((resolve, reject) => {
        // Add initial request attributes
        addSpanAttributes({
          'http.method': req.method,
          'http.url': req.originalUrl || req.url,
          'http.route': routePath,
          'http.user_agent': req.get('User-Agent') || '',
          'http.content_length': parseInt(req.get('Content-Length') || '0'),
          'http.host': req.get('Host') || '',
          'http.scheme': req.protocol,
          'http.request_id': req.get('X-Request-ID') || `${Date.now()}-${Math.random()}`,
        });

        // Add request payload information
        if (req.body && Object.keys(req.body).length > 0) {
          addPayloadInfo(req.body, 'inbound');
        }

        // Add query parameters if present
        if (req.query && Object.keys(req.query).length > 0) {
          addSpanAttributes({
            'http.query_params': JSON.stringify(req.query),
          });
        }

        // Add route parameters if present
        if (req.params && Object.keys(req.params).length > 0) {
          addSpanAttributes({
            'http.route_params': JSON.stringify(req.params),
          });
        }

        // Capture original response methods
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        const originalEnd = res.end.bind(res);
        
        // Override res.json to capture response payload
        res.json = function(body: unknown): Response {
          if (body) {
            addPayloadInfo(body, 'outbound');
          }
          return originalJson(body);
        };

        // Override res.send to capture response payload
        res.send = function(body: unknown): Response {
          if (body && typeof body === 'object') {
            addPayloadInfo(body, 'outbound');
          }
          return originalSend(body);
        };

        // Override res.end to ensure we capture the response
        res.end = function(chunk?: unknown, encoding?: unknown): Response {
          if (chunk && typeof chunk === 'object') {
            addPayloadInfo(chunk, 'outbound');
          }
          return originalEnd(chunk as any, encoding as any);
        };

        // Listen for response finish event
        res.on('finish', () => {
          const duration = Date.now() - startTime;
          
          // Add response attributes
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.status_class': `${Math.floor(res.statusCode / 100)}xx`,
            'http.response.size': res.get('Content-Length') || '0',
            'http.duration_ms': duration,
            'http.success': res.statusCode < 400,
          });

          // Add error information for failed requests
          if (res.statusCode >= 400) {
            addSpanAttributes({
              'error.status_code': res.statusCode,
              'error.type': res.statusCode >= 500 ? 'server_error' : 'client_error',
            });
          }

          resolve();
        });

        res.on('error', (error) => {
          const duration = Date.now() - startTime;
          
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.duration_ms': duration,
            'http.success': false,
            'error.message': error.message,
            'error.name': error.name,
            'error.type': 'response_error',
          });

          reject(error);
        });

        // Also listen for close event in case response is closed without finish
        res.on('close', () => {
          if (!res.writableFinished) {
            const duration = Date.now() - startTime;
            addSpanAttributes({
              'http.status_code': res.statusCode || 0,
              'http.duration_ms': duration,
              'http.success': false,
              'error.type': 'connection_closed',
            });
            resolve();
          }
        });

        next();
      });
    });

    // Handle any span creation errors
    span.catch((error) => {
      console.error('Tracing middleware error:', error);
    });
  };
}

/**
 * Middleware to add user context to traces when available
 */
export function userTracingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // If user information is available (set by auth middleware)
    if (req.user) {
      addSpanAttributes({
        'user.id': req.user.uid,
        'user.email': req.user.email || '',
        'user.name': req.user.name || '',
        'auth.authenticated': true,
      });
    } else {
      addSpanAttributes({
        'auth.authenticated': false,
      });
    }
    
    // Add session information if available
    if (req.headers.authorization) {
      addSpanAttributes({
        'auth.type': req.headers.authorization.startsWith('Bearer ') ? 'bearer_token' : 'other',
      });
    }
    
    next();
  };
}

// Extend Express Request type to include user
declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      uid: string;
      email?: string;
      name?: string;
    };
  }
}
