// Shared service instances
import { DungeonService } from './dungeonService';
import { PlayerService } from './playerService';
import { EnemyService } from './enemyService';
import { ItemService } from './itemService';

// Create singleton instances
export const dungeonService = new DungeonService();
export const playerService = new PlayerService();
export const itemService = new ItemService();
export const enemyService = new EnemyService(itemService);

// Re-export types for convenience
export type { EnemyInterface, EnemyType } from './enemyService';
export type { EnemyData } from './enemy';
export type { ItemInterface, ItemTemplate } from './itemService';
export type { ItemInstanceData } from './item';
