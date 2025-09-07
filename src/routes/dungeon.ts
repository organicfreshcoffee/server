import { Router } from 'express';
import { dungeonService, playerService, enemyService, itemService } from '../services';
import { changePlayerFloor, getTotalPlayerCount, getPlayerCountsByFloor } from '../services/websocket';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { traceRouteHandler } from '../config/tracing';

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
    await traceRouteHandler('get-current-status', async () => {
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

      const responseData = {
        currentFloor: currentFloor,
        playerId: player.id,
        playerName: player.username,
        position: player.position,
        rotation: player.rotation,
        health: player.health,
        character: player.character,
        isAlive: player.isAlive
      };

      res.json({
        success: true,
        data: responseData
      });
      console.log(`Successfully returned current status data for ${player.username}`);
    }, req);
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
    
    // Trigger procedural generation if needed
    await dungeonService.checkAndGenerateFloors(newFloorName);

    // Mark the dungeon node as visited by this user
    await dungeonService.markDungeonNodeVisited(newFloorName, userId);
    console.log(`Marked dungeon node ${newFloorName} as visited by user ${userId}`);

    const tileData = await dungeonService.getGeneratedFloorTileData(newFloorName);

    // Check for enemies on the new floor and spawn them if needed (non-blocking)
    setImmediate(async () => {
      try {
        const hasEnemies = await enemyService.hasEnemiesOnFloor(newFloorName);
        
        if (!hasEnemies) {
          console.log(`No enemies found on floor ${newFloorName}, spawning new enemies...`);
          
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

    // Check for items on the new floor and spawn them if needed (non-blocking)
    setImmediate(async () => {
      try {
        const hasItems = await itemService.hasItemsOnFloor(newFloorName);
        
        if (!hasItems) {
          console.log(`No items found on floor ${newFloorName}, spawning new items...`);
          
          if (tileData && tileData.tiles.floorTiles.length > 0) {
            // Extract just the position data for item spawning
            const floorTilePositions = tileData.tiles.floorTiles.map(tile => ({
              x: tile.x,
              y: tile.y
            }));
            
            // Spawn 5 items on random floor tiles - each item gets its own independent thread
            await itemService.spawnItemsOnFloor(newFloorName, floorTilePositions);
            console.log(`Successfully spawned 5 independent item threads on floor ${newFloorName}`);
          } else {
            console.warn(`No floor tiles found for floor ${newFloorName}, cannot spawn items`);
          }
        } else {
          console.log(`Items already exist on floor ${newFloorName}, skipping spawn`);
        }
      } catch (error) {
        console.error(`Error spawning items on floor ${newFloorName}:`, error);
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

/**
 * Get enemy count by floor (only returns floors with enemies)
 * GET /api/dungeon/enemy-count
 */
router.get('/enemy-count', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const enemyData = await enemyService.getEnemyCountsByFloor();

    res.json({
      success: true,
      data: enemyData
    });
  } catch (error) {
    console.error('Error in get-enemy-count:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get all dungeon nodes visited by the requesting player
 * GET /api/dungeon/visited-nodes
 */
router.get('/visited-nodes', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    // Get all dungeon nodes visited by this user
    const visitedNodeNames = await dungeonService.getDungeonNodesVisitedByUser(userId);
    
    if (visitedNodeNames.length === 0) {
      res.json({
        success: true,
        data: []
      });
      return;
    }

    // Get full dungeon node data for visited nodes
    const { getDatabase } = await import('../config/database');
    const db = getDatabase();
    
    const visitedNodes = await db.collection('dungeonDagNodes')
      .find({ name: { $in: visitedNodeNames } })
      .limit(0) // 0 means no limit - get all results
      .toArray();

    // Transform the response to include visitedBy field and exclude visitedByUserIds
    const responseData = visitedNodes.map(node => ({
      _id: node._id,
      name: node.name,
      children: node.children,
      isDownwardsFromParent: node.isDownwardsFromParent,
      isBossLevel: node.isBossLevel,
      parentFloorDagNodeName: node.parentFloorDagNodeName,
      visitedBy: true // This user has visited this node since we filtered by visited nodes
    }));

    res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Error in get-visited-nodes:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get items on specified floor
 * GET /api/dungeon/floor-items?floorName=<floorName>
 */
router.get('/floor-items', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    const { floorName } = req.query;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!floorName || typeof floorName !== 'string') {
      res.status(400).json({
        success: false,
        error: 'floorName query parameter is required and must be a string'
      });
      return;
    }

    // Get items on the specified floor
    const items = await itemService.getItemsOnFloor(floorName);

    res.json({
      success: true,
      data: {
        floor: floorName,
        items: items
      }
    });
  } catch (error) {
    console.error('Error in floor-items:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Get player's inventory (items owned by the requesting user)
 * GET /api/dungeon/inventory
 */
router.get('/inventory', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    // Get items owned by the player
    const { getDatabase } = await import('../config/database');
    const db = getDatabase();
    
    const inventoryItems = await db.collection('itemInstances')
      .find({ 
        owner: userId,
        inWorld: false
      })
      .toArray();

    // Calculate inventory statistics
    const totalItems = inventoryItems.length;
    const totalValue = inventoryItems.reduce((sum, item) => sum + (item.value || 0), 0);
    const totalWeight = inventoryItems.reduce((sum, item) => sum + (item.weight || 0), 0);

    // Group items by category for easier display
    interface InventoryItem {
      id: string;
      itemTemplateId: string;
      category: string;
      templateName: string;
      possibleMaterials: string[];
      material: string;
      make: string;
      alignment: number;
      enchantments: string[];
      value: number;
      name: string;
      weight: number;
      weaponStats?: {
        type: string;
        powerMultiplier: number;
        dexterityMultiplier: number;
      };
      armorStats?: {
        defenseMultiplier: number;
        speedMultiplier: number;
        manaMultiplier: number;
      };
      spawnDatetime: Date;
      equipped: boolean;
    }

    const itemsByCategory: Record<string, InventoryItem[]> = {};
    for (const item of inventoryItems) {
      // Use the category from the item instance (no need to fetch template)
      const category = item.category || 'Unknown';
      
      if (!itemsByCategory[category]) {
        itemsByCategory[category] = [];
      }
      itemsByCategory[category].push({
        id: item.id,
        itemTemplateId: item.itemTemplateId,
        category: item.category,
        templateName: item.templateName,
        possibleMaterials: item.possibleMaterials,
        material: item.material,
        make: item.make,
        alignment: item.alignment,
        enchantments: item.enchantments,
        value: item.value,
        name: item.name,
        weight: item.weight,
        weaponStats: item.weaponStats,
        armorStats: item.armorStats,
        spawnDatetime: item.spawnDatetime,
        equipped: item.equipped
      });
    }

    res.json({
      success: true,
      data: {
        inventory: {
          items: inventoryItems.map(item => ({
            id: item.id,
            itemTemplateId: item.itemTemplateId,
            category: item.category,
            templateName: item.templateName,
            possibleMaterials: item.possibleMaterials,
            material: item.material,
            make: item.make,
            alignment: item.alignment,
            enchantments: item.enchantments,
            value: item.value,
            name: item.name,
            weight: item.weight,
            weaponStats: item.weaponStats,
            armorStats: item.armorStats,
            spawnDatetime: item.spawnDatetime,
            equipped: item.equipped
          })),
          itemsByCategory,
          statistics: {
            totalItems,
            totalValue,
            totalWeight: Math.round(totalWeight * 10) / 10 // Round to 1 decimal
          }
        }
      }
    });
  } catch (error) {
    console.error('Error in inventory:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Pick up an item
 * POST /api/dungeon/pickup-item
 */
router.post('/pickup-item', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    const { itemId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!itemId) {
      res.status(400).json({
        success: false,
        error: 'Item ID is required'
      });
      return;
    }

    // Try to pick up the item
    const success = await itemService.pickupItem(itemId, userId);

    if (success) {
      // Get the updated item data to send back
      const { getDatabase } = await import('../config/database');
      const db = getDatabase();
      const updatedItem = await db.collection('itemInstances').findOne({ id: itemId });

      res.json({
        success: true,
        message: 'Item picked up successfully',
        item: updatedItem
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Item could not be picked up (may already be taken or not exist)'
      });
    }
  } catch (error) {
    console.error('Error in pickup-item:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Drop an item
 * POST /api/dungeon/drop-item
 */
router.post('/drop-item', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    const { itemId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!itemId) {
      res.status(400).json({
        success: false,
        error: 'Item ID is required'
      });
      return;
    }

    // Check if the item is equipped before allowing drop
    const { getDatabase } = await import('../config/database');
    const db = getDatabase();
    const itemToCheck = await db.collection('itemInstances').findOne({ 
      id: itemId, 
      owner: userId, 
      inWorld: false 
    });

    if (!itemToCheck) {
      res.status(404).json({
        success: false,
        error: 'Item not found or not owned by player'
      });
      return;
    }

    if (itemToCheck.equipped === true) {
      res.status(400).json({
        success: false,
        error: 'Cannot drop equipped items. Unequip the item first.'
      });
      return;
    }

    // Get player to access current position and floor
    const player = await playerService.getPlayer(userId);
    if (!player) {
      res.status(404).json({
        success: false,
        error: 'Player not found'
      });
      return;
    }

    const currentFloor = player.currentDungeonDagNodeName || 'A';
    
    // Get floor tiles for the current floor
    const tileData = await dungeonService.getGeneratedFloorTileData(currentFloor);
    if (!tileData || !tileData.tiles.floorTiles.length) {
      res.status(400).json({
        success: false,
        error: 'No floor tiles found for current floor'
      });
      return;
    }

    const floorTilePositions = tileData.tiles.floorTiles.map(tile => ({
      x: tile.x,
      y: tile.y
    }));

    // Try to drop the item at the player's current position
    const success = await itemService.dropItem(
      itemId, 
      userId, 
      player.position.x, 
      player.position.z, 
      currentFloor,
      floorTilePositions
    );

    if (success) {
      // Get the updated item data to send back
      const updatedItem = await db.collection('itemInstances').findOne({ id: itemId });

      res.json({
        success: true,
        message: 'Item dropped successfully',
        item: updatedItem
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Item could not be dropped (may not belong to player, not exist, or is equipped)'
      });
    }
  } catch (error) {
    console.error('Error in drop-item:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Equip an item
 * POST /api/dungeon/equip-item
 */
router.post('/equip-item', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    const { itemId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!itemId) {
      res.status(400).json({
        success: false,
        error: 'Item ID is required'
      });
      return;
    }

    const { getDatabase } = await import('../config/database');
    const db = getDatabase();

    // First, get the item to check its category and verify ownership
    const itemToEquip = await db.collection('itemInstances').findOne({ 
      id: itemId, 
      owner: userId, 
      inWorld: false 
    });

    if (!itemToEquip) {
      res.status(404).json({
        success: false,
        error: 'Item not found or not owned by player'
      });
      return;
    }

    // Check if item is already equipped
    if (itemToEquip.equipped === true) {
      res.status(400).json({
        success: false,
        error: 'Item is already equipped'
      });
      return;
    }

    // Define equipment slot limits
    const equipmentLimits: Record<string, number> = {
      'Ring': 2,
      'Amulet': 1,
      'Chest armor': 1,
      'Head armor': 1,
      'Cloak': 1,
      'Leg armor': 1,
      'Shoes': 1,
      'Gloves': 1,
      'Shield': 1,
      'Range Weapon': 1,
      'Melee Weapon': 1,
      'Magic Weapon': 1
    };

    const itemCategory = itemToEquip.category;
    const maxAllowed = equipmentLimits[itemCategory];

    if (maxAllowed === undefined) {
      res.status(400).json({
        success: false,
        error: `Items of category '${itemCategory}' cannot be equipped`
      });
      return;
    }

    // For weapons, check all weapon types together (only 1 weapon total)
    let currentlyEquippedCount = 0;
    if (['Range Weapon', 'Melee Weapon', 'Magic Weapon'].includes(itemCategory)) {
      currentlyEquippedCount = await db.collection('itemInstances').countDocuments({
        owner: userId,
        inWorld: false,
        equipped: true,
        category: { $in: ['Range Weapon', 'Melee Weapon', 'Magic Weapon'] }
      });
    } else {
      // For other items, check only the specific category
      currentlyEquippedCount = await db.collection('itemInstances').countDocuments({
        owner: userId,
        inWorld: false,
        equipped: true,
        category: itemCategory
      });
    }

    if (currentlyEquippedCount >= maxAllowed) {
      const itemType = ['Range Weapon', 'Melee Weapon', 'Magic Weapon'].includes(itemCategory) ? 'weapon' : itemCategory.toLowerCase();
      res.status(400).json({
        success: false,
        error: `Cannot equip ${itemCategory}. You already have the maximum number of ${itemType}${maxAllowed > 1 ? 's' : ''} equipped (${currentlyEquippedCount}/${maxAllowed})`
      });
      return;
    }

    // Update the item to set equipped to true
    const result = await db.collection('itemInstances').updateOne(
      { 
        id: itemId, 
        owner: userId, 
        inWorld: false 
      },
      { 
        $set: { equipped: true }
      }
    );

    if (result.modifiedCount > 0) {
      // Get the updated item data to send back
      const updatedItem = await db.collection('itemInstances').findOne({ id: itemId });

      res.json({
        success: true,
        message: 'Item equipped successfully',
        item: updatedItem
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Item could not be equipped (may not belong to player or not exist)'
      });
    }
  } catch (error) {
    console.error('Error in equip-item:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * Unequip an item
 * POST /api/dungeon/unequip-item
 */
router.post('/unequip-item', async (req: AuthenticatedRequest, res): Promise<void> => {
  try {
    const userId = req.user?.uid;
    const { itemId } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: 'User not authenticated'
      });
      return;
    }

    if (!itemId) {
      res.status(400).json({
        success: false,
        error: 'Item ID is required'
      });
      return;
    }

    // Update the item to set equipped to false
    const { getDatabase } = await import('../config/database');
    const db = getDatabase();
    const result = await db.collection('itemInstances').updateOne(
      { 
        id: itemId, 
        owner: userId, 
        inWorld: false 
      },
      { 
        $set: { equipped: false }
      }
    );

    if (result.modifiedCount > 0) {
      // Get the updated item data to send back
      const updatedItem = await db.collection('itemInstances').findOne({ id: itemId });

      res.json({
        success: true,
        message: 'Item unequipped successfully',
        item: updatedItem
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Item could not be unequipped (may not belong to player or not exist)'
      });
    }
  } catch (error) {
    console.error('Error in unequip-item:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;
