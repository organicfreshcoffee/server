import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './authService';
import { PlayerService } from './playerService';
import { GameMessage, WebSocketClient, GameState, Player, Position } from '../types/game';

const authService = new AuthService();
const playerService = new PlayerService();
const clients = new Map<string, WebSocketClient>();
// Track clients by floor for efficient broadcasting
const floorClients = new Map<string, Set<string>>(); // dungeonDagNodeName -> Set of clientIds
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
    currentDungeonDagNodeName: player.currentDungeonDagNodeName,
    // Explicitly exclude userId, username, and email
  };
}

// Floor management functions
function addClientToFloor(clientId: string, dungeonDagNodeName: string): void {
  if (!floorClients.has(dungeonDagNodeName)) {
    floorClients.set(dungeonDagNodeName, new Set());
  }
  floorClients.get(dungeonDagNodeName)!.add(clientId);
  
  const client = clients.get(clientId);
  if (client) {
    client.currentDungeonDagNodeName = dungeonDagNodeName;
  }
}

function removeClientFromFloor(clientId: string, dungeonDagNodeName?: string): void {
  const client = clients.get(clientId);
  const floorName = dungeonDagNodeName || client?.currentDungeonDagNodeName;
  
  if (floorName && floorClients.has(floorName)) {
    floorClients.get(floorName)!.delete(clientId);
    
    // Clean up empty floor rooms to prevent memory leaks
    if (floorClients.get(floorName)!.size === 0) {
      floorClients.delete(floorName);
      console.log(`Cleaned up empty floor room: ${floorName}`);
    }
  }
  
  if (client) {
    client.currentDungeonDagNodeName = undefined;
  }
}

function moveClientToFloor(clientId: string, newDungeonDagNodeName: string): void {
  const client = clients.get(clientId);
  const oldFloor = client?.currentDungeonDagNodeName;
  
  // Remove from old floor
  if (oldFloor) {
    removeClientFromFloor(clientId, oldFloor);
  }
  
  // Add to new floor
  addClientToFloor(clientId, newDungeonDagNodeName);
  
  console.log(`Client ${clientId} moved from floor ${oldFloor || 'none'} to ${newDungeonDagNodeName}`);
}

// Floor-based broadcasting functions
function broadcastToFloor(dungeonDagNodeName: string, message: GameMessage): void {
  const messageWithTimestamp = {
    ...message,
    timestamp: new Date(),
  };
  const messageString = JSON.stringify(messageWithTimestamp);
  
  const floorClientIds = floorClients.get(dungeonDagNodeName);
  if (!floorClientIds) {
    return; // No clients on this floor
  }
  
  floorClientIds.forEach((clientId) => {
    const client = clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(messageString);
    }
  });
}

function broadcastToFloorExcluding(dungeonDagNodeName: string, excludeClientId: string, message: GameMessage): void {
  const messageWithTimestamp = {
    ...message,
    timestamp: new Date(),
  };
  const messageString = JSON.stringify(messageWithTimestamp);
  
  const floorClientIds = floorClients.get(dungeonDagNodeName);
  if (!floorClientIds) {
    return; // No clients on this floor
  }
  
  floorClientIds.forEach((clientId) => {
    if (clientId !== excludeClientId) {
      const client = clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageString);
      }
    }
  });
}

