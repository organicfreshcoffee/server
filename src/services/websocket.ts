/* eslint-disable no-console */
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './authService';
import { PlayerService } from './playerService';
import { DungeonService } from './dungeonService';
import { GameMessage, WebSocketClient, GameState, Player } from '../types/game';
import { MoveData, ActionData, RespawnData } from './gameTypes';
import { createSafePlayerData } from './gameUtils';
import { traceGameOperation, addSpanAttributes, addSpanEvent } from '../config/tracing';
import { 
  addClientToFloor, 
  removeClientFromFloor, 
  broadcastToFloor, 
  broadcastToFloorExcluding,
  getPlayersOnFloor,
  getTotalPlayerCount,
  getPlayerCountsByFloor,
  floorClients
} from './floorManager';
import {
  handlePlayerMove,
  handlePlayerAction,
  handlePlayerRespawn,
  cleanupRateLimitData
} from './gameHandlers';
import { enemyService } from './index';

const authService = new AuthService();
const playerService = new PlayerService();
const dungeonService = new DungeonService();
const clients = new Map<string, WebSocketClient>();

// Export clients for use in other modules
export { clients };

// Export gameState for use in other modules
export const gameState: GameState = {
  players: new Map<string, Player>(),
  gameStarted: true,
  lastUpdate: new Date(),
};

// Helper function to find existing client by player ID
function findClientByPlayerIdLocal(playerId: string): string | null {
  for (const [clientId, client] of clients.entries()) {
    if (client.playerId === playerId) {
      return clientId;
    }
  }
  return null;
}

// Local wrapper functions for compatibility
function sendMessageLocal(clientId: string, message: GameMessage): void {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    const messageWithTimestamp = {
      ...message,
      timestamp: new Date(),
    };
    client.ws.send(JSON.stringify(messageWithTimestamp));
  }
}

function sendErrorMessageLocal(clientId: string, error: string): void {
  sendMessageLocal(clientId, {
    type: 'error',
    data: { message: error },
  });
}

export function setupWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const clientId = uuidv4();
    const client: WebSocketClient = {
      id: clientId,
      ws,
      isAuthenticated: false,
      lastPing: new Date(),
    };

    clients.set(clientId, client);
    console.log(`New WebSocket connection: ${clientId}`);

    // Parse URL parameters for authentication
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const encodedToken = url.searchParams.get('token');

    // Decode the token safely
    const token = encodedToken ? decodeURIComponent(encodedToken) : null;

    // Authenticate immediately on connection
    if (token) {
      try {
        await handleAutoConnect(clientId, token);
      } catch (error) {
        console.error(`Auto-authentication failed for client ${clientId}:`, error);
        sendErrorMessageLocal(clientId, 'Authentication failed. Please check your token.');
        ws.close(1008, 'Authentication failed');
        return;
      }
    } else {
      console.log(`No token provided for client ${clientId}`);
      sendErrorMessageLocal(clientId, 'Authentication token required. Please connect with ?token=your-token');
      ws.close(1008, 'Token required');
      return;
    }

    // Set up message handling
    ws.on('message', async (data: Buffer) => {
      try {
        const message: GameMessage = JSON.parse(data.toString());
        await handleMessage(clientId, message);
      } catch (error) {
        console.error('Error parsing message:', error);
        sendErrorMessageLocal(clientId, 'Invalid message format');
      }
    });

    // Handle connection close
    ws.on('close', () => {
      handleDisconnect(clientId);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`WebSocket error for client ${clientId}:`, error);
      handleDisconnect(clientId);
    });

    // Send initial connection message
    sendMessageLocal(clientId, {
      type: 'connection_established',
      data: { clientId },
    });
  });

  // Set up periodic cleanup and game updates
  setInterval(() => {
    cleanupInactiveClients();
    broadcastGameState();
  }, 5000); // Every 5 seconds
}

