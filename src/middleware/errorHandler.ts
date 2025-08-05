import { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  status?: string;
  isOperational?: boolean;
}

export function errorHandler(
  error: AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Don't log handled errors in test environment
  if (process.env.NODE_ENV !== 'test') {
    console.error('Error:', error);
  }

  const statusCode = error.statusCode || 500;
  const status = error.status || 'error';
  const message = error.message || 'Internal server error';

  res.status(statusCode).json({
    status,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
  });
}
