import { getDatabase } from '../config/database';
import { broadcastToFloor } from './websocket';

export interface EnemyData {
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

export class Enemy {
  private readonly CUBE_SIZE = 5;
  private readonly ENEMY_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes
  private ticker: NodeJS.Timeout | null = null;
  private startTime: number;
  private isDespawned = false;
  private onDespawnCallback?: (enemyId: string) => void;
  
  constructor(private enemyData: EnemyData, onDespawn?: (enemyId: string) => void) {
    this.startTime = Date.now();
    this.onDespawnCallback = onDespawn;
  }

  /**
   * Initialize the enemy thread - starts the tick loop
   */
  init(): void {
    if (this.ticker) {
      console.warn(`Enemy ${this.enemyData.id} already initialized`);
      return;
    }

    this.ticker = setInterval(() => {
      this.tick();
    }, 1000); // Tick every second

    console.log(`Enemy thread initialized for ${this.enemyData.id} (${this.enemyData.enemyTypeName})`);
  }

  /**
   * Main tick function - runs every second
   */
  private tick(): void {
    try {
      // Check if it's time to despawn
      const elapsedTime = Date.now() - this.startTime;
      
      if (elapsedTime >= this.ENEMY_LIFETIME_MS) {
        this.delete();
        return;
      }

      // Don't process if already despawned
      if (this.isDespawned) {
        return;
      }

      // Perform movement and broadcast
      this.move();
      
    } catch (error) {
      console.error(`Error in enemy tick ${this.enemyData.id}:`, error);
      this.delete(); // Clean up on error
    }
  }

  /**
   * Handle enemy movement logic
   */
  private async move(): Promise<void> {
    try {
      const db = getDatabase();
      
      // Check if enemy still exists in database
      const currentEnemy = await db.collection('enemies').findOne({ id: this.enemyData.id });
      if (!currentEnemy) {
        this.delete(); // Enemy was deleted externally
        return;
      }

      // Simulate movement (in a real game, this would be based on AI logic)
      const shouldMove = false; // Math.random() < 0.3; // 30% chance to move
      // TODO: movement logic: must take into consideration valid tiles to move to
      // also, it should move consistently for a period of time, not in random bursts
      let newX = this.enemyData.positionX;
      let newY = this.enemyData.positionY;
      let newRotation = this.enemyData.rotationY;
      
      if (shouldMove) {
        // Random small movement (within 1 cube unit in world coordinates)
        const moveDistance = this.CUBE_SIZE * 0.1; // 10% of cube size
        newX += (Math.random() - 0.5) * moveDistance * 2;
        newY += (Math.random() - 0.5) * moveDistance * 2;
        newRotation = Math.random() * 360;
        
        // Update in database
        await db.collection('enemies').updateOne(
          { id: this.enemyData.id },
          { 
            $set: { 
              positionX: newX, 
              positionY: newY, 
              rotationY: newRotation,
              isMoving: shouldMove
            }
          }
        );
        
        // Update local enemy data
        this.enemyData.positionX = newX;
        this.enemyData.positionY = newY;
        this.enemyData.rotationY = newRotation;
        this.enemyData.isMoving = shouldMove;
      }
      
      // Broadcast this enemy's movement to all clients on the floor
      broadcastToFloor(this.enemyData.floorName, {
        type: 'enemy-moved',
        data: {
          floorName: this.enemyData.floorName,
          enemies: [{
            id: this.enemyData.id,
            enemyTypeID: this.enemyData.enemyTypeID,
            enemyTypeName: this.enemyData.enemyTypeName,
            positionX: newX,
            positionY: newY,
            rotationY: newRotation,
            isMoving: shouldMove
          }]
        }
      });
      
    } catch (error) {
      console.error(`Error in enemy movement ${this.enemyData.id}:`, error);
    }
  }

  /**
   * Despawn and destroy the enemy thread
   */
  async delete(): Promise<void> {
    if (this.isDespawned) {
      return; // Already despawned
    }

    try {
      const db = getDatabase();
      
      // Delete from database
      await db.collection('enemies').deleteOne({ id: this.enemyData.id });
      
      // Send despawn message to clients
      broadcastToFloor(this.enemyData.floorName, {
        type: 'enemy-despawned',
        data: {
          enemyId: this.enemyData.id,
          floorName: this.enemyData.floorName
        }
      });
      
      console.log(`Enemy ${this.enemyData.id} despawned after ${this.ENEMY_LIFETIME_MS / 1000} seconds`);
      
    } catch (error) {
      console.error(`Error despawning enemy ${this.enemyData.id}:`, error);
    } finally {
      // Clean up the ticker
      if (this.ticker) {
        clearInterval(this.ticker);
        this.ticker = null;
        this.isDespawned = true;
      }
      
      // Notify the service that this enemy has despawned
      if (this.onDespawnCallback) {
        this.onDespawnCallback(this.enemyData.id);
      }
    }
  }

  /**
   * Get enemy data
   */
  getData(): EnemyData {
    return { ...this.enemyData };
  }

  /**
   * Check if enemy is despawned
   */
  isDespawnedState(): boolean {
    return this.isDespawned;
  }
}
