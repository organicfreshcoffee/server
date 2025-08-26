/**
 * Types for server-side floor generation
 * Adapted from client-side floorGenerator.ts and hallwayGenerator.ts
 */

export interface Vector2 {
  x: number;
  y: number;
}

export interface CubePosition {
  x: number;
  y: number;
}

export interface StairTile extends CubePosition {
  room_id: string;
  room_name: string;
}

// Floor tile with type information for proper texturing
export interface FloorTile extends CubePosition {
  type: 'room' | 'hallway';
}

export interface ServerRoom {
  id: string;
  name: string;
  position: Vector2;
  width: number;
  height: number;
  hasUpwardStair: boolean;
  hasDownwardStair: boolean;
  stairLocationX?: number;
  stairLocationY?: number;
  children: string[];
  parentDirection?: 'left' | 'right' | 'center';
  parentDoorOffset?: number;
  doorSide?: 'top' | 'right' | 'bottom' | 'left';
  doorPosition?: Vector2;
}

export interface FloorHallwaySegment {
  start: Vector2;
  end: Vector2;
  direction: Vector2;
  length: number;
}

export interface ServerHallway {
  id: string;
  name: string;
  length: number;
  parentDirection?: 'left' | 'right' | 'center';
  parentDoorOffset?: number;
  children: string[];
  startPosition?: Vector2;
  endPosition?: Vector2;
  direction?: Vector2;
  segments?: FloorHallwaySegment[];
}

export interface FloorBounds {
  width: number;
  height: number;
}

export interface ServerFloorLayout {
  dungeonDagNodeName: string;
  rooms: ServerRoom[];
  hallways: ServerHallway[];
  bounds: FloorBounds;
  nodeMap: Map<string, ServerRoom | ServerHallway>;
  rootNode: string;
}

export interface GeneratedFloorData {
  dungeonDagNodeName: string;
  rooms: ServerRoom[];
  hallways: ServerHallway[];
  bounds: FloorBounds;
  rootNode: string;
  floorTiles: FloorTile[];
  roomTiles: Map<string, FloorTile[]>;
  hallwayTiles: Map<string, FloorTile[]>;
}

// New interface for complete tile data with rendering coordinates
export interface FloorTileCoordinates {
  floorTiles: FloorTile[];
  wallTiles: CubePosition[];
  upwardStairTiles: StairTile[];
  downwardStairTiles: StairTile[];
}

export interface GeneratedFloorTileData {
  dungeonDagNodeName: string;
  bounds: FloorBounds;
  tiles: FloorTileCoordinates;
}

export interface HallwayGenerationOptions {
  width?: number;
  cornerRadius?: number;
  minimizeOverlaps?: boolean;
  excludePositions?: CubePosition[];
}
