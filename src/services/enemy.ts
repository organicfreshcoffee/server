import { broadcastToFloor } from './floorManager';
import { clients } from './websocket';
import { calculateDistance } from './gameUtils';

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
  private tickCounter = 0;
  
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
      this.tickCounter++;

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
      }
      
      // Broadcast this enemy's movement to all clients on the floor (includes health)
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
            isMoving: this.isMovingToDestination,
            health: this.enemyData.health
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
      this.enemyData.rotationY = Math.atan2(deltaY, deltaX);
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
   * Check if this enemy is hit by an attack based on in-memory position
   */
  checkForDamage(attackData: { fromPosition: { x: number; y: number; z: number }; toPosition: { x: number; y: number; z: number }; range: number }): boolean {
    // Convert enemy position to 3D coordinates for attack checking
    const enemyPos3D = {
      x: this.enemyData.positionX,
      y: 6, // Default y coordinate for enemies
      z: this.enemyData.positionY // Enemy y becomes attack z
    };
    
    console.log(`[ENEMY DAMAGE CHECK] Checking enemy ${this.enemyData.id} at (${this.enemyData.positionX}, ${this.enemyData.positionY}) -> 3D (${enemyPos3D.x}, ${enemyPos3D.y}, ${enemyPos3D.z})`);
    
    const { fromPosition, toPosition, range } = attackData;
    
    if (!fromPosition || !toPosition || !range) {
      console.log(`[ENEMY DAMAGE CHECK] Missing attack data, returning false`);
      return false;
    }
    
    // Calculate distance from attack start to enemy
    const distanceFromStart = calculateDistance(enemyPos3D, fromPosition);
    
    console.log(`[ENEMY DAMAGE CHECK] Distance from attack start: ${distanceFromStart}, attack range: ${range}`);
    
    // If enemy is too far from attack start, they can't be hit
    if (distanceFromStart > range) {
      console.log(`[ENEMY DAMAGE CHECK] Enemy too far from attack start, not hit`);
      return false;
    }
    
    // Calculate attack direction vector
    const attackDirection = {
      x: toPosition.x - fromPosition.x,
      y: toPosition.y - fromPosition.y,
      z: toPosition.z - fromPosition.z
    };
    
    // Normalize attack direction
    const attackLength = Math.sqrt(
      attackDirection.x * attackDirection.x + 
      attackDirection.y * attackDirection.y + 
      attackDirection.z * attackDirection.z
    );
    
    if (attackLength === 0) {
      // If attack has no direction, just check if enemy is within range
      const isHit = distanceFromStart <= range;
      console.log(`[ENEMY DAMAGE CHECK] Zero-direction attack, hit: ${isHit}`);
      return isHit;
    }
    
    const normalizedAttackDirection = {
      x: attackDirection.x / attackLength,
      y: attackDirection.y / attackLength,
      z: attackDirection.z / attackLength
    };
    
    // Vector from attack start to enemy
    const toEnemyVector = {
      x: enemyPos3D.x - fromPosition.x,
      y: enemyPos3D.y - fromPosition.y,
      z: enemyPos3D.z - fromPosition.z
    };
    
    // Calculate dot product to see if enemy is in the general direction of the attack
    const dotProduct = 
      toEnemyVector.x * normalizedAttackDirection.x + 
      toEnemyVector.y * normalizedAttackDirection.y + 
      toEnemyVector.z * normalizedAttackDirection.z;
    
    console.log(`[ENEMY DAMAGE CHECK] Dot product (direction alignment): ${dotProduct}`);
    
    // Enemy must be in the forward direction of the attack (dot product > 0)
    const isInDirection = dotProduct > 0;
    
    // Calculate the perpendicular distance from the attack line
    const projectionLength = Math.max(0, Math.min(range, dotProduct));
    const projectedPoint = {
      x: fromPosition.x + normalizedAttackDirection.x * projectionLength,
      y: fromPosition.y + normalizedAttackDirection.y * projectionLength,
      z: fromPosition.z + normalizedAttackDirection.z * projectionLength
    };
    
    const perpendicularDistance = calculateDistance(enemyPos3D, projectedPoint);
    
    // Use a generous hit radius for attacks
    const attackHitRadius = 2.5;
    
    const isWithinCone = perpendicularDistance <= attackHitRadius;
    const isHit = isInDirection && isWithinCone && distanceFromStart <= range;
    
    console.log(`[ENEMY DAMAGE CHECK] In direction: ${isInDirection}, within cone: ${isWithinCone}, perpendicular distance: ${perpendicularDistance}, hit: ${isHit}`);
    
    return isHit;
  }

  /**
   * Check if this enemy is hit by a spell based on in-memory position
   */
  checkForSpellDamage(spellData: { fromPosition: { x: number; y: number; z: number }; toPosition?: { x: number; y: number; z: number }; spellRadius: number }): boolean {
    // Convert enemy position to 3D coordinates for spell checking
    // Enemy x,y maps to spell x,z coordinates, use a default y coordinate
    const enemyPos3D = {
      x: this.enemyData.positionX,
      y: 6, // Default y coordinate for enemies (matches typical player y)  
      z: this.enemyData.positionY // Enemy y becomes spell z
    };
    
    console.log(`[ENEMY SPELL CHECK] Checking enemy ${this.enemyData.id} at (${this.enemyData.positionX}, ${this.enemyData.positionY}) -> 3D (${enemyPos3D.x}, ${enemyPos3D.y}, ${enemyPos3D.z})`);
    
    const { fromPosition, toPosition, spellRadius } = spellData;
    
    if (!fromPosition || !spellRadius) {
      console.log(`[ENEMY SPELL CHECK] Missing spell data, returning false`);
      return false;
    }
    
    // Use the same logic as isPlayerHitBySpell for consistency
    console.log(`[ENEMY SPELL CHECK] Spell from (${fromPosition.x}, ${fromPosition.y}, ${fromPosition.z}) to (${toPosition?.x || fromPosition.x}, ${toPosition?.y || fromPosition.y}, ${toPosition?.z || fromPosition.z}), radius: ${spellRadius}`);
    
    // Calculate the closest point on the spell's line to the enemy
    const lineStart = fromPosition;
    const lineEnd = toPosition || fromPosition; // If no end position, it's a point spell
    const lineVector = {
      x: lineEnd.x - lineStart.x,
      y: lineEnd.y - lineStart.y,
      z: lineEnd.z - lineStart.z
    };
    
    const lineLength = Math.sqrt(
      lineVector.x * lineVector.x + 
      lineVector.y * lineVector.y + 
      lineVector.z * lineVector.z
    );
    
    console.log(`[ENEMY SPELL CHECK] Line length: ${lineLength}`);
    
    if (lineLength === 0) {
      // If spell has no length, just check distance from start point
      const distance = calculateDistance(enemyPos3D, lineStart);
      console.log(`[ENEMY SPELL CHECK] Zero-length spell, distance from start: ${distance}, hit: ${distance <= spellRadius}`);
      return distance <= spellRadius;
    }
    
    // Normalize the line vector
    const normalizedLine = {
      x: lineVector.x / lineLength,
      y: lineVector.y / lineLength,
      z: lineVector.z / lineLength
    };
    
    // Vector from line start to enemy
    const enemyVector = {
      x: enemyPos3D.x - lineStart.x,
      y: enemyPos3D.y - lineStart.y,
      z: enemyPos3D.z - lineStart.z
    };
    
    // Project enemy vector onto the line
    const projection = 
      enemyVector.x * normalizedLine.x + 
      enemyVector.y * normalizedLine.y + 
      enemyVector.z * normalizedLine.z;
    
    // Clamp projection to the line segment
    const clampedProjection = Math.max(0, Math.min(lineLength, projection));
    
    console.log(`[ENEMY SPELL CHECK] Projection: ${projection}, clamped: ${clampedProjection}`);
    
    // Find the closest point on the line
    const closestPoint = {
      x: lineStart.x + normalizedLine.x * clampedProjection,
      y: lineStart.y + normalizedLine.y * clampedProjection,
      z: lineStart.z + normalizedLine.z * clampedProjection
    };
    
    // Check if enemy is within the spell radius of the closest point
    const distanceToLine = calculateDistance(enemyPos3D, closestPoint);
    const isHit = distanceToLine <= spellRadius;
    
    console.log(`[ENEMY SPELL CHECK] Closest point on line: (${closestPoint.x}, ${closestPoint.y}, ${closestPoint.z})`);
    console.log(`[ENEMY SPELL CHECK] Distance to line: ${distanceToLine}, spell radius: ${spellRadius}, hit: ${isHit}`);
    
    return isHit;
  }

  /**
   * Update enemy health and handle death - works with in-memory data
   */
  async updateHealth(newHealth: number): Promise<boolean> {
    console.log(`[ENEMY DEBUG] updateHealth called for enemy ${this.enemyData.id} with newHealth: ${newHealth}`);
    
    try {
      // Capture old health before updating
      const oldHealth = this.enemyData.health;
      
      // Clamp health to minimum 0
      const clampedHealth = Math.max(0, newHealth);
      
      console.log(`[ENEMY DEBUG] Updating health from ${oldHealth} to ${clampedHealth}`);
      
      // Update local data only - database will be updated on next DB update tick
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
      // Send despawn message to clients
      broadcastToFloor(this.enemyData.floorName, {
        type: 'enemy-despawned',
        data: {
          enemyId: this.enemyData.id,
          floorName: this.enemyData.floorName
        }
      }, clients);
      
      console.log(`Enemy ${this.enemyData.id} despawned after ${this.ENEMY_LIFETIME_MS / 1000} seconds (in-memory only)`);
      
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
