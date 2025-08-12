import { Router } from 'express';
import { DungeonService } from '../services/dungeonService';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();
const dungeonService = new DungeonService();

// Apply authentication middleware to all dungeon routes
router.use(authenticateToken);

/**
 * Player moved to a new floor - check if we need to generate more floors
 * POST /api/dungeon/player-moved-floor
 */
router.post('/player-moved-floor', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { newFloorName } = req.body;

    if (!newFloorName || typeof newFloorName !== 'string') {
      res.status(400).json({
        success: false,
        error: 'newFloorName is required and must be a string'
      });
      return;
    }

    // In a real implementation, you'd get all player levels from the database
    // For now, we'll assume this single player's floor
    const playerLevels = [newFloorName];

    await dungeonService.checkAndGenerateFloors(newFloorName, playerLevels);

    res.json({
      success: true,
      message: 'Floor generation checked and updated if needed'
    });
  } catch (error) {
    console.error('Error in player-moved-floor:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get floor layout for rendering
 * GET /api/dungeon/floor/:dungeonDagNodeName
 */
router.get('/floor/:dungeonDagNodeName', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { dungeonDagNodeName } = req.params;

    if (!dungeonDagNodeName) {
      res.status(400).json({
        success: false,
        error: 'dungeonDagNodeName is required'
      });
      return;
    }

    const floorLayout = await dungeonService.getFloor(dungeonDagNodeName);

    if (!floorLayout) {
      res.status(404).json({
        success: false,
        error: 'Floor not found'
      });
      return;
    }

    res.json({
      success: true,
      data: floorLayout
    });
  } catch (error) {
    console.error('Error in get-floor:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get stairs information for a room
 * GET /api/dungeon/room-stairs/:floorDagNodeName
 */
router.get('/room-stairs/:floorDagNodeName', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { floorDagNodeName } = req.params;

    if (!floorDagNodeName) {
      res.status(400).json({
        success: false,
        error: 'floorDagNodeName is required'
      });
      return;
    }

    const roomStairs = await dungeonService.getRoomStairs(floorDagNodeName);

    if (!roomStairs) {
      res.status(404).json({
        success: false,
        error: 'Room not found or is not a room node'
      });
      return;
    }

    res.json({
      success: true,
      data: roomStairs
    });
  } catch (error) {
    console.error('Error in get-room-stairs:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get spawn location (root dungeon node name)
 * GET /api/dungeon/spawn
 */
router.get('/spawn', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const spawnNodeName = await dungeonService.getSpawn();

    if (!spawnNodeName) {
      res.status(404).json({
        success: false,
        error: 'Spawn location not found. Dungeon may not be initialized.'
      });
      return;
    }

    res.json({
      success: true,
      data: {
        dungeonDagNodeName: spawnNodeName
      }
    });
  } catch (error) {
    console.error('Error in get-spawn:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
