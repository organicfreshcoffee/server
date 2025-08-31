import { Router, Request, Response } from 'express';
import { PlayerService } from '../services/playerService';
import { AuthService } from '../services/authService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { Player } from '../types/game';
import { getDatabase } from '../config/database';

const router = Router();
const playerService = new PlayerService();
const authService = new AuthService();

// Add logging for all user routes
router.use((req, res, next) => {
  console.log(`[UserRoutes] ${req.method} ${req.path}`);
  next();
});

/**
 * Delete user data (Right to be Forgotten - GDPR compliance)
 * DELETE /api/user/delete-data
 * 
 * Supports two authentication methods:
 * 1. Bearer token (authenticated request)
 * 2. Email in request body (unauthenticated request)
 */
router.delete('/delete-data', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let userId: string | null = null;
    let userEmail: string | null = null;

    // Check if request is authenticated with bearer token
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = await authService.verifyToken(token);
        if (decoded) {
          userId = decoded.uid;
          console.log(`Authenticated delete request for userId: ${userId}`);
        }
      } catch (error) {
        console.log('Token verification failed, checking for email in body');
      }
    }

    // If not authenticated, check for email in request body
    if (!userId) {
      const { email } = req.body;
      
      if (!email || typeof email !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Either valid bearer token or email is required'
        });
        return;
      }

      userEmail = email;
      console.log(`Unauthenticated delete request for email: ${userEmail}`);
    }

    // Find and delete player data
    let playerToDelete: Player | null = null;
    
    if (userId) {
      playerToDelete = await playerService.getPlayer(userId);
    } else if (userEmail) {
      playerToDelete = await playerService.getPlayerByEmail(userEmail);
    }

    if (!playerToDelete) {
      res.status(404).json({
        success: false,
        error: 'No player data found for the provided credentials'
      });
      return;
    }

    // Delete the player data
    await playerService.deletePlayer(playerToDelete.userId);

    // Delete items owned by the player
    const db = getDatabase();
    const itemsDeleteResult = await db.collection('itemInstances').deleteMany({ 
      owner: playerToDelete.userId 
    });

    console.log(`Successfully deleted player data for ${playerToDelete.username} (userId: ${playerToDelete.userId})`);
    console.log(`Deleted ${itemsDeleteResult.deletedCount} items owned by the player`);

    res.json({
      success: true,
      message: 'Player data has been successfully deleted',
      data: {
        deletedPlayer: {
          username: playerToDelete.username,
          email: playerToDelete.email,
          deletedAt: new Date().toISOString()
        },
        deletedItems: itemsDeleteResult.deletedCount
      }
    });

  } catch (error) {
    console.error('Error in delete-data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while deleting user data'
    });
  }
});

/**
 * Get user data (for data portability - GDPR compliance)
 * GET /api/user/export-data
 * 
 * Requires authentication via bearer token
 */
router.get('/export-data', authenticateToken, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    const player = await playerService.getPlayer(userId);

    if (!player) {
      res.status(404).json({
        success: false,
        error: 'No player data found'
      });
      return;
    }

    // Get items owned by the player
    const db = getDatabase();
    const playerItems = await db.collection('itemInstances')
      .find({ owner: userId })
      .toArray();

    // Convert MongoDB ObjectIds to strings for JSON serialization
    const serializedItems = playerItems.map(item => ({
      ...item,
      _id: item._id.toString()
    }));

    // Return all player data for export
    res.json({
      success: true,
      message: 'User data export',
      data: {
        exportedAt: new Date().toISOString(),
        userData: {
          id: player.id,
          userId: player.userId,
          username: player.username,
          email: player.email,
          position: player.position,
          rotation: player.rotation,
          character: player.character,
          health: player.health,
          maxHealth: player.maxHealth,
          level: player.level,
          experience: player.experience,
          lastUpdate: player.lastUpdate,
          isOnline: player.isOnline,
          isAlive: player.isAlive,
          currentDungeonDagNodeName: player.currentDungeonDagNodeName
        },
        items: serializedItems,
        itemCount: serializedItems.length
      }
    });

    console.log(`Data export completed for user: ${userId} (${serializedItems.length} items included)`);

  } catch (error) {
    console.error('Error in export-data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while exporting user data'
    });
  }
});

export default router;