async function handleMessage(clientId: string, message: GameMessage): Promise<void> {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  try {
    switch (message.type) {
      case 'player_move':
        await handlePlayerMove(clientId, message.data as unknown as MoveData, clients, gameState, playerService);
        break;

      case 'player_action':
        await handlePlayerAction(clientId, message.data as unknown as ActionData, clients, gameState, playerService, enemyService);
        break;

      case 'player_respawn':
        await handlePlayerRespawn(clientId, message.data as unknown as RespawnData, clients, gameState, playerService, dungeonService);
        break;

      case 'ping':
        handlePing(clientId);
        break;

      default:
        console.log(`Unknown message type: ${message.type}`);
        sendErrorMessageLocal(clientId, `Unknown message type: ${message.type}`);
    }
  } catch (error) {
    console.error(`Error handling message ${message.type}:`, error);
    sendErrorMessageLocal(clientId, 'Error processing message');
  }
}

async function handleAutoConnect(clientId: string, token: string): Promise<void> {
  const client = clients.get(clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  console.log(`Auto-connecting client ${clientId} with token`);

  try {
    // Verify Firebase token
    const user = await authService.verifyToken(token);
    if (!user) {
      throw new Error('Invalid token');
    }

    const userId = user.uid;
    const userEmail = user.email || null;
    const userName = user.name || null;

    console.log(`Token verification successful for user: ${userId}`);

    // Set client as authenticated
    client.userId = userId;
    client.userEmail = userEmail || undefined;
    client.userName = userName || undefined;
    client.isAuthenticated = true;

    // Get or create player
    let player = await playerService.getPlayer(userId);
    if (!player) {
      const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'Player');
      player = await playerService.createPlayer(userId, displayName, userEmail || undefined);
      console.log(`Created new player: ${displayName} (${userId})`);
    } else {
      console.log(`Found existing player: ${player.username} (${userId})`);
      console.log(`[CONNECTION DEBUG] Player character data:`, player.character);
    }

    // Set player online
    await playerService.setPlayerOnlineStatus(userId, true);
    
    // Check if this player is already connected and clean up old connection
    const existingClientId = findClientByPlayerIdLocal(player.id);
    if (existingClientId) {
      console.log(`Player ${player.username} already connected, cleaning up old connection: ${existingClientId}`);
      handleDisconnect(existingClientId);
    }
    
    client.playerId = player.id;
    gameState.players.set(player.id, player);
    console.log(`[CONNECTION DEBUG] Stored player in gameState with character:`, player.character);

    // Use player's current floor from database (defaults to 'A' if not set)
    const currentFloor = player.currentDungeonDagNodeName || 'A';
    player.currentDungeonDagNodeName = currentFloor;
    addClientToFloor(clientId, currentFloor, clients);

    // Send success response with floor-specific data
    sendMessageLocal(clientId, {
      type: 'connect_success',
      data: {
        player, // Send full player data to the connecting user
        gameState: {
          players: getPlayersOnFloor(currentFloor, clients, gameState), // Only players on the same floor
          gameStarted: gameState.gameStarted,
        },
      },
    });

    // Send current players list for this floor to the new client
    const playersOnFloor = getPlayersOnFloor(currentFloor, clients, gameState)
      .filter(p => p.id !== player.id);

    if (playersOnFloor.length > 0) {
      sendMessageLocal(clientId, {
        type: 'players_list',
        data: {
          players: playersOnFloor,
          floor: currentFloor,
        },
      });
    }

    // Broadcast player joined to other clients on the same floor
    broadcastToFloorExcluding(currentFloor, clientId, {
      type: 'player_joined',
      data: createSafePlayerData(player),
    }, clients);

    console.log(`Player auto-connected successfully: ${player.username} (${userId}) on floor ${currentFloor}`);
  } catch (error) {
    console.error(`Auto-connect error for client ${clientId}:`, error);
    throw error; // Re-throw so the connection handler can close the WebSocket
  }
}

function handlePing(clientId: string): void {
  const client = clients.get(clientId);
  if (client) {
    client.lastPing = new Date();
    sendMessageLocal(clientId, {
      type: 'pong',
      data: { timestamp: new Date() },
    });
  }
}

