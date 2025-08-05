import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { verifyFirebaseToken } from '../config/firebase';
import { PlayerService } from './playerService';
import { GameMessage, WebSocketClient, GameState, Player } from '../types/game';

const playerService = new PlayerService();
const clients = new Map<string, WebSocketClient>();
const gameState: GameState = {
  players: new Map<string, Player>(),
  gameStarted: true,
  lastUpdate: new Date(),
};

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
        await handleConnect(clientId, message.data);
        break;

      case 'player_move':
        await handlePlayerMove(clientId, message.data);
        break;

      case 'player_action':
        await handlePlayerAction(clientId, message.data);
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

async function handleConnect(clientId: string, data: any): Promise<void> {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  try {
    // The client sends userId and userEmail, but we need to verify with Firebase token
    // For now, we'll work with the provided data and expect token in headers or separate auth
    
    if (data.userId && data.userEmail) {
      // For development, we can work with the provided userId
      // In production, this should be validated with Firebase token
      const userId = data.userId;
      const userEmail = data.userEmail;
      
      client.userId = userId;
      client.isAuthenticated = true;

      // Get or create player
      let player = await playerService.getPlayer(userId);
      if (!player) {
        player = await playerService.createPlayer(
          userId,
          userEmail.split('@')[0] || 'Player', // Use email prefix as username
          userEmail
        );
      }

      // Set player online
      await playerService.setPlayerOnlineStatus(userId, true);
      client.playerId = player.id;
      gameState.players.set(player.id, player);

      // Send success response
      sendMessage(clientId, {
        type: 'connect_success',
        data: {
          player,
          gameState: {
            players: Array.from(gameState.players.values()),
            gameStarted: gameState.gameStarted,
          },
        },
      });

      // Broadcast player joined to other clients
      broadcastToOthers(clientId, {
        type: 'player_joined',
        data: { player },
      });

      console.log(`Player connected: ${player.username} (${userId})`);
    } else {
      sendErrorMessage(clientId, 'User ID and email required');
    }
  } catch (error) {
    console.error('Connect error:', error);
    sendErrorMessage(clientId, 'Connection failed');
  }
}

async function handlePlayerMove(clientId: string, data: any): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated || !client.userId) {
    sendErrorMessage(clientId, 'Not authenticated');
    return;
  }

  try {
    const { position } = data;
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      sendErrorMessage(clientId, 'Invalid position data');
      return;
    }

    // Update player position in database
    await playerService.updatePlayerPosition(client.userId, position);

    // Update game state
    const player = gameState.players.get(client.playerId!);
    if (player) {
      player.position = position;
      player.lastUpdate = new Date();
    }

    // Broadcast position update to other clients
    broadcastToOthers(clientId, {
      type: 'player_update',
      data: {
        playerId: client.playerId,
        position,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Player move error:', error);
    sendErrorMessage(clientId, 'Error updating position');
  }
}

async function handlePlayerAction(clientId: string, data: any): Promise<void> {
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
      players: Array.from(gameState.players.values()),
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
