import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/authService';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
  };
}

export async function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    console.log('[AuthMiddleware] Processing request to:', req.method, req.url);
    
    const authHeader = req.headers.authorization;
    console.log('[AuthMiddleware] Auth header present:', !!authHeader);
    console.log('[AuthMiddleware] Auth header (first 30 chars):', authHeader?.substring(0, 30) + '...');
    
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    console.log('[AuthMiddleware] Token extracted:', !!token);
    console.log('[AuthMiddleware] Token (first 20 chars):', token?.substring(0, 20) + '...');

    if (!token) {
      console.log('[AuthMiddleware] No token provided, returning 401');
      res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
      return;
    }

    console.log('[AuthMiddleware] Calling AuthService.verifyToken...');
    const authService = new AuthService();
    const user = await authService.verifyToken(token);
    
    console.log('[AuthMiddleware] AuthService.verifyToken result:', !!user ? 'SUCCESS' : 'FAILED');
    
    if (!user) {
      console.log('[AuthMiddleware] Token verification failed, returning 403');
      res.status(403).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }

    console.log('[AuthMiddleware] Authentication successful for user:', user.uid);
    req.user = user;
    next();
  } catch (error) {
    console.error('[AuthMiddleware] Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
    return;
  }
}
