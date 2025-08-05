import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './authService';
import { PlayerService } from './playerService';
import { GameMessage, WebSocketClient, GameState, Player, Position } from '../types/game';

const authService = new AuthService();
const playerService = new PlayerService();
const clients = new Map<string, WebSocketClient>();
const gameState: GameState = {
  players: new Map<string, Player>(),
  gameStarted: true,
  lastUpdate: new Date(),
};

// Rate limiting for movement updates
const MOVEMENT_UPDATE_RATE_LIMIT = 30; // Max updates per second per player
const moveUpdateTimestamps = new Map<string, number[]>(); // clientId -> array of timestamps

// Helper function to check if client can send movement update
function canSendMovementUpdate(clientId: string): boolean {
  const now = Date.now();
  const timestamps = moveUpdateTimestamps.get(clientId) || [];
  
  // Remove timestamps older than 1 second
  const recentTimestamps = timestamps.filter(timestamp => now - timestamp < 1000);
  
  // Check if under rate limit
  if (recentTimestamps.length >= MOVEMENT_UPDATE_RATE_LIMIT) {
    return false;
  }
  
  // Add current timestamp and update map
  recentTimestamps.push(now);
  moveUpdateTimestamps.set(clientId, recentTimestamps);
  
  return true;
}

// Helper function to create safe player data for broadcasting (removes sensitive info)
function createSafePlayerData(player: Player): Partial<Player> {
  return {
    id: player.id,
    position: player.position,
    rotation: player.rotation,
    health: player.health,
    maxHealth: player.maxHealth,
    level: player.level,
    experience: player.experience,
    lastUpdate: player.lastUpdate,
    isOnline: player.isOnline,
    // Explicitly exclude userId, username, and email
  };
}

export function setupWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    const clientId = uuidv4();
    const client: WebSocketClient = {
      id: clientId,
      ws,
      isAuthenticated: false,
      lastPing: new Date(),
    };

    clients.set(clientId, client);
    console.log(`New WebSocket connection: ${clientId}`);

    // Set up message handling
    ws.on('message', async (data: Buffer) => {
      try {
        const message: GameMessage = JSON.parse(data.toString());
        await handleMessage(clientId, message);
      } catch (error) {
        console.error('Error parsing message:', error);
        sendErrorMessage(clientId, 'Invalid message format');
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
    sendMessage(clientId, {
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
      case 'connect':
        await handleConnect(clientId, message.data as unknown as ConnectData);
        break;

      case 'player_move':
        await handlePlayerMove(clientId, message.data as unknown as MoveData);
        break;

      case 'player_action':
        await handlePlayerAction(clientId, message.data as unknown as ActionData);
        break;

      case 'ping':
        handlePing(clientId);
        break;

      default:
        console.log(`Unknown message type: ${message.type}`);
        sendErrorMessage(clientId, `Unknown message type: ${message.type}`);
    }
  } catch (error) {
    console.error(`Error handling message ${message.type}:`, error);
    sendErrorMessage(clientId, 'Error processing message');
  }
}

interface ConnectData {
  token?: string;
  authToken?: string;
  userId?: string;
  playerId?: string;
  userEmail?: string;
  userName?: string;
  position?: Position;
  rotation?: Position;
}

async function handleConnect(clientId: string, data: ConnectData): Promise<void> {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  console.log(`Handling connect for client ${clientId} with data:`, JSON.stringify(data, null, 2));

  try {
    let userId: string | null = null;
    let userEmail: string | null = null;
    let userName: string | null = null;

    // Check for Firebase token first (preferred method)
    const token = data.token || data.authToken;
    if (token) {
      console.log(`Attempting token verification for client ${clientId}`);
      const user = await authService.verifyToken(token);
      if (user) {
        userId = user.uid;
        userEmail = user.email || null;
        userName = user.name || null;
        console.log(`Token verification successful for user: ${userId}`);
      } else {
        console.log(`Token verification failed for client ${clientId}`);
      }
    }
    
    // Fallback: use userId and userEmail directly (for development)
    if (!userId && (data.userId || data.playerId)) {
      console.log(`Using fallback authentication for client ${clientId}`);
      userId = data.userId || data.playerId || null;
      userEmail = data.userEmail || null;
      userName = data.userName || (userEmail ? userEmail.split('@')[0] : 'Player');
    }

    // If we have a valid user ID, proceed with authentication
    if (userId) {
      client.userId = userId;
      client.isAuthenticated = true;

      // Get or create player
      let player = await playerService.getPlayer(userId);
      if (!player) {
        const displayName = userName || (userEmail ? userEmail.split('@')[0] : 'Player');
        player = await playerService.createPlayer(userId, displayName, userEmail || undefined);
        console.log(`Created new player: ${displayName} (${userId})`);
      } else {
        console.log(`Found existing player: ${player.username} (${userId})`);
      }

      // Update player position and rotation if provided in connect data
      if (data.position && typeof data.position.x === 'number' && typeof data.position.y === 'number' && typeof data.position.z === 'number') {
        player.position = data.position;
        
        if (data.rotation && typeof data.rotation.x === 'number' && typeof data.rotation.y === 'number' && typeof data.rotation.z === 'number') {
          player.rotation = data.rotation;
          await playerService.updatePlayerPositionAndRotation(userId, data.position, data.rotation);
          console.log(`Updated player position and rotation:`, data.position, data.rotation);
        } else {
          await playerService.updatePlayerPosition(userId, data.position);
          console.log(`Updated player position to:`, data.position);
        }
      }

      // Set player online
      await playerService.setPlayerOnlineStatus(userId, true);
      client.playerId = player.id;
      gameState.players.set(player.id, player);

      // Send success response
      sendMessage(clientId, {
        type: 'connect_success',
        data: {
          player, // Send full player data to the connecting user
          gameState: {
            players: Array.from(gameState.players.values()).map(createSafePlayerData), // Send safe data for others
            gameStarted: gameState.gameStarted,
          },
        },
      });

      // Send current players list to the new client
      const otherPlayers = Array.from(gameState.players.values())
        .filter(p => p.id !== player.id)
        .map(createSafePlayerData); // Use safe data for other players

      if (otherPlayers.length > 0) {
        sendMessage(clientId, {
          type: 'players_list',
          data: {
            players: otherPlayers // Already using safe data
          },
        });
      }

      // Broadcast player joined to other clients
      broadcastToOthers(clientId, {
        type: 'player_joined',
        data: createSafePlayerData(player), // Use safe data when broadcasting to others
      });

      console.log(`Player connected successfully: ${player.username} (${userId})`);
    } else {
      console.log(`Authentication failed for client ${clientId} - no valid credentials provided`);
      sendErrorMessage(clientId, 'Authentication failed: Please provide a valid token or user credentials');
    }
  } catch (error) {
    console.error(`Connect error for client ${clientId}:`, error);
    sendErrorMessage(clientId, 'Connection failed due to server error');
  }
}

interface MoveData {
  position: Position;
  rotation?: Position;
}

interface MoveBroadcastData extends Record<string, unknown> {
  playerId: string;
  position: Position;
  rotation?: Position;
  timestamp: Date;
}

async function handlePlayerMove(clientId: string, data: MoveData): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated || !client.userId) {
    sendErrorMessage(clientId, 'Not authenticated');
    return;
  }

  // Check rate limit
  if (!canSendMovementUpdate(clientId)) {
    // Silently drop the update if rate limited - no need to send error
    return;
  }

  try {
    const { position, rotation } = data;
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      sendErrorMessage(clientId, 'Invalid position data');
      return;
    }

    console.log(`Player ${client.playerId} moving to position:`, position, rotation ? `with rotation:` : '', rotation);

    // Update player position and rotation in database
    if (rotation && typeof rotation.x === 'number' && typeof rotation.y === 'number' && typeof rotation.z === 'number') {
      await playerService.updatePlayerPositionAndRotation(client.userId, position, rotation);
    } else {
      await playerService.updatePlayerPosition(client.userId, position);
    }

    // Update game state
    const player = gameState.players.get(client.playerId!);
    if (player) {
      player.position = position;
      if (rotation) {
        player.rotation = rotation;
      }
      player.lastUpdate = new Date();
    }

    // Broadcast position update to other clients
    const broadcastData: MoveBroadcastData = {
      playerId: client.playerId!,
      position,
      timestamp: new Date(),
    };
    
    if (rotation) {
      broadcastData.rotation = rotation;
    }

    broadcastToOthers(clientId, {
      type: 'player_moved',
      data: broadcastData,
    });
  } catch (error) {
    console.error('Player move error:', error);
    sendErrorMessage(clientId, 'Error updating position');
  }
}

