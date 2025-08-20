import { getDatabase } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { broadcastToFloor } from './websocket';
import { GameMessage } from '../types/game';

export interface Enemy {
  id: string;
  enemyTypeID: number;
  enemyTypeName: string;
  positionX: number;
  positionY: number;
  rotationY: number;
  floorName: string;
  isMoving: boolean;
  health: number;
  createdDatetime: Date;
}

export interface EnemyType {
  enemyTypeID: number;
  enemyTypeName: string;
  maxHealth: number;
}

export class EnemyService {
  private readonly CUBE_SIZE = 5;
  private enemyTimers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Check if there are enemies on a floor
   */
  async hasEnemiesOnFloor(floorName: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db.collection('enemies').countDocuments({ floorName });
    return count > 0;
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
    enemyType: EnemyType
  ): Promise<Enemy> {
    const db = getDatabase();
    
    const { worldX, worldY } = this.tileToWorldCoordinates(tileX, tileY);
    
    const enemy: Enemy = {
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

    await db.collection('enemies').insertOne(enemy);
    
    // Start the 5-minute timer for this enemy
    this.startEnemyTimer(enemy.id);
    
    // Send WebSocket message to all clients on this floor about the new enemy
    broadcastToFloor(floorName, {
      type: 'enemy-spawned',
      data: {
        enemy: enemy
      }
    });
    
    console.log(`Created enemy ${enemy.enemyTypeName} with ID ${enemy.id} on floor ${floorName} at world position (${worldX}, ${worldY})`);
    
    return enemy;
  }

  /**
   * Start a 5-minute timer to delete an enemy
   */
  private startEnemyTimer(enemyId: string): void {
    const timer = setTimeout(async () => {
      try {
        await this.deleteEnemy(enemyId);
        this.enemyTimers.delete(enemyId);
        console.log(`Enemy ${enemyId} deleted after 5 minutes`);
      } catch (error) {
        console.error(`Error deleting enemy ${enemyId}:`, error);
      }
    }, 5 * 60 * 1000); // 5 minutes in milliseconds

    this.enemyTimers.set(enemyId, timer);
  }

  /**
   * Delete an enemy from the database
   */
  async deleteEnemy(enemyId: string): Promise<void> {
    const db = getDatabase();
    
    // Get enemy info before deleting for WebSocket message
    const enemy = await db.collection('enemies').findOne({ id: enemyId });
    
    if (enemy) {
      // Delete the enemy
      await db.collection('enemies').deleteOne({ id: enemyId });
      
      // Send WebSocket message to all clients on this floor about the enemy being deleted
      broadcastToFloor(enemy.floorName, {
        type: 'enemy-despawned',
        data: {
          enemyId: enemyId,
          floorName: enemy.floorName
        }
      });
    }
    
    // Clear the timer if it exists
    const timer = this.enemyTimers.get(enemyId);
    if (timer) {
      clearTimeout(timer);
      this.enemyTimers.delete(enemyId);
    }
  }

  /**
   * Spawn 5 enemies on a floor at random floor tile positions
   */
  async spawnEnemiesOnFloor(floorName: string, floorTiles: Array<{ x: number; y: number }>): Promise<Enemy[]> {
    if (floorTiles.length === 0) {
      throw new Error(`No floor tiles available for spawning enemies on floor ${floorName}`);
    }

    const enemies: Enemy[] = [];
    const usedPositions = new Set<string>();

    for (let i = 0; i < 5; i++) {
      // Get a random enemy type
      const enemyType = await this.getRandomEnemyType();
      
      // Find a random unused floor tile
      let attempts = 0;
      let selectedTile;
      
      do {
        const randomIndex = Math.floor(Math.random() * floorTiles.length);
        selectedTile = floorTiles[randomIndex];
        const positionKey = `${selectedTile.x},${selectedTile.y}`;
        
        if (!usedPositions.has(positionKey)) {
          usedPositions.add(positionKey);
          break;
        }
        
        attempts++;
      } while (attempts < 50); // Prevent infinite loop
      
      if (attempts >= 50) {
        console.warn(`Could not find unique position for enemy ${i + 1} on floor ${floorName}`);
        // Use a random tile even if it's occupied
        const randomIndex = Math.floor(Math.random() * floorTiles.length);
        selectedTile = floorTiles[randomIndex];
      }

      // Create the enemy at the selected tile position
      const enemy = await this.createEnemy(floorName, selectedTile.x, selectedTile.y, enemyType);
      enemies.push(enemy);
    }

    console.log(`Spawned ${enemies.length} enemies on floor ${floorName}`);
    return enemies;
  }

  /**
   * Get all enemies on a specific floor
   */
  async getEnemiesOnFloor(floorName: string): Promise<Enemy[]> {
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
   * Cleanup method to clear all timers (useful for graceful shutdown)
   */
  cleanup(): void {
    this.enemyTimers.forEach((timer) => clearTimeout(timer));
    this.enemyTimers.clear();
  }
}
