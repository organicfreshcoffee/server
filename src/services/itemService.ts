import { getDatabase } from '../config/database';
import { v4 as uuidv4 } from 'uuid';
import { broadcastToFloor } from './floorManager';
import { clients } from './websocket';
import { ItemInstance, ItemInstanceData } from './item';

// Re-export the interface for backward compatibility
export type ItemInterface = ItemInstanceData;

export interface ItemTemplate {
  _id?: string;
  category: string;
  name: string;
  possibleMaterials: string[];
}

export class ItemService {
  private readonly CUBE_SIZE = 5;
  private activeItems: Map<string, ItemInstance> = new Map(); // Track active item instances

  constructor() {
    // Service manages item instances
  }

  /**
   * Check if there are items on a floor (that are not picked up)
   */
  async hasItemsOnFloor(floorName: string): Promise<boolean> {
    const db = getDatabase();
    const count = await db.collection('itemInstances').countDocuments({ 
      floor: floorName,
      owner: null,
      inWorld: true
    });
    return count > 0;
  }

  /**
   * Get item counts by floor (only returns floors with items)
   */
  async getItemCountsByFloor(): Promise<{ totalItems: number; itemsByFloor: Record<string, number> }> {
    const db = getDatabase();
    
    // Aggregate items by floor using MongoDB aggregation
    const itemCountsByFloor = await db.collection('itemInstances').aggregate([
      {
        $match: {
          owner: null,
          inWorld: true
        }
      },
      {
        $group: {
          _id: '$floor',
          count: { $sum: 1 }
        }
      },
      {
        $project: {
          _id: 0,
          floor: '$_id',
          itemCount: '$count'
        }
      }
    ]).toArray();

    // Convert to key-value pairs for easier consumption
    const itemsByFloor: Record<string, number> = {};
    let totalItems = 0;

    itemCountsByFloor.forEach(floor => {
      itemsByFloor[floor.floor] = floor.itemCount;
      totalItems += floor.itemCount;
    });

    return {
      totalItems,
      itemsByFloor
    };
  }

  /**
   * Get all item templates from the database
   */
  async getItemTemplates(): Promise<ItemTemplate[]> {
    const db = getDatabase();
    const itemTemplates = await db.collection('itemTemplates').find({}).toArray();
    return itemTemplates.map(template => ({
      _id: template._id.toString(),
      category: template.category,
      name: template.name,
      possibleMaterials: template.possibleMaterials
    }));
  }

  /**
   * Get a random item template
   */
  private async getRandomItemTemplate(): Promise<ItemTemplate> {
    const itemTemplates = await this.getItemTemplates();
    if (itemTemplates.length === 0) {
      throw new Error('No item templates found in database');
    }
    const randomIndex = Math.floor(Math.random() * itemTemplates.length);
    return itemTemplates[randomIndex];
  }

  /**
   * Get a random material from the template's possible materials
   */
  private getRandomMaterial(possibleMaterials: string[]): string {
    const randomIndex = Math.floor(Math.random() * possibleMaterials.length);
    return possibleMaterials[randomIndex];
  }