interface ActionData {
  action: string;
  target?: string;
  data?: Record<string, unknown>;
}

async function handlePlayerAction(clientId: string, data: ActionData): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated) {
    sendErrorMessage(clientId, 'Not authenticated');
    return;
  }

  // Handle different player actions (attack, interact, etc.)
  console.log(`Player action from ${clientId}:`, data);
  
  // Broadcast action to other clients
  broadcastToOthers(clientId, {
    type: 'player_action',
    data: {
      playerId: client.playerId,
      action: data,
      timestamp: new Date(),
    },
  });
}

function handlePing(clientId: string): void {
  const client = clients.get(clientId);
  if (client) {
    client.lastPing = new Date();
    sendMessage(clientId, {
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
    moveUpdateTimestamps.delete(clientId);

    // Set player offline if authenticated
    if (client.userId) {
      try {
        await playerService.setPlayerOnlineStatus(client.userId, false);
        
        // Remove from game state
        if (client.playerId) {
          gameState.players.delete(client.playerId);
        }

        // Broadcast player left to other clients
        broadcastToOthers(clientId, {
          type: 'player_left',
          data: { playerId: client.playerId },
        });
      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }

    clients.delete(clientId);
  }
}

function sendMessage(clientId: string, message: GameMessage): void {
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    const messageWithTimestamp = {
      ...message,
      timestamp: new Date(),
    };
    client.ws.send(JSON.stringify(messageWithTimestamp));
  }
}

function sendErrorMessage(clientId: string, error: string): void {
  sendMessage(clientId, {
    type: 'error',
    data: { message: error },
  });
}

function broadcastToAll(message: GameMessage): void {
  const messageWithTimestamp = {
    ...message,
    timestamp: new Date(),
  };
  const messageString = JSON.stringify(messageWithTimestamp);

  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageString);
    }
  });
}

function broadcastToOthers(excludeClientId: string, message: GameMessage): void {
  const messageWithTimestamp = {
    ...message,
    timestamp: new Date(),
  };
  const messageString = JSON.stringify(messageWithTimestamp);

  clients.forEach((client, clientId) => {
    if (clientId !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageString);
    }
  });
}

function broadcastGameState(): void {
  if (gameState.players.size === 0) {
    return;
  }

  broadcastToAll({
    type: 'game_state',
    data: {
      players: Array.from(gameState.players.values()).map(createSafePlayerData), // Use safe data
      gameStarted: gameState.gameStarted,
      lastUpdate: gameState.lastUpdate,
    },
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
