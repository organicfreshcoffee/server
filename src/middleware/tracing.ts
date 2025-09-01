import { Request, Response, NextFunction } from 'express';
import { createSpan, addSpanAttributes } from '../config/tracing';

/**
 * Express middleware to automatically trace HTTP requests
 */
export function tracingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    
    // Create a span for this HTTP request
    createSpan(`http.request.${req.method.toLowerCase()}`, async () => {
      return new Promise<void>((resolve) => {
        // Add request attributes
        addSpanAttributes({
          'http.method': req.method,
          'http.url': req.originalUrl || req.url,
          'http.route': req.route?.path || req.path,
          'http.user_agent': req.get('User-Agent') || '',
          'http.request.size': parseInt(req.get('Content-Length') || '0'),
        });

        // Override res.end to capture response data
        const originalEnd = res.end.bind(res);
        res.end = function(this: Response, chunk?: any, encoding?: any, cb?: any): Response {
          const duration = Date.now() - startTime;
          
          // Add response attributes
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.response.size': res.get('Content-Length') || '0',
            'http.duration_ms': duration,
          });

          // Call original end method and return the result
          const result = originalEnd(chunk, encoding, cb);
          resolve();
          return result;
        } as any;

        next();
      });
    }).catch((error) => {
      console.error('Tracing middleware error:', error);
      next();
    });
  };
}

/**
 * Middleware to add user context to traces when available
 */
export function userTracingMiddleware() {
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
declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        name?: string;
      };
    }
  }
}
