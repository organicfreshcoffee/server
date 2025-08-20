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
  private readonly ENEMY_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes
  private movementBroadcastInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start the main enemy update loop that handles both movement and cleanup
    this.startEnemyUpdateLoop();
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
   * Start the main enemy update loop that handles movement and cleanup
   */
  private startEnemyUpdateLoop(): void {
    this.movementBroadcastInterval = setInterval(async () => {
      try {
        await this.updateEnemies();
      } catch (error) {
        console.error('Error in enemy update loop:', error);
      }
    }, 1000); // Update every second
  }

  /**
   * Update all enemies: handle movement, check for expiration, and broadcast
   */
  private async updateEnemies(): Promise<void> {
    const db = getDatabase();
    const now = new Date();
    
    // Get all enemies
    const enemies = await db.collection('enemies').find({}).toArray();
    
    // Group enemies by floor for broadcasting
    const enemiesByFloor = new Map<string, any[]>();
    const enemiesToDelete: string[] = [];
    
    for (const enemy of enemies) {
      // Check if enemy should be deleted (older than 5 minutes)
      const enemyAge = now.getTime() - new Date(enemy.createdDatetime).getTime();
      
      if (enemyAge >= this.ENEMY_LIFETIME_MS) {
        enemiesToDelete.push(enemy.id);
        continue; // Skip this enemy, it will be deleted
      }
      
      // Simulate movement (in a real game, this would be based on AI logic)
      const shouldMove = false //Math.random() < 0.3; // 30% chance to move
      // TODO: movement logic: must take into consideration valid tiles to move to
      // also, it should move consistently for a period of time, not in random bursts
      let newX = enemy.positionX;
      let newY = enemy.positionY;
      let newRotation = enemy.rotationY;
      
      if (shouldMove) {
        // Random small movement (within 1 cube unit in world coordinates)
        const moveDistance = this.CUBE_SIZE * 0.1; // 10% of cube size
        newX += (Math.random() - 0.5) * moveDistance * 2;
        newY += (Math.random() - 0.5) * moveDistance * 2;
        newRotation = Math.random() * 360;
        
        // Update in database (non-blocking)
        setImmediate(async () => {
          try {
            await db.collection('enemies').updateOne(
              { id: enemy.id },
              { 
                $set: { 
                  positionX: newX, 
                  positionY: newY, 
                  rotationY: newRotation,
                  isMoving: shouldMove
                }
              }
            );
          } catch (error) {
            console.error(`Error updating enemy ${enemy.id} position:`, error);
          }
        });
      }
      
      // Add to floor group for broadcasting
      if (!enemiesByFloor.has(enemy.floorName)) {
        enemiesByFloor.set(enemy.floorName, []);
      }
      
      enemiesByFloor.get(enemy.floorName)!.push({
        id: enemy.id,
        enemyTypeID: enemy.enemyTypeID,
        enemyTypeName: enemy.enemyTypeName,
        positionX: newX,
        positionY: newY,
        rotationY: newRotation,
        isMoving: shouldMove
      });
    }
    
    // Delete expired enemies
    for (const enemyId of enemiesToDelete) {
      await this.deleteEnemy(enemyId);
    }
    
    // Broadcast movements to each floor
    enemiesByFloor.forEach((floorEnemies, floorName) => {
      if (floorEnemies.length > 0) {
        broadcastToFloor(floorName, {
          type: 'enemy-moved',
          data: {
            floorName,
            enemies: floorEnemies
          }
        });
      }
    });
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
      
      console.log(`Enemy ${enemyId} deleted after ${this.ENEMY_LIFETIME_MS / 1000} seconds`);
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
    if (this.movementBroadcastInterval) {
      clearInterval(this.movementBroadcastInterval);
      this.movementBroadcastInterval = null;
    }
  }
}
