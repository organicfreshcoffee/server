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