async function handleDisconnect(clientId: string): Promise<void> {
  const client = clients.get(clientId);
  if (client) {
    console.log(`Client disconnected: ${clientId}`);

    // Clean up rate limiting data
    cleanupRateLimitData(clientId);

    // Set player offline if authenticated
    if (client.userId) {
      try {
        await playerService.setPlayerOnlineStatus(client.userId, false);
        
        // Remove from game state
        if (client.playerId) {
          gameState.players.delete(client.playerId);
        }

        // Remove client from their floor and notify others on that floor
        const currentFloor = client.currentDungeonDagNodeName;
        if (currentFloor) {
          removeClientFromFloor(clientId, currentFloor, clients);
          
          // Broadcast player left to other clients on the same floor
          broadcastToFloor(currentFloor, {
            type: 'player_left',
            data: { 
              playerId: client.playerId,
              floor: currentFloor,
            },
          }, clients);
        }
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }

    clients.delete(clientId);
  }
}

function broadcastGameState(): void {
  if (gameState.players.size === 0) {
    return;
  }

  // Broadcast floor-specific game state to each floor
  floorClients.forEach((clientIds, dungeonDagNodeName) => {
    if (clientIds.size > 0) {
      const playersOnFloor = getPlayersOnFloor(dungeonDagNodeName, clients, gameState);
      
      console.log(`[GAME_STATE DEBUG] Broadcasting to floor ${dungeonDagNodeName}, ${playersOnFloor.length} players with character data:`, 
        playersOnFloor.map(p => ({ id: p.id, hasCharacter: !!p.character, character: p.character })));
      
      broadcastToFloor(dungeonDagNodeName, {
        type: 'game_state',
        data: {
          players: playersOnFloor,
          gameStarted: gameState.gameStarted,
          lastUpdate: gameState.lastUpdate,
          floor: dungeonDagNodeName,
        },
      }, clients);
    }
  });
}

function cleanupInactiveClients(): void {
  const now = new Date();
  const timeout = 30000; // 30 seconds

  clients.forEach((client, clientId) => {
    if (now.getTime() - client.lastPing.getTime() > timeout) {
      console.log(`Cleaning up inactive client: ${clientId}`);
      client.ws.terminate();
      handleDisconnect(clientId);
    }
  });
}

// Export function for REST endpoints to trigger floor changes
export async function changePlayerFloor(userId: string, newFloorName: string): Promise<{ success: boolean; message: string }> {
  try {
    // Find client by userId
    let targetClient: WebSocketClient | null = null;
    let targetClientId: string | null = null;
    
    for (const [clientId, client] of clients.entries()) {
      if (client.userId === userId) {
        targetClient = client;
        targetClientId = clientId;
        break;
      }
    }
    
    if (!targetClient || !targetClientId) {
      return { success: false, message: 'Player not connected via WebSocket' };
    }
    
    const oldFloor = targetClient.currentDungeonDagNodeName;
    
    // Update player's floor in database
    await playerService.updatePlayerFloor(userId, newFloorName);
    
    // Update game state
    const player = gameState.players.get(targetClient.playerId!);
    if (player) {
      player.currentDungeonDagNodeName = newFloorName;
    }
    
    // Move client to new floor room
    if (oldFloor) {
      removeClientFromFloor(targetClientId, oldFloor, clients);
    }
    addClientToFloor(targetClientId, newFloorName, clients);
    
    // Notify old floor that player left
    if (oldFloor) {
      broadcastToFloor(oldFloor, {
        type: 'player_left_floor',
        data: { 
          playerId: targetClient.playerId,
          fromFloor: oldFloor,
          toFloor: newFloorName,
        },
      }, clients);
    }
    
    // Notify new floor that player joined
    if (player) {
      broadcastToFloorExcluding(newFloorName, targetClientId, {
        type: 'player_joined_floor',
        data: {
          ...createSafePlayerData(player),
          fromFloor: oldFloor,
          toFloor: newFloorName,
        },
      }, clients);
    }
    
    console.log(`Player ${targetClient.playerId} changed from floor ${oldFloor} to ${newFloorName} via REST`);
    return { success: true, message: `Floor changed from ${oldFloor} to ${newFloorName}` };
    
  } catch (error) {
    console.error('REST floor change error:', error);
    return { success: false, message: 'Error changing floor' };
  }
}

// Re-export the utility functions for backward compatibility
export { getTotalPlayerCount, getPlayerCountsByFloor };
