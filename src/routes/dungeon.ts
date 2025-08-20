import { Router } from 'express';
import { dungeonService, playerService, enemyService } from '../services';
import { changePlayerFloor, getTotalPlayerCount, getPlayerCountsByFloor } from '../services/websocket';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// Apply authentication middleware to all dungeon routes
router.use(authenticateToken);

// Add logging for all dungeon routes
router.use((req, res, next) => {
  console.log(`[DungeonRoutes] ${req.method} ${req.path}`);
  next();
});

/**
 * Get the player's current status (floor, position, health, etc.)
 * GET /api/dungeon/current-status
 */
router.get('/current-status', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    console.log(`Current status request for user: ${userId}`);

    if (!userId) {
      console.log('No userId found in request');
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    // Get player from database
    console.log(`Looking up player for userId: ${userId}`);
    const player = await playerService.getPlayer(userId);

    if (!player) {
      console.log(`Player not found for userId: ${userId}`);
      res.status(404).json({
        success: false,
        error: 'Player not found'
      });
      return;
    }

    const currentFloor = player.currentDungeonDagNodeName || 'A'; // Default to root floor
    console.log(`Found player ${player.username} on floor: ${currentFloor}`);

    res.json({
      success: true,
      data: {
        currentFloor: currentFloor,
        playerId: player.id,
        playerName: player.username,
        position: player.position,
        rotation: player.rotation,
        health: player.health,
        character: player.character,
        isAlive: player.isAlive
      }
    });
    console.log(`Successfully returned current status data for ${player.username}`);
  } catch (error) {
    console.error('Error in get-current-status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Player moved to a new floor - check if we need to generate more floors
 * POST /api/dungeon/player-moved-floor
 */
router.post('/player-moved-floor', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { newFloorName } = req.body;
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

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
    
    // Trigger procedural generation if needed
    await dungeonService.checkAndGenerateFloors(newFloorName, playerLevels);

    // Check for enemies on the new floor and spawn them if needed (non-blocking)
    setImmediate(async () => {
      try {
        const hasEnemies = await enemyService.hasEnemiesOnFloor(newFloorName);
        
        if (!hasEnemies) {
          console.log(`No enemies found on floor ${newFloorName}, spawning new enemies...`);
          
          // Get floor tile data for enemy positioning
          const tileData = await dungeonService.getGeneratedFloorTileData(newFloorName);
          
          if (tileData && tileData.tiles.floorTiles.length > 0) {
            // Extract just the position data for enemy spawning
            const floorTilePositions = tileData.tiles.floorTiles.map(tile => ({
              x: tile.x,
              y: tile.y
            }));
            
            // Spawn 5 enemies on random floor tiles - each enemy gets its own independent thread
            await enemyService.spawnEnemiesOnFloor(newFloorName, floorTilePositions);
            console.log(`Successfully spawned 5 independent enemy threads on floor ${newFloorName}`);
          } else {
            console.warn(`No floor tiles found for floor ${newFloorName}, cannot spawn enemies`);
          }
        } else {
          console.log(`Enemies already exist on floor ${newFloorName}, skipping spawn`);
        }
      } catch (error) {
        console.error(`Error spawning enemies on floor ${newFloorName}:`, error);
      }
    });

    // Change player's floor (handles WebSocket room management and notifications)
    const result = await changePlayerFloor(userId, newFloorName);

    if (result.success) {
      res.json({
        success: true,
        message: 'Floor generation checked and updated if needed. Player floor changed.',
        floor: newFloorName
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.message
      });
    }
  } catch (error) {
    console.error('Error in player-moved-floor:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get dungeon layout for a specific floor
 * GET /api/dungeon/floor/:floorName
 */

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

/**
 * Get complete tile coordinates for rendering (floors, walls, stairs, ceiling)
 * This is the most comprehensive endpoint providing all tile coordinates for client rendering
 * GET /api/dungeon/generated-floor-tiles/:dungeonDagNodeName
 */
router.get('/generated-floor-tiles/:dungeonDagNodeName', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const { dungeonDagNodeName } = req.params;

    if (!dungeonDagNodeName) {
      res.status(400).json({
        success: false,
        error: 'dungeonDagNodeName is required'
      });
      return;
    }

    const tileData = await dungeonService.getGeneratedFloorTileData(dungeonDagNodeName);

    if (!tileData) {
      res.status(404).json({
        success: false,
        error: 'Floor not found or could not generate tile data'
      });
      return;
    }

    res.json({
      success: true,
      data: tileData
    });
  } catch (error) {
    console.error('Error in get-generated-floor-tiles:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get total player count across all floors
 * GET /api/dungeon/player-count
 */
router.get('/player-count', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const totalPlayers = getTotalPlayerCount();
    const playersByFloor = getPlayerCountsByFloor();

    res.json({
      success: true,
      data: {
        totalPlayers,
        playersByFloor
      }
    });
  } catch (error) {
    console.error('Error in get-player-count:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
