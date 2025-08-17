/* eslint-disable no-console */
import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './authService';
import { PlayerService } from './playerService';
import { DungeonService } from './dungeonService';
import { GameMessage, WebSocketClient, GameState, Player, Position } from '../types/game';

const authService = new AuthService();
const playerService = new PlayerService();
const dungeonService = new DungeonService();
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

// Helper function to find existing client by player ID
function findClientByPlayerId(playerId: string): string | null {
  for (const [clientId, client] of clients.entries()) {
    if (client.playerId === playerId) {
      return clientId;
    }
  }
  return null;
}

// Helper function to create safe player data for broadcasting (removes sensitive info)
function createSafePlayerData(player: Player): Partial<Player> {
  return {
    id: player.id,
    position: player.position,
    rotation: player.rotation,
    character: player.character || { type: 'unknown' }, // Always include character data or default
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

    // Decode the token safely
    const token = encodedToken ? decodeURIComponent(encodedToken) : null;

    // Authenticate immediately on connection
    if (token) {
      try {
        await handleAutoConnect(clientId, token);
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

      case 'player_respawn':
        await handlePlayerRespawn(clientId, message.data as unknown as RespawnData);
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
    const existingClientId = findClientByPlayerId(player.id);
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
    addClientToFloor(clientId, currentFloor);

    // Send success response with floor-specific data
    sendMessage(clientId, {
      type: 'connect_success',
      data: {
        player, // Send full player data to the connecting user
        gameState: {
          players: getPlayersOnFloor(currentFloor), // Only players on the same floor
          gameStarted: gameState.gameStarted,
        },
      },
    });

    // Send current players list for this floor to the new client
    const playersOnFloor = getPlayersOnFloor(currentFloor)
      .filter(p => p.id !== player.id);

    if (playersOnFloor.length > 0) {
      sendMessage(clientId, {
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
    });

    console.log(`Player auto-connected successfully: ${player.username} (${userId}) on floor ${currentFloor}`);
  } catch (error) {
    console.error(`Auto-connect error for client ${clientId}:`, error);
    throw error; // Re-throw so the connection handler can close the WebSocket
  }
}

interface MoveData {
  playerId?: string; // Firebase userId sent by client (validated against authenticated user)
  position: Position;
  rotation?: Position;
  character?: Record<string, unknown>;
  isMoving?: boolean;
  movementDirection?: 'forward' | 'backward' | 'none';
}

interface MoveBroadcastData extends Record<string, unknown> {
  playerId: string; // MongoDB player.id (safe to expose to other players)
  position: Position;
  rotation?: Position;
  character: Record<string, unknown>; // Always included (required for consistent client state)
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

  console.log(`[MOVE DEBUG] ClientId: ${clientId}, UserId: ${client.userId}, PlayerId: ${client.playerId}`);

  // Check rate limit
  if (!canSendMovementUpdate(clientId)) {
    // Silently drop the update if rate limited - no need to send error
    return;
  }

  try {
    const { playerId, position, rotation, character, isMoving, movementDirection } = data;
    
    // Validate that the client is only moving their own player (if playerId is provided)
    if (playerId && playerId !== client.userId) {
      sendErrorMessage(clientId, 'Cannot move other players');
      return;
    }
    
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      sendErrorMessage(clientId, 'Invalid position data');
      return;
    }

    console.log(`Player ${client.playerId} (Firebase: ${client.userId}) moving to position:`, position, rotation ? `with rotation:` : '', rotation);

    // Update player position, rotation, and character in database
    await playerService.updatePlayerPositionRotationAndCharacter(client.userId, position, rotation, character);

    // Update game state
    const gamePlayer = gameState.players.get(client.playerId!);
    if (gamePlayer) {
      gamePlayer.position = position;
      if (rotation) {
        gamePlayer.rotation = rotation;
      }
      if (character) {
        gamePlayer.character = character;
      }
      gamePlayer.lastUpdate = new Date();
    }

    // Broadcast position update to other clients
    // Use the character data from the move request if provided, otherwise use stored character data
    const characterToSend = character || gamePlayer?.character || { type: 'unknown' };
    
    const broadcastData: MoveBroadcastData = {
      playerId: client.playerId!,
      position,
      character: characterToSend, // Use the most current character data
      timestamp: new Date(),
    };
    
    console.log(`[BROADCAST DEBUG] Broadcasting MongoDB playerId: ${client.playerId} for Firebase userId: ${client.userId} from client ${clientId}`);
    console.log(`[CHARACTER DEBUG] Character from move:`, character);
    console.log(`[CHARACTER DEBUG] Character in gamePlayer:`, gamePlayer?.character);
    console.log(`[CHARACTER DEBUG] Broadcasting character data:`, characterToSend);
    
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
  playerId?: string; // Firebase user ID that may be included by client
}

interface RespawnData {
  characterData?: Record<string, unknown>;
}

// Helper function to calculate distance between two 3D points
function calculateDistance(pos1: Position, pos2: Position): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Helper function to check if a point is within a spell's area of effect
function isPlayerHitBySpell(playerPosition: Position, spellData: any): boolean {
  const { fromPosition, toPosition, spellRadius } = spellData;
  
  if (!fromPosition || !toPosition || !spellRadius) {
    return false;
  }
  
  // Calculate the closest point on the spell's line to the player
  const lineStart = fromPosition;
  const lineEnd = toPosition;
  const lineVector = {
    x: lineEnd.x - lineStart.x,
    y: lineEnd.y - lineStart.y,
    z: lineEnd.z - lineStart.z
  };
  
  const lineLength = Math.sqrt(
    lineVector.x * lineVector.x + 
    lineVector.y * lineVector.y + 
    lineVector.z * lineVector.z
  );
  
  if (lineLength === 0) {
    // If spell has no length, just check distance from start point
    return calculateDistance(playerPosition, lineStart) <= spellRadius;
  }
  
  // Normalize the line vector
  const normalizedLine = {
    x: lineVector.x / lineLength,
    y: lineVector.y / lineLength,
    z: lineVector.z / lineLength
  };
  
  // Vector from line start to player
  const playerVector = {
    x: playerPosition.x - lineStart.x,
    y: playerPosition.y - lineStart.y,
    z: playerPosition.z - lineStart.z
  };
  
  // Project player vector onto the line
  const projection = 
    playerVector.x * normalizedLine.x + 
    playerVector.y * normalizedLine.y + 
    playerVector.z * normalizedLine.z;
  
  // Clamp projection to the line segment
  const clampedProjection = Math.max(0, Math.min(lineLength, projection));
  
  // Find the closest point on the line
  const closestPoint = {
    x: lineStart.x + normalizedLine.x * clampedProjection,
    y: lineStart.y + normalizedLine.y * clampedProjection,
    z: lineStart.z + normalizedLine.z * clampedProjection
  };
  
  // Check if player is within the spell radius of the closest point
  const distanceToLine = calculateDistance(playerPosition, closestPoint);
  return distanceToLine <= spellRadius;
}

async function handlePlayerAction(clientId: string, data: ActionData): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated) {
    sendErrorMessage(clientId, 'Not authenticated');
    return;
  }

  // Handle different player actions (attack, interact, etc.)
  console.log(`Player action from ${clientId}:`, data);
  
  // Special handling for spell_cast actions
  if (data.action === 'spell_cast' && data.data) {
    await handleSpellCast(clientId, data.data);
  }
  
  // Sanitize action data to remove Firebase user IDs before broadcasting
  const sanitizedAction: Partial<ActionData> = { ...data };
  
  // Remove any playerId field from the action data (this would be the Firebase ID)
  if ('playerId' in sanitizedAction) {
    console.log(`Removing Firebase playerId from action data: ${sanitizedAction.playerId}`);
    delete sanitizedAction.playerId;
  }
  
  // Also check nested data object for playerId
  if (sanitizedAction.data && typeof sanitizedAction.data === 'object') {
    const sanitizedData = { ...sanitizedAction.data };
    if ('playerId' in sanitizedData) {
      console.log(`Removing Firebase playerId from nested action data: ${sanitizedData.playerId}`);
      delete sanitizedData.playerId;
    }
    sanitizedAction.data = sanitizedData;
  }
  
  console.log(`Broadcasting sanitized action with MongoDB playerId: ${client.playerId}`);
  
  // Broadcast action only to other clients on the same floor
  const currentFloor = client.currentDungeonDagNodeName;
  if (currentFloor) {
    broadcastToFloorExcluding(currentFloor, clientId, {
      type: 'player_action',
      data: {
        playerId: client.playerId, // Use MongoDB player ID (safe to expose)
        action: sanitizedAction, // Use sanitized action data
        timestamp: new Date(),
      },
    });
  } else {
    console.warn(`Player ${client.playerId} performing action but not assigned to any floor`);
  }
}

async function handleSpellCast(casterClientId: string, spellData: any): Promise<void> {
  const casterClient = clients.get(casterClientId);
  if (!casterClient || !casterClient.currentDungeonDagNodeName) {
    return;
  }
  
  const currentFloor = casterClient.currentDungeonDagNodeName;
  const floorClientIds = floorClients.get(currentFloor);
  
  if (!floorClientIds) {
    return;
  }
  
  console.log(`Processing spell cast from player ${casterClient.playerId} on floor ${currentFloor}`);
  console.log(`Spell data:`, spellData);
  
  // Check each player on the same floor for spell hits
  for (const targetClientId of floorClientIds) {
    // Skip the caster
    if (targetClientId === casterClientId) {
      continue;
    }
    
    const targetClient = clients.get(targetClientId);
    if (!targetClient || !targetClient.playerId) {
      continue;
    }
    
    const targetPlayer = gameState.players.get(targetClient.playerId);
    if (!targetPlayer || !targetPlayer.isAlive) {
      continue;
    }
    
    // Check if this player is hit by the spell
    if (isPlayerHitBySpell(targetPlayer.position, spellData)) {
      console.log(`Player ${targetPlayer.username} (${targetPlayer.id}) hit by spell!`);
      
      // Calculate damage (for now, fixed damage of 20, but this could be made configurable)
      const damage = 20;
      const newHealth = Math.max(0, targetPlayer.health - damage);
      
      try {
        // Update health in database
        await playerService.updatePlayerHealth(targetClient.userId!, newHealth);
        
        // Update game state
        targetPlayer.health = newHealth;
        targetPlayer.lastUpdate = new Date();
        
        // Check if player died
        if (newHealth <= 0) {
          targetPlayer.isAlive = false;
          console.log(`Player ${targetPlayer.username} died from spell damage!`);
        }
        
        // Send health update to the hit player
        sendMessage(targetClientId, {
          type: 'health_update',
          data: {
            health: newHealth,
            maxHealth: targetPlayer.maxHealth,
            damage: damage,
            damageCause: 'spell',
            casterPlayerId: casterClient.playerId,
            isAlive: targetPlayer.isAlive,
          },
        });
        
        // Broadcast the hit to all players on the floor
        broadcastToFloor(currentFloor, {
          type: 'player_hit',
          data: {
            targetPlayerId: targetPlayer.id,
            casterPlayerId: casterClient.playerId,
            damage: damage,
            newHealth: newHealth,
            isAlive: targetPlayer.isAlive,
            hitType: 'spell',
          },
        });
        
        console.log(`Player ${targetPlayer.username} health: ${newHealth}/${targetPlayer.maxHealth}`);
      } catch (error) {
        console.error(`Error updating health for player ${targetPlayer.id}:`, error);
      }
    }
  }
}

async function handlePlayerRespawn(clientId: string, data: RespawnData): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated || !client.userId) {
    sendErrorMessage(clientId, 'Not authenticated');
    return;
  }

  console.log(`Player respawn request from ${clientId}:`, data);

  try {
    // Get current player
    const currentPlayer = gameState.players.get(client.playerId!);
    if (!currentPlayer) {
      sendErrorMessage(clientId, 'Player not found in game state');
      return;
    }

    // Get spawn location from dungeon service
    const spawnDungeonDagNodeName = await dungeonService.getSpawn();
    if (!spawnDungeonDagNodeName) {
      sendErrorMessage(clientId, 'Spawn location not found. Dungeon may not be initialized.');
      return;
    }

    // Respawn the player with new character data if provided
    const respawnedPlayer = await playerService.respawnPlayer(client.userId, spawnDungeonDagNodeName, data.characterData);

    // Update game state
    gameState.players.set(client.playerId!, respawnedPlayer);

    // Remove client from current floor and move to spawn floor
    const oldFloor = client.currentDungeonDagNodeName;
    if (oldFloor) {
      removeClientFromFloor(clientId, oldFloor);
      
      // Notify old floor that player left
      broadcastToFloor(oldFloor, {
        type: 'player_left_floor',
        data: { 
          playerId: client.playerId,
          fromFloor: oldFloor,
          toFloor: spawnDungeonDagNodeName,
          reason: 'respawn',
        },
      });
    }
    
    // Add client to spawn floor
    addClientToFloor(clientId, spawnDungeonDagNodeName);

    // Send success response to the respawning player
    sendMessage(clientId, {
      type: 'respawn_success',
      data: {
        player: {
          id: respawnedPlayer.id,
          username: respawnedPlayer.username,
          health: respawnedPlayer.health,
          maxHealth: respawnedPlayer.maxHealth,
          isAlive: respawnedPlayer.isAlive,
          character: respawnedPlayer.character,
          level: respawnedPlayer.level,
          experience: respawnedPlayer.experience,
          position: respawnedPlayer.position,
          currentDungeonDagNodeName: respawnedPlayer.currentDungeonDagNodeName,
        },
        spawnFloor: spawnDungeonDagNodeName,
      },
    });

    // Broadcast respawn to other players on the spawn floor
    broadcastToFloorExcluding(spawnDungeonDagNodeName, clientId, {
      type: 'player_respawned',
      data: createSafePlayerData(respawnedPlayer),
    });

    console.log(`Player ${respawnedPlayer.username} (${client.userId}) respawned successfully at spawn floor ${spawnDungeonDagNodeName}`);
  } catch (error) {
    console.error('Player respawn error:', error);
    sendErrorMessage(clientId, 'Error respawning player');
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





function broadcastGameState(): void {
  if (gameState.players.size === 0) {
    return;
  }

  // Broadcast floor-specific game state to each floor
  floorClients.forEach((clientIds, dungeonDagNodeName) => {
    if (clientIds.size > 0) {
      const playersOnFloor = getPlayersOnFloor(dungeonDagNodeName);
      
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

/**
 * Get the total number of players across all floors
 */
export function getTotalPlayerCount(): number {
  let totalPlayers = 0;
  floorClients.forEach((clientIds) => {
    totalPlayers += clientIds.size;
  });
  return totalPlayers;
}

/**
 * Get player counts by floor
 */
export function getPlayerCountsByFloor(): Record<string, number> {
  const counts: Record<string, number> = {};
  floorClients.forEach((clientIds, floorName) => {
    counts[floorName] = clientIds.size;
  });
  return counts;
}
