export interface Player {
  id: string;
  userId: string;
  username: string;
  email?: string;
  position: Position;
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
  worldData?: any;
  players: Map<string, Player>;
  gameStarted: boolean;
  lastUpdate: Date;
}

export interface GameMessage {
  type: string;
  data: any;
  timestamp?: Date;
}

export interface WebSocketClient {
  id: string;
  ws: any; // WebSocket type
  userId?: string;
  playerId?: string;
  isAuthenticated: boolean;
  lastPing: Date;
}
