import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Test authentication endpoint
router.get('/verify', authenticateToken, (req, res) => {
  res.json({
    success: true,
    user: (req as any).user,
    message: 'Token is valid',
  });
});

// User profile endpoint
router.get('/profile', authenticateToken, (req, res) => {
  const user = (req as any).user;
  res.json({
    uid: user.uid,
    email: user.email,
    name: user.name,
  });
});

export default router;