  /**
   * Get a random make
   */
  private getRandomMake(): string {
    const makes = ['orcish', 'elvish', 'human'];
    const randomIndex = Math.floor(Math.random() * makes.length);
    return makes[randomIndex];
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
   * Generate item stats based on category and material
   */
  private generateItemStats(template: ItemTemplate, material: string): {
    value: number;
    weight: number;
    weaponStats?: { type: string; powerMultiplier: number; dexterityMultiplier: number };
    armorStats?: { defenseMultiplier: number; speedMultiplier: number; manaMultiplier: number };
  } {
    // Base values that vary by material
    const materialMultipliers: Record<string, number> = {
      'Wood': 0.5, 'Cloth': 0.3, 'Leather': 0.7,
      'Copper': 1.0, 'Bronze': 1.2, 'Iron': 1.5, 'Steel': 2.0, 'Mythril': 3.0,
      'Silver': 2.5, 'Gold': 4.0, 'Platinum': 6.0, 'Jade': 5.0
    };

    const baseMultiplier = materialMultipliers[material] || 1.0;
    
    // Category-specific base values
    let baseValue = 10;
    let baseWeight = 1.0;
    let weaponStats: { type: string; powerMultiplier: number; dexterityMultiplier: number } | undefined;
    let armorStats: { defenseMultiplier: number; speedMultiplier: number; manaMultiplier: number } | undefined;

    // Set base values based on category
    switch (template.category) {
      case 'Ring':
      case 'Amulet':
        baseValue = 50;
        baseWeight = 0.1;
        break;
      case 'Chest armor':
        baseValue = 100;
        baseWeight = 5.0;
        armorStats = {
          defenseMultiplier: baseMultiplier * 1.5,
          speedMultiplier: Math.max(0.5, 1.0 - (baseMultiplier * 0.1)),
          manaMultiplier: 1.0
        };
        break;
      case 'Head armor':
        baseValue = 75;
        baseWeight = 2.0;
        armorStats = {
          defenseMultiplier: baseMultiplier * 1.2,
          speedMultiplier: Math.max(0.5, 1.0 - (baseMultiplier * 0.05)),
          manaMultiplier: 1.0
        };
        break;
      case 'Cloak':
      case 'Leg armor':
      case 'Shoes':
        baseValue = 60;
        baseWeight = 3.0;
        armorStats = {
          defenseMultiplier: baseMultiplier * 1.0,
          speedMultiplier: Math.max(0.5, 1.0 - (baseMultiplier * 0.03)),
          manaMultiplier: 1.0
        };
        break;
      case 'Gloves':
        baseValue = 40;
        baseWeight = 1.5;
        armorStats = {
          defenseMultiplier: baseMultiplier * 0.8,
          speedMultiplier: Math.max(0.5, 1.0 - (baseMultiplier * 0.02)),
          manaMultiplier: 1.0
        };
        break;
      case 'Shield':
        baseValue = 80;
        baseWeight = 4.0;
        armorStats = {
          defenseMultiplier: baseMultiplier * 2.0,
          speedMultiplier: Math.max(0.5, 1.0 - (baseMultiplier * 0.15)),
          manaMultiplier: 1.0
        };
        break;
      case 'Range Weapon':
        baseValue = 120;
        baseWeight = 2.5;
        weaponStats = {
          type: 'ranged',
          powerMultiplier: baseMultiplier * 1.2,
          dexterityMultiplier: baseMultiplier * 1.5
        };
        break;
      case 'Melee Weapon':
        baseValue = 100;
        baseWeight = 3.5;
        weaponStats = {
          type: 'melee',
          powerMultiplier: baseMultiplier * 1.5,
          dexterityMultiplier: baseMultiplier * 1.0
        };
        break;
      case 'Magic Weapon':
        baseValue = 150;
        baseWeight = 2.0;
        weaponStats = {
          type: 'magic',
          powerMultiplier: baseMultiplier * 1.8,
          dexterityMultiplier: baseMultiplier * 0.8
        };
        break;
    }

    return {
      value: Math.round(baseValue * baseMultiplier),
      weight: Math.round(baseWeight * baseMultiplier * 10) / 10, // Round to 1 decimal
      weaponStats,
      armorStats
    };
  }

  /**
   * Create a new item instance
   */
  async createItem(
    floorName: string,
    tileX: number,
    tileY: number,
    template: ItemTemplate,
    floorTiles: Array<{ x: number; y: number }>
  ): Promise<ItemInstanceData> {
    const db = getDatabase();
    
    const { worldX, worldY } = this.tileToWorldCoordinates(tileX, tileY);
    const material = this.getRandomMaterial(template.possibleMaterials);
    const make = this.getRandomMake();
    const stats = this.generateItemStats(template, material);
    
    const itemData: ItemInstanceData = {
      id: uuidv4(),
      itemTemplateId: template._id!,
      material,
      make,
      location: { x: worldX, y: worldY },
      inWorld: true,
      owner: null,
      alignment: Math.floor(Math.random() * 21) - 10, // -10 to +10
      spawnDatetime: new Date(),
      enchantments: [], // Start with no enchantments
      value: stats.value,
      name: `${make} ${material} ${template.name}`,
      weight: stats.weight,
      floor: floorName,
      weaponStats: stats.weaponStats,
      armorStats: stats.armorStats
    };

    await db.collection('itemInstances').insertOne(itemData);
    
    // Create and initialize the item instance
    const item = new ItemInstance(itemData, floorTiles, (itemId) => {
      // Callback to remove from active items when despawned
      this.removeActiveItem(itemId);
    });
    this.activeItems.set(itemData.id, item);
    item.init(); // Start the item thread
    
    // Send WebSocket message to all clients on this floor about the new item
    broadcastToFloor(floorName, {
      type: 'item-spawned',
      data: {
        item: itemData
      }
    }, clients);
    
    console.log(`Created item ${itemData.name} with ID ${itemData.id} on floor ${floorName} at world position (${worldX}, ${worldY})`);
    
    return itemData;
  }

  /**
   * Spawn 5 items on a floor at random floor tile positions
   */
  async spawnItemsOnFloor(floorName: string, floorTiles: Array<{ x: number; y: number }>): Promise<ItemInstanceData[]> {
    if (floorTiles.length === 0) {
      throw new Error(`No floor tiles available for spawning items on floor ${floorName}`);
    }

    const items: ItemInstanceData[] = [];

    for (let i = 0; i < 5; i++) {
      // Get a random item template
      const template = await this.getRandomItemTemplate();
      
      // Simply select a random floor tile
      const randomIndex = Math.floor(Math.random() * floorTiles.length);
      const selectedTile = floorTiles[randomIndex];

      // Create the item at the selected tile position
      const item = await this.createItem(floorName, selectedTile.x, selectedTile.y, template, floorTiles);
      items.push(item);
    }

    console.log(`Spawned ${items.length} items on floor ${floorName}`);
    return items;
  }

  /**
   * Pick up an item (set owner and remove from world)
   */
  async pickupItem(itemId: string, playerId: string): Promise<boolean> {
    const db = getDatabase();
    
    const result = await db.collection('itemInstances').updateOne(
      { id: itemId, owner: null, inWorld: true },
      { 
        $set: { 
          owner: playerId,
          inWorld: false
        }
      }
    );

    if (result.modifiedCount > 0) {
      // Stop the despawn timer for this item
      const itemInstance = this.activeItems.get(itemId);
      if (itemInstance) {
        itemInstance.stopTimer();
      }
      
      console.log(`Item ${itemId} picked up by player ${playerId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get active item instance by ID
   */
  getActiveItem(itemId: string): ItemInstance | undefined {
    return this.activeItems.get(itemId);
  }

  /**
   * Get all items on a specific floor (that are in world and not picked up)
   */
  async getItemsOnFloor(floorName: string): Promise<ItemInstanceData[]> {
    const db = getDatabase();
    const items = await db.collection('itemInstances').find({ 
      floor: floorName,
      owner: null,
      inWorld: true
    }).toArray();
    
    return items.map(item => ({
      id: item.id,
      itemTemplateId: item.itemTemplateId,
      material: item.material,
      make: item.make,
      location: item.location,
      inWorld: item.inWorld,
      owner: item.owner,
      alignment: item.alignment,
      spawnDatetime: item.spawnDatetime,
      enchantments: item.enchantments,
      value: item.value,
      name: item.name,
      weight: item.weight,
      floor: item.floor,
      weaponStats: item.weaponStats,
      armorStats: item.armorStats
    }));
  }

  /**
   * Cleanup method to clear all active item instances (useful for graceful shutdown)
   */
  cleanup(): void {
    // Tell all active items to despawn
    this.activeItems.forEach(async (item, itemId) => {
      if (!item.isDespawnedState()) {
        await item.delete();
      }
      console.log(`Cleaned up item ${itemId}`);
    });
    this.activeItems.clear();
  }

  /**
   * Remove an item from the active items tracking (called when item despawns itself)
   */
  removeActiveItem(itemId: string): void {
    this.activeItems.delete(itemId);
  }
}
