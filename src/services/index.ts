// Shared service instances
import { DungeonService } from './dungeonService';
import { PlayerService } from './playerService';
import { EnemyService } from './enemyService';

// Create singleton instances
export const dungeonService = new DungeonService();
export const playerService = new PlayerService();
export const enemyService = new EnemyService();
