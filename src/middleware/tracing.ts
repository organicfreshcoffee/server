import { Request, Response, NextFunction } from 'express';
import { createSpan, addSpanAttributes, addPayloadInfo } from '../config/tracing';

/**
 * Express middleware to automatically trace HTTP requests
 */
export function tracingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const operationName = `http.${req.method.toLowerCase()}.${req.route?.path || req.path || 'unknown'}`;
    
    // Create a span for this HTTP request
    createSpan(operationName, async () => {
      return new Promise<void>((resolve, reject) => {
        // Add request attributes
        addSpanAttributes({
          'http.method': req.method,
          'http.url': req.originalUrl || req.url,
          'http.route': req.route?.path || req.path,
          'http.user_agent': req.get('User-Agent') || '',
          'http.content_length': parseInt(req.get('Content-Length') || '0'),
          'http.host': req.get('Host') || '',
          'http.scheme': req.protocol,
        });

        // Add request payload information
        if (req.body && Object.keys(req.body).length > 0) {
          addPayloadInfo(req.body, 'inbound');
        }

        // Capture original response methods
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        
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

        // Listen for response finish event
        res.on('finish', () => {
          const duration = Date.now() - startTime;
          
          // Add response attributes
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.response.size': res.get('Content-Length') || '0',
            'http.duration_ms': duration,
            'http.success': res.statusCode < 400,
          });

          resolve();
        });

        res.on('error', (error) => {
          const duration = Date.now() - startTime;
          
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.duration_ms': duration,
            'http.success': false,
            'error.message': error.message,
          });

          reject(error);
        });

        next();
      });
    }).catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Tracing middleware error:', error);
      next();
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
