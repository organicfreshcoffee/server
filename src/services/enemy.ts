import { getDatabase } from '../config/database';
import { broadcastToFloor } from './floorManager';
import { clients } from './websocket';

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
  private readonly MOVEMENT_SPEED = 0.1; // Units per tick
  private ticker: NodeJS.Timeout | null = null;
  private startTime: number;
  private isDespawned = false;
  private onDespawnCallback?: (enemyId: string) => void;
  private floorTiles: Array<{ x: number; y: number }>;
  private destinationX: number | null = null;
  private destinationY: number | null = null;
  private isMovingToDestination = false;
  
  constructor(
    private enemyData: EnemyData, 
    floorTiles: Array<{ x: number; y: number }>,
    onDespawn?: (enemyId: string) => void
  ) {
    this.startTime = Date.now();
    this.onDespawnCallback = onDespawn;
    this.floorTiles = floorTiles;
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
    }, 100); // Tick every second

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

      // Convert current position to tile coordinates
      const currentTileX = Math.round(this.enemyData.positionX / this.CUBE_SIZE);
      const currentTileY = Math.round(this.enemyData.positionY / this.CUBE_SIZE);

      // If we don't have a destination or we've reached our destination, pick a new one
      if (!this.isMovingToDestination || this.hasReachedDestination()) {
        this.pickNewDestination(currentTileX, currentTileY);
      }

      // Move towards destination if we have one
      if (this.destinationX !== null && this.destinationY !== null) {
        this.moveTowardsDestination();
        
        // Update in database
        await db.collection('enemies').updateOne(
          { id: this.enemyData.id },
          { 
            $set: { 
              positionX: this.enemyData.positionX, 
              positionY: this.enemyData.positionY, 
              rotationY: this.enemyData.rotationY,
              isMoving: this.isMovingToDestination
            }
          }
        );
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
            positionX: this.enemyData.positionX,
            positionY: this.enemyData.positionY,
            rotationY: this.enemyData.rotationY,
            isMoving: this.isMovingToDestination
          }]
        }
      }, clients);

    } catch (error) {
      console.error(`Error in enemy movement ${this.enemyData.id}:`, error);
    }
  }

  /**
   * Pick a new destination from adjacent tiles
   */
  private pickNewDestination(currentTileX: number, currentTileY: number): void {
    // Get adjacent tiles
    const adjacentTiles = this.getAdjacentTiles(currentTileX, currentTileY);
    
    if (adjacentTiles.length === 0) {
      console.warn(`No adjacent tiles found for enemy ${this.enemyData.id} at tile (${currentTileX}, ${currentTileY})`);
      this.isMovingToDestination = false;
      return;
    }

    // Pick a random adjacent tile
    const randomIndex = Math.floor(Math.random() * adjacentTiles.length);
    const selectedTile = adjacentTiles[randomIndex];
    
    // Convert tile coordinates to world coordinates
    this.destinationX = selectedTile.x * this.CUBE_SIZE;
    this.destinationY = selectedTile.y * this.CUBE_SIZE;
    this.isMovingToDestination = true;
    
    console.log(`Enemy ${this.enemyData.id} picked new destination: tile (${selectedTile.x}, ${selectedTile.y}) = world (${this.destinationX}, ${this.destinationY})`);
  }

  /**
   * Get all valid floor tiles adjacent to the current position
   */
  private getAdjacentTiles(currentTileX: number, currentTileY: number): Array<{ x: number; y: number }> {
    const adjacentPositions = [
      { x: currentTileX - 1, y: currentTileY },     // Left
      { x: currentTileX + 1, y: currentTileY },     // Right
      { x: currentTileX, y: currentTileY - 1 },     // Up
      { x: currentTileX, y: currentTileY + 1 },     // Down
      { x: currentTileX - 1, y: currentTileY - 1 }, // Top-left
      { x: currentTileX + 1, y: currentTileY - 1 }, // Top-right
      { x: currentTileX - 1, y: currentTileY + 1 }, // Bottom-left
      { x: currentTileX + 1, y: currentTileY + 1 }  // Bottom-right
    ];

    // Filter to only include valid floor tiles
    return adjacentPositions.filter(pos => 
      this.floorTiles.some(tile => tile.x === pos.x && tile.y === pos.y)
    );
  }

  /**
   * Move towards the current destination
   */
  private moveTowardsDestination(): void {
    if (this.destinationX === null || this.destinationY === null) {
      return;
    }

    const deltaX = this.destinationX - this.enemyData.positionX;
    const deltaY = this.destinationY - this.enemyData.positionY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    if (distance <= this.MOVEMENT_SPEED) {
      // We've reached the destination
      this.enemyData.positionX = this.destinationX;
      this.enemyData.positionY = this.destinationY;
      this.isMovingToDestination = false;
    } else {
      // Move towards destination
      const normalizedX = deltaX / distance;
      const normalizedY = deltaY / distance;
      
      this.enemyData.positionX += normalizedX * this.MOVEMENT_SPEED;
      this.enemyData.positionY += normalizedY * this.MOVEMENT_SPEED;
      
      // Update rotation to face movement direction
      this.enemyData.rotationY = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    }
  }

  /**
   * Check if we've reached our destination
   */
  private hasReachedDestination(): boolean {
    if (this.destinationX === null || this.destinationY === null) {
      return true;
    }

    const deltaX = this.destinationX - this.enemyData.positionX;
    const deltaY = this.destinationY - this.enemyData.positionY;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

    return distance <= this.MOVEMENT_SPEED;
  }  /**
   * Update enemy health and handle death
   */
  async updateHealth(newHealth: number): Promise<boolean> {
    console.log(`[ENEMY DEBUG] updateHealth called for enemy ${this.enemyData.id} with newHealth: ${newHealth}`);
    
    try {
      const db = getDatabase();
      
      // Capture old health before updating
      const oldHealth = this.enemyData.health;
      
      // Clamp health to minimum 0
      const clampedHealth = Math.max(0, newHealth);
      
      console.log(`[ENEMY DEBUG] Updating health from ${oldHealth} to ${clampedHealth}`);
      
      // Update health in database
      await db.collection('enemies').updateOne(
        { id: this.enemyData.id },
        { 
          $set: { 
            health: clampedHealth,
            lastUpdate: new Date()
          } 
        }
      );
      
      // Update local data
      this.enemyData.health = clampedHealth;
      
      console.log(`Enemy ${this.enemyData.id} health updated: ${oldHealth} -> ${clampedHealth}`);
      
      // Check if enemy died
      if (clampedHealth <= 0) {
        console.log(`Enemy ${this.enemyData.id} died from damage!`);

        // call delete to de-spawn
        await this.delete();
        return true;
      }
      
      return false;
    } catch (error) {
      console.error(`Error updating health for enemy ${this.enemyData.id}:`, error);
      return false;
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
      }, clients);
      
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
