import { getDatabase } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { broadcastToFloor } from './floorManager';
import { clients } from './websocket';
import { Enemy, EnemyData } from './enemy';

// Re-export the interface for backward compatibility
export type EnemyInterface = EnemyData;

export interface EnemyType {
  enemyTypeID: number;
  enemyTypeName: string;
  maxHealth: number;
}

export class EnemyService {
  private readonly CUBE_SIZE = 5;
  private activeEnemies: Map<string, Enemy> = new Map(); // Track active enemy instances

  constructor() {
    // Service manages enemy instances
  }

  /**
   * Check if there are enemies on a floor
   */
  async hasEnemiesOnFloor(floorName: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db.collection('enemies').countDocuments({ floorName });
    return count > 0;
  }

  /**
   * Get enemy counts by floor (only returns floors with enemies)
   */
  async getEnemyCountsByFloor(): Promise<{ totalEnemies: number; enemiesByFloor: Record<string, number> }> {
    const db = getDatabase();
    
    // Aggregate enemies by floor using MongoDB aggregation
    const enemyCountsByFloor = await db.collection('enemies').aggregate([
      {
        $group: {
          _id: '$floorName',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          floorName: '$_id',
          enemyCount: '$count'
        }
      }
    ]).toArray();

    // Convert to key-value pairs for easier consumption
    const enemiesByFloor: Record<string, number> = {};
    let totalEnemies = 0;

    enemyCountsByFloor.forEach(floor => {
      enemiesByFloor[floor.floorName] = floor.enemyCount;
      totalEnemies += floor.enemyCount;
    });

    return {
      totalEnemies,
      enemiesByFloor
    };
  }

  /**
   * Get all enemy types from the database
   */
  async getEnemyTypes(): Promise<EnemyType[]> {
    const db = getDatabase();
    const enemyTypes = await db.collection('enemyTypes').find({}).toArray();
    return enemyTypes.map(type => ({
      enemyTypeID: type.enemyTypeID,
      enemyTypeName: type.enemyTypeName,
      maxHealth: type.maxHealth
    }));
  }

  /**
   * Get a random enemy type
   */
  private async getRandomEnemyType(): Promise<EnemyType> {
    const enemyTypes = await this.getEnemyTypes();
    if (enemyTypes.length === 0) {
      throw new Error('No enemy types found in database');
    }
    const randomIndex = Math.floor(Math.random() * enemyTypes.length);
    return enemyTypes[randomIndex];
  }

  /**
   * Convert tile coordinates to world coordinates
   */
  private tileToWorldCoordinates(tileX: number, tileY: number): { worldX: number, worldY: number } {
    return {
      worldX: tileX * this.CUBE_SIZE,
      worldY: tileY * this.CUBE_SIZE
    };
  }

  /**
   * Create a new enemy
   */
  async createEnemy(
    floorName: string,
    tileX: number,
    tileY: number,
    enemyType: EnemyType,
    floorTiles: Array<{ x: number; y: number }>
  ): Promise<EnemyData> {
    const db = getDatabase();
    
    const { worldX, worldY } = this.tileToWorldCoordinates(tileX, tileY);
    
    const enemyData: EnemyData = {
      id: uuidv4(),
      enemyTypeID: enemyType.enemyTypeID,
      enemyTypeName: enemyType.enemyTypeName,
      positionX: worldX,
      positionY: worldY,
      rotationY: Math.random() * 360, // Random rotation
      floorName,
      isMoving: false,
      health: enemyType.maxHealth,
      createdDatetime: new Date()
    };

    await db.collection('enemies').insertOne(enemyData);
    
    // Create and initialize the enemy instance
    const enemy = new Enemy(enemyData, floorTiles, (enemyId) => {
      // Callback to remove from active enemies when despawned
      // TODO: callback to delete just calls delete again
      this.removeActiveEnemy(enemyId);
    });
    this.activeEnemies.set(enemyData.id, enemy);
    enemy.init(); // Start the enemy thread
    
    // Send WebSocket message to all clients on this floor about the new enemy
    broadcastToFloor(floorName, {
      type: 'enemy-spawned',
      data: {
        enemy: enemyData
      }
    }, clients);
    
    console.log(`Created enemy ${enemyData.enemyTypeName} with ID ${enemyData.id} on floor ${floorName} at world position (${worldX}, ${worldY})`);
    
    return enemyData;
  }

