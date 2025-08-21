import { Position } from '../types/game';

export interface MoveData {
  playerId?: string; // Firebase userId sent by client (validated against authenticated user)
  position: Position;
  rotation?: Position;
  character?: Record<string, unknown>;
  isMoving?: boolean;
  movementDirection?: 'forward' | 'backward' | 'none';
}

export interface MoveBroadcastData extends Record<string, unknown> {
  playerId: string; // MongoDB player.id (safe to expose to other players)
  position: Position;
  rotation?: Position;
  character: Record<string, unknown>; // Always included (required for consistent client state)
  isMoving?: boolean;
  movementDirection?: 'forward' | 'backward' | 'none';
  timestamp: Date;
}

export interface ActionData {
  action: string;
  target?: string;
  data?: Record<string, unknown>;
  playerId?: string; // Firebase user ID that may be included by client
}

export interface RespawnData {
  characterData?: Record<string, unknown>;
}

export interface SpellData {
  fromPosition: Position;
  toPosition: Position;
  spellRadius: number;
  direction?: Position;
  range?: number;
  timestamp?: number;
  casterPosition?: Position;
}
