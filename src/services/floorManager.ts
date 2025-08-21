import { WebSocket } from 'ws';
import { GameMessage, WebSocketClient, Player } from '../types/game';
import { createSafePlayerData } from './gameUtils';

// Global state for floor management
export const floorClients = new Map<string, Set<string>>(); // dungeonDagNodeName -> Set of clientIds

/**
 * Add a client to a floor
 */
export function addClientToFloor(
  clientId: string, 
  dungeonDagNodeName: string,
  clients: Map<string, WebSocketClient>
): void {
  if (!floorClients.has(dungeonDagNodeName)) {
    floorClients.set(dungeonDagNodeName, new Set());
  }
  floorClients.get(dungeonDagNodeName)!.add(clientId);
  
  const client = clients.get(clientId);
  if (client) {
    client.currentDungeonDagNodeName = dungeonDagNodeName;
    
    // Send existing enemies on this floor to the newly joined client
    setImmediate(async () => {
      try {
        // Import shared enemyService to avoid circular dependency issues
        const { enemyService } = await import('./index');
        const enemies = await enemyService.getEnemiesOnFloor(dungeonDagNodeName);
        
        if (enemies.length > 0 && client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({
            type: 'floor-enemies',
            data: {
              floorName: dungeonDagNodeName,
              enemies: enemies
            },
            timestamp: new Date()
          }));
        }
      } catch (error) {
        console.error(`Error sending existing enemies to client ${clientId} on floor ${dungeonDagNodeName}:`, error);
      }
    });
  }
}

/**
 * Remove a client from a floor
 */
export function removeClientFromFloor(
  clientId: string, 
  dungeonDagNodeName: string | undefined,
  clients: Map<string, WebSocketClient>
): void {
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

/**
 * Move a client from one floor to another
 */
export function moveClientToFloor(
  clientId: string, 
  newDungeonDagNodeName: string,
  clients: Map<string, WebSocketClient>
): void {
  const client = clients.get(clientId);
  const oldFloor = client?.currentDungeonDagNodeName;
  
  // Remove from old floor
  if (oldFloor) {
    removeClientFromFloor(clientId, oldFloor, clients);
  }
  
  // Add to new floor
  addClientToFloor(clientId, newDungeonDagNodeName, clients);
  
  console.log(`Client ${clientId} moved from floor ${oldFloor || 'none'} to ${newDungeonDagNodeName}`);
}

/**
 * Broadcast a message to all clients on a specific floor
 */
export function broadcastToFloor(
  dungeonDagNodeName: string, 
  message: GameMessage,
  clients: Map<string, WebSocketClient>
): void {
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

/**
 * Broadcast a message to all clients on a floor except one
 */
export function broadcastToFloorExcluding(
  dungeonDagNodeName: string, 
  excludeClientId: string, 
  message: GameMessage,
  clients: Map<string, WebSocketClient>
): void {
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

/**
 * Get all players currently on a specific floor
 */
export function getPlayersOnFloor(
  dungeonDagNodeName: string,
  clients: Map<string, WebSocketClient>,
  gameState: { players: Map<string, Player> }
): Partial<Player>[] {
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
