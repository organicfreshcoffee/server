import { Request, Response, NextFunction } from 'express';
import { createSpan, addSpanAttributes } from '../config/tracing';

/**
 * Express middleware to automatically trace HTTP requests
 */
export function tracingMiddleware(): (req: Request, res: Response, next: NextFunction) => void {
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

        // Listen for response finish event instead of overriding methods
        res.on('finish', () => {
          const duration = Date.now() - startTime;
          
          // Add response attributes
          addSpanAttributes({
            'http.status_code': res.statusCode,
            'http.response.size': res.get('Content-Length') || '0',
            'http.duration_ms': duration,
          });

          resolve();
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
