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

export interface ServerFloorLayout {
  dungeonDagNodeName: string;
  rooms: ServerRoom[];
  hallways: ServerHallway[];
  bounds: { width: number; height: number };
  nodeMap: Map<string, ServerRoom | ServerHallway>;
  rootNode: string;
}

export interface GeneratedFloorData {
  dungeonDagNodeName: string;
  rooms: ServerRoom[];
  hallways: ServerHallway[];
  bounds: { width: number; height: number };
  rootNode: string;
  floorTiles: CubePosition[];
  roomTiles: Map<string, CubePosition[]>;
  hallwayTiles: Map<string, CubePosition[]>;
}

export interface HallwayGenerationOptions {
  width?: number;
  cornerRadius?: number;
  minimizeOverlaps?: boolean;
}
