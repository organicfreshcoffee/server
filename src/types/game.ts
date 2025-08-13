import { WebSocket } from 'ws';

export interface Player {
  id: string;
  userId: string;
  username: string;
  email?: string;
  position: Position;
  rotation: Position; // Rotation in x, y, z axes
  health: number;
  maxHealth: number;
  level: number;
  experience: number;
  lastUpdate: Date;
  isOnline: boolean;
}

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface GameState {
  worldData?: Record<string, unknown>;
  players: Map<string, Player>;
  gameStarted: boolean;
  lastUpdate: Date;
}

export interface GameMessage {
  type: string;
  data: Record<string, unknown>;
  timestamp?: Date;
}

export interface WebSocketClient {
  id: string;
  ws: WebSocket; // WebSocket type
  userId?: string;
  playerId?: string;
  isAuthenticated: boolean;
  lastPing: Date;
}

// Dungeon Generation Types
export interface DungeonDagNode {
  name: string; // Primary key
  children: string[]; // Names of child nodes
  isDownwardsFromParent: boolean; // true if stair from parent to self is down stair
  isBossLevel: boolean; // if true and zero children, don't regenerate children
  parentFloorDagNodeName?: string; // name of the room in parent floor that has stairs leading to this dungeon node
}

export interface FloorDagNode {
  name: string; // Primary key
  dungeonDagNodeName: string; // Foreign key to DungeonDagNode
  children: string[]; // Names of child nodes
  isRoom: boolean; // true if room, false if hallway
  hasUpwardStair?: boolean; // null if hallway
  hasDownwardStair?: boolean; // null if hallway
  stairFloorDagName?: string; // reference to the room that the stair goes to
  stairDungeonDagName?: string; // reference to the floor that the stair goes to
  stairLocationX?: number; // width location of the stair if room has stair
  stairLocationY?: number; // height location of the stair if room has stair
  parentDirection?: 'left' | 'right' | 'center'; // direction relative to parent
  parentDoorOffset?: number; // offset along the side for doors (1 to min(width,height)-1)
  hallwayLength?: number; // length of hallway if hallway node
  roomWidth?: number; // width of room if room node
  roomHeight?: number; // height of room if room node
}

export interface FloorLayout {
  dungeonDagNodeName: string;
  nodes: FloorDagNode[];
}

export interface RoomStairs {
  upwardStair?: {
    floorDagNodeName: string;
    dungeonDagNodeName: string;
    locationX: number;
    locationY: number;
  };
  downwardStair?: {
    floorDagNodeName: string;
    dungeonDagNodeName: string;
    locationX: number;
    locationY: number;
  };
}