  /**
   * Spawn 5 enemies on a floor at random floor tile positions
   */
  async spawnEnemiesOnFloor(floorName: string, floorTiles: Array<{ x: number; y: number }>): Promise<EnemyData[]> {
    if (floorTiles.length === 0) {
      throw new Error(`No floor tiles available for spawning enemies on floor ${floorName}`);
    }

    const enemies: EnemyData[] = [];

    for (let i = 0; i < 5; i++) {
      // Get a random enemy type
      const enemyType = await this.getRandomEnemyType();
      
      // Simply select a random floor tile
      const randomIndex = Math.floor(Math.random() * floorTiles.length);
      const selectedTile = floorTiles[randomIndex];

      // Create the enemy at the selected tile position
      const enemy = await this.createEnemy(floorName, selectedTile.x, selectedTile.y, enemyType, floorTiles);
      enemies.push(enemy);
    }

    console.log(`Spawned ${enemies.length} enemies on floor ${floorName}`);
    return enemies;
  }

  /**
   * Update enemy health and handle death (DEPRECATED - use Enemy.updateHealth instead)
   * This method is kept for backward compatibility but should be replaced with direct Enemy instance calls
   */
  async updateEnemyHealth(enemyId: string, newHealth: number): Promise<boolean> {
    console.log(`[ENEMY SERVICE DEBUG] updateEnemyHealth called for enemy ${enemyId} with newHealth: ${newHealth} (DEPRECATED)`);
    console.warn(`[ENEMY SERVICE] updateEnemyHealth is deprecated. Use Enemy.updateHealth() directly instead.`);
    
    const enemyInstance = this.activeEnemies.get(enemyId);
    if (!enemyInstance) {
      console.warn(`Enemy ${enemyId} not found in active enemies for health update`);
      console.log(`[ENEMY SERVICE DEBUG] Active enemies count: ${this.activeEnemies.size}`);
      console.log(`[ENEMY SERVICE DEBUG] Active enemy IDs:`, Array.from(this.activeEnemies.keys()));
      return false;
    }
    
    console.log(`[ENEMY SERVICE DEBUG] Found enemy instance for ${enemyId}, calling updateHealth...`);
    const died = await enemyInstance.updateHealth(newHealth);
    return died;
  }

  /**
   * Get enemy instance by ID
   */
  getActiveEnemy(enemyId: string): Enemy | undefined {
    return this.activeEnemies.get(enemyId);
  }

  /**
   * Get all active enemy instances on a specific floor (for collision checking)
   */
  getActiveEnemiesOnFloor(floorName: string): Enemy[] {
    const enemiesOnFloor: Enemy[] = [];
    
    for (const enemy of this.activeEnemies.values()) {
      const enemyData = enemy.getData();
      if (enemyData.floorName === floorName && !enemy.isDespawnedState()) {
        enemiesOnFloor.push(enemy);
      }
    }
    
    console.log(`[ENEMY SERVICE] Found ${enemiesOnFloor.length} active enemies on floor ${floorName}`);
    return enemiesOnFloor;
  }

  /**
   * Get all enemies on a specific floor
   */
  async getEnemiesOnFloor(floorName: string): Promise<EnemyData[]> {
    const db = getDatabase();
    const enemies = await db.collection('enemies').find({ floorName }).toArray();
    return enemies.map(enemy => ({
      id: enemy.id,
      enemyTypeID: enemy.enemyTypeID,
      enemyTypeName: enemy.enemyTypeName,
      positionX: enemy.positionX,
      positionY: enemy.positionY,
      rotationY: enemy.rotationY,
      floorName: enemy.floorName,
      isMoving: enemy.isMoving,
      health: enemy.health,
      createdDatetime: enemy.createdDatetime
    }));
  }

  /**
   * Cleanup method to clear all active enemy instances (useful for graceful shutdown)
   */
  cleanup(): void {
    // Tell all active enemies to despawn
    this.activeEnemies.forEach(async (enemy, enemyId) => {
      if (!enemy.isDespawnedState()) {
        await enemy.delete();
      }
      console.log(`Cleaned up enemy ${enemyId}`);
    });
    this.activeEnemies.clear();
  }

  /**
   * Remove an enemy from the active enemies tracking (called when enemy despawns itself)
   */
  removeActiveEnemy(enemyId: string): void {
    this.activeEnemies.delete(enemyId);
  }
}
