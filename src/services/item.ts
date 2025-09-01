import { getDatabase } from '../config/database';
import { broadcastToFloor } from './floorManager';
import { clients } from './websocket';

export interface ItemInstanceData {
  id: string;
  itemTemplateId: string;
  category: string;
  templateName: string;
  possibleMaterials: string[];
  material: string;
  make: string;
  location: { x: number; y: number };
  inWorld: boolean;
  owner: string | null;
  alignment: number;
  spawnDatetime: Date;
  enchantments: string[];
  value: number;
  name: string;
  weight: number;
  floor: string;
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
}

export class ItemInstance {
  private readonly ITEM_LIFETIME_MS = 5 * 60 * 1000; // 5 minutes
  private ticker: NodeJS.Timeout | null = null;
  private startTime: number;
  private isDespawned = false;
  private onDespawnCallback?: (itemId: string) => void;
  private floorTiles: Array<{ x: number; y: number }>;
  
  constructor(
    private itemData: ItemInstanceData, 
    floorTiles: Array<{ x: number; y: number }>,
    onDespawn?: (itemId: string) => void
  ) {
    this.startTime = Date.now();
    this.onDespawnCallback = onDespawn;
    this.floorTiles = floorTiles;
  }

  /**
   * Initialize the item thread - starts the tick loop
   */
  init(): void {
    if (this.ticker) {
      console.warn(`Item ${this.itemData.id} already initialized`);
      return;
    }

    this.ticker = setInterval(() => {
      this.tick();
    }, 10000); // Tick every 10 seconds (less frequent than enemies)

    console.log(`Item thread initialized for ${this.itemData.id} (${this.itemData.name})`);
  }

  /**
   * Main tick function - runs every 10 seconds
   */
  private tick(): void {
    try {
      // Check if it's time to despawn
      const elapsedTime = Date.now() - this.startTime;
      
      if (elapsedTime >= this.ITEM_LIFETIME_MS) {
        this.checkAndDelete();
        return;
      }

      // Don't process if already despawned
      if (this.isDespawned) {
        return;
      }

      // Check if item was picked up
      this.checkIfPickedUp();
      
    } catch (error) {
      console.error(`Error in item tick ${this.itemData.id}:`, error);
      this.delete(); // Clean up on error
    }
  }

  /**
   * Check if item was picked up and stop timer if so
   */
  private async checkIfPickedUp(): Promise<void> {
    try {
      const db = getDatabase();
      
      // Check current item state in database
      const currentItem = await db.collection('itemInstances').findOne({ id: this.itemData.id });
      if (!currentItem) {
        this.delete(); // Item was deleted externally
        return;
      }

      // If item was picked up (owner is not null), stop the timer
      if (currentItem.owner !== null) {
        console.log(`Item ${this.itemData.id} was picked up by ${currentItem.owner}, stopping timer`);
        this.stopTimer();
        return;
      }

    } catch (error) {
      console.error(`Error checking pickup status for item ${this.itemData.id}:`, error);
    }
  }

  /**
   * Check if item should be deleted (only if still not picked up)
   */
  private async checkAndDelete(): Promise<void> {
    try {
      const db = getDatabase();
      
      // Check current item state in database
      const currentItem = await db.collection('itemInstances').findOne({ id: this.itemData.id });
      if (!currentItem) {
        this.delete(); // Item was deleted externally
        return;
      }

      // Only delete if item is still not picked up
      if (currentItem.owner === null && currentItem.inWorld === true) {
        console.log(`Item ${this.itemData.id} timed out after 5 minutes, deleting...`);
        await this.delete();
      } else {
        console.log(`Item ${this.itemData.id} was picked up, not deleting`);
        this.stopTimer();
      }

    } catch (error) {
      console.error(`Error checking delete condition for item ${this.itemData.id}:`, error);
      this.delete(); // Clean up on error
    }
  }

  /**
   * Stop the timer (called when item is picked up)
   */
  stopTimer(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
      console.log(`Stopped timer for item ${this.itemData.id}`);
    }
  }

  /**
   * Despawn and destroy the item thread (only if not picked up)
   */
  async delete(): Promise<void> {
    if (this.isDespawned) {
      return; // Already despawned
    }

    try {
      const db = getDatabase();
      
      // Delete from database only if still not picked up
      const deleteResult = await db.collection('itemInstances').deleteOne({ 
        id: this.itemData.id,
        owner: null,
        inWorld: true
      });
      
      if (deleteResult.deletedCount > 0) {
        // Send despawn message to clients only if item was actually deleted
        broadcastToFloor(this.itemData.floor, {
          type: 'item-despawned',
          data: {
            itemId: this.itemData.id,
            floor: this.itemData.floor
          }
        }, clients);
        
        console.log(`Item ${this.itemData.id} despawned after ${this.ITEM_LIFETIME_MS / 1000} seconds`);
      } else {
        console.log(`Item ${this.itemData.id} was not deleted (likely picked up)`);
      }
      
    } catch (error) {
      console.error(`Error despawning item ${this.itemData.id}:`, error);
    } finally {
      // Clean up the ticker
      if (this.ticker) {
        clearInterval(this.ticker);
        this.ticker = null;
        this.isDespawned = true;
      }
      
      // Notify the service that this item has despawned
      if (this.onDespawnCallback) {
        this.onDespawnCallback(this.itemData.id);
      }
    }
  }

  /**
   * Get item data
   */
  getData(): ItemInstanceData {
    return { ...this.itemData };
  }

  /**
   * Check if item is despawned
   */
  isDespawnedState(): boolean {
    return this.isDespawned;
  }
}