function getPlayersOnFloor(dungeonDagNodeName: string): Partial<Player>[] {
  const floorClientIds = floorClients.get(dungeonDagNodeName);
  if (!floorClientIds) {
    return [];
  }
  
  const playersOnFloor: Partial<Player>[] = [];
  floorClientIds.forEach((clientId) => {
    const client = clients.get(clientId);
    if (client && client.playerId) {
      const player = gameState.players.get(client.playerId);
      if (player) {
        playersOnFloor.push(createSafePlayerData(player));
      }
    }
  });
  
  return playersOnFloor;
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
    const dungeonDagNodeName = url.searchParams.get('floor') || 'A'; // Default to root floor

    // Decode the token safely
    const token = encodedToken ? decodeURIComponent(encodedToken) : null;

    // Authenticate immediately on connection
    if (token) {
      try {
        await handleAutoConnect(clientId, token, dungeonDagNodeName);
      } catch (error) {
        console.error(`Auto-authentication failed for client ${clientId}:`, error);
        sendErrorMessage(clientId, 'Authentication failed. Please check your token.');
        ws.close(1008, 'Authentication failed');
        return;
      }
    } else {
      console.log(`No token provided for client ${clientId}`);
      sendErrorMessage(clientId, 'Authentication token required. Please connect with ?token=your-token');
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
  dungeonDagNodeName?: string; // Initial floor
}

// Legacy handleConnect function - kept for backward compatibility
// Note: This is no longer used with URL parameter authentication
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

      // Handle floor assignment - use provided floor or default to 'A' (root floor)
      const initialFloor = data.dungeonDagNodeName || player.currentDungeonDagNodeName || 'A';
      player.currentDungeonDagNodeName = initialFloor;
      addClientToFloor(clientId, initialFloor);
      
      // Update player's floor in database if it's different from stored value
      const storedPlayer = await playerService.getPlayer(userId);
      if (storedPlayer && player.currentDungeonDagNodeName !== storedPlayer.currentDungeonDagNodeName) {
        await playerService.updatePlayerFloor(userId, initialFloor);
      }

      // Send success response with floor-specific data
      sendMessage(clientId, {
        type: 'connect_success',
        data: {
          player, // Send full player data to the connecting user
          gameState: {
            players: getPlayersOnFloor(initialFloor), // Only players on the same floor
            gameStarted: gameState.gameStarted,
          },
        },
      });

      // Send current players list for this floor to the new client
      const playersOnFloor = getPlayersOnFloor(initialFloor)
        .filter(p => p.id !== player.id);

      if (playersOnFloor.length > 0) {
        sendMessage(clientId, {
          type: 'players_list',
          data: {
            players: playersOnFloor,
            floor: initialFloor,
          },
        });
      }

      // Broadcast player joined to other clients on the same floor
      broadcastToFloorExcluding(initialFloor, clientId, {
        type: 'player_joined',
        data: createSafePlayerData(player),
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

async function handleAutoConnect(clientId: string, token: string, dungeonDagNodeName: string): Promise<void> {
  const client = clients.get(clientId);
  if (!client) {
    throw new Error('Client not found');
  }

  console.log(`Auto-connecting client ${clientId} to floor ${dungeonDagNodeName} with token`);

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

    // Set player online and assign to floor
    await playerService.setPlayerOnlineStatus(userId, true);
    client.playerId = player.id;
    gameState.players.set(player.id, player);

    // Handle floor assignment
    player.currentDungeonDagNodeName = dungeonDagNodeName;
    addClientToFloor(clientId, dungeonDagNodeName);
    
    // Update player's floor in database if different
    const storedPlayer = await playerService.getPlayer(userId);
    if (storedPlayer && player.currentDungeonDagNodeName !== storedPlayer.currentDungeonDagNodeName) {
      await playerService.updatePlayerFloor(userId, dungeonDagNodeName);
    }

    // Send success response with floor-specific data
    sendMessage(clientId, {
      type: 'connect_success',
      data: {
        player, // Send full player data to the connecting user
        gameState: {
          players: getPlayersOnFloor(dungeonDagNodeName), // Only players on the same floor
          gameStarted: gameState.gameStarted,
        },
      },
    });

    // Send current players list for this floor to the new client
    const playersOnFloor = getPlayersOnFloor(dungeonDagNodeName)
      .filter(p => p.id !== player.id);

    if (playersOnFloor.length > 0) {
      sendMessage(clientId, {
        type: 'players_list',
        data: {
          players: playersOnFloor,
          floor: dungeonDagNodeName,
        },
      });
    }

    // Broadcast player joined to other clients on the same floor
    broadcastToFloorExcluding(dungeonDagNodeName, clientId, {
      type: 'player_joined',
      data: createSafePlayerData(player),
    });

    console.log(`Player auto-connected successfully: ${player.username} (${userId}) on floor ${dungeonDagNodeName}`);
  } catch (error) {
    console.error(`Auto-connect error for client ${clientId}:`, error);
    throw error; // Re-throw so the connection handler can close the WebSocket
  }
}

interface MoveData {
  position: Position;
  rotation?: Position;
  isMoving?: boolean;
  movementDirection?: 'forward' | 'backward' | 'none';
}

interface MoveBroadcastData extends Record<string, unknown> {
  playerId: string;
  position: Position;
  rotation?: Position;
  isMoving?: boolean;
  movementDirection?: 'forward' | 'backward' | 'none';
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
    const { position, rotation, isMoving, movementDirection } = data;
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
    
    if (typeof isMoving === 'boolean') {
      broadcastData.isMoving = isMoving;
    }
    
    if (movementDirection && ['forward', 'backward', 'none'].includes(movementDirection)) {
      broadcastData.movementDirection = movementDirection;
    }

    // Broadcast position update only to other clients on the same floor
    const currentFloor = client.currentDungeonDagNodeName;
    if (currentFloor) {
      broadcastToFloorExcluding(currentFloor, clientId, {
        type: 'player_moved',
        data: broadcastData,
      });
    } else {
      console.warn(`Player ${client.playerId} moving but not assigned to any floor`);
    }
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
  
  // Broadcast action only to other clients on the same floor
  const currentFloor = client.currentDungeonDagNodeName;
  if (currentFloor) {
    broadcastToFloorExcluding(currentFloor, clientId, {
      type: 'player_action',
      data: {
        playerId: client.playerId,
        action: data,
        timestamp: new Date(),
      },
    });
  } else {
    console.warn(`Player ${client.playerId} performing action but not assigned to any floor`);
  }
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

        // Remove client from their floor and notify others on that floor
        const currentFloor = client.currentDungeonDagNodeName;
        if (currentFloor) {
          removeClientFromFloor(clientId, currentFloor);
          
          // Broadcast player left to other clients on the same floor
          broadcastToFloor(currentFloor, {
            type: 'player_left',
            data: { 
              playerId: client.playerId,
              floor: currentFloor,
            },
          });
        }
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

  // Broadcast floor-specific game state to each floor
  floorClients.forEach((clientIds, dungeonDagNodeName) => {
    if (clientIds.size > 0) {
      const playersOnFloor = getPlayersOnFloor(dungeonDagNodeName);
      
      broadcastToFloor(dungeonDagNodeName, {
        type: 'game_state',
        data: {
          players: playersOnFloor,
          gameStarted: gameState.gameStarted,
          lastUpdate: gameState.lastUpdate,
          floor: dungeonDagNodeName,
        },
      });
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
    moveClientToFloor(targetClientId, newFloorName);
    
    // Notify old floor that player left
    if (oldFloor) {
      broadcastToFloor(oldFloor, {
        type: 'player_left_floor',
        data: { 
          playerId: targetClient.playerId,
          fromFloor: oldFloor,
          toFloor: newFloorName,
        },
      });
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
      });
    }
    
    console.log(`Player ${targetClient.playerId} changed from floor ${oldFloor} to ${newFloorName} via REST`);
    return { success: true, message: `Floor changed from ${oldFloor} to ${newFloorName}` };
    
  } catch (error) {
    console.error('REST floor change error:', error);
    return { success: false, message: 'Error changing floor' };
  }
}
