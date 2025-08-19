import { FloorTile, CubePosition, StairTile } from '../types/floorGeneration';

export interface WallGenerationOptions {
  includeCorners?: boolean;
  includeCeiling?: boolean;
}

/**
 * Server-side wall generation for dungeon floors
 */
export class WallGenerator {
  private static readonly DEFAULT_OPTIONS: Required<WallGenerationOptions> = {
    includeCorners: true,
    includeCeiling: true
  };

  /**
   * Generate wall tile positions around floor tiles
   */
  static generateWalls(
    floorTiles: FloorTile[],
    excludedPositions: CubePosition[] = [],
    options: WallGenerationOptions = {}
  ): CubePosition[] {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    // Create a set of floor positions for quick lookup
    const floorPositions = new Set<string>();
    floorTiles.forEach(tile => {
      floorPositions.add(`${tile.x},${tile.y}`);
    });

    // Create a set of excluded positions (like stairs)
    const excludedPositions_set = new Set<string>();
    excludedPositions.forEach(pos => {
      excludedPositions_set.add(`${pos.x},${pos.y}`);
    });

    const wallTiles: CubePosition[] = [];
    const wallPositions = new Set<string>();

    // For each floor tile, check adjacent positions for walls
    floorTiles.forEach(tile => {
      // Check 8 directions around each floor tile (including diagonals if includeCorners is true)
      const directions = opts.includeCorners 
        ? [
            // Cardinal directions
            { x: 0, y: 1 },   // North
            { x: 1, y: 0 },   // East
            { x: 0, y: -1 },  // South
            { x: -1, y: 0 },  // West
            // Diagonal directions
            { x: 1, y: 1 },   // Northeast
            { x: 1, y: -1 },  // Southeast
            { x: -1, y: -1 }, // Southwest
            { x: -1, y: 1 }   // Northwest
          ]
        : [
            // Cardinal directions only
            { x: 0, y: 1 },   // North
            { x: 1, y: 0 },   // East
            { x: 0, y: -1 },  // South
            { x: -1, y: 0 }   // West
          ];

      directions.forEach(dir => {
        const wallX = tile.x + dir.x;
        const wallY = tile.y + dir.y;
        const wallKey = `${wallX},${wallY}`;

        // Add wall if:
        // 1. Position is not already a floor tile
        // 2. Position is not excluded (like a stair)
        // 3. Position is not already a wall
        if (!floorPositions.has(wallKey) && 
            !excludedPositions_set.has(wallKey) && 
            !wallPositions.has(wallKey)) {
          wallTiles.push({ x: wallX, y: wallY });
          wallPositions.add(wallKey);
        }
      });
    });

    console.log(`🧱 Generated ${wallTiles.length} wall tiles around ${floorTiles.length} floor tiles`);
    return wallTiles;
  }

  /**
   * Generate stair tile positions from rooms
   */
  static generateStairTiles(
    rooms: Array<{
      id: string;
      name: string;
      position: { x: number; y: number };
      hasUpwardStair?: boolean;
      hasDownwardStair?: boolean;
      stairLocationX?: number;
      stairLocationY?: number;
    }>
  ): { upwardStairs: StairTile[]; downwardStairs: StairTile[] } {
    const upwardStairs: StairTile[] = [];
    const downwardStairs: StairTile[] = [];

    rooms.forEach(room => {
      if ((room.hasUpwardStair || room.hasDownwardStair) && 
          room.stairLocationX !== undefined && 
          room.stairLocationY !== undefined) {
        
        const stairTile = {
          x: room.position.x + room.stairLocationX,
          y: room.position.y + room.stairLocationY,
          room_id: room.id,
          room_name: room.name
        };

        if (room.hasUpwardStair) {
          upwardStairs.push(stairTile);
        }
        if (room.hasDownwardStair) {
          downwardStairs.push(stairTile);
        }
      }
    });

    console.log(`🪜 Generated ${upwardStairs.length} upward stairs and ${downwardStairs.length} downward stairs`);
    return { upwardStairs, downwardStairs };
  }

  /**
   * Remove duplicate tiles from an array
   */
  static removeDuplicates(tiles: CubePosition[]): CubePosition[] {
    const uniqueTiles = new Map<string, CubePosition>();
    
    tiles.forEach(tile => {
      const key = `${tile.x},${tile.y}`;
      uniqueTiles.set(key, tile);
    });
    
    return Array.from(uniqueTiles.values());
  }
}
