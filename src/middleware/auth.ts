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
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({ 
        success: false, 
        error: 'Access token required' 
      });
      return;
    }

    const authService = new AuthService();
    const user = await authService.verifyToken(token);
    
    if (!user) {
      res.status(403).json({
        success: false,
        error: 'Invalid or expired token',
      });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
}
