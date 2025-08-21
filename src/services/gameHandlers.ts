import { WebSocket } from 'ws';
import { WebSocketClient, GameState, Player, GameMessage } from '../types/game';
import { SpellData, MoveData, ActionData, RespawnData, MoveBroadcastData } from './gameTypes';
import { PlayerService } from './playerService';
import { EnemyService } from './enemyService';
import { DungeonService } from './dungeonService';
import { isPlayerHitBySpell, isEnemyHitBySpell, calculateDistance, createSafePlayerData } from './gameUtils';
import { broadcastToFloor, broadcastToFloorExcluding, floorClients } from './floorManager';

// Rate limiting for movement updates
const MOVEMENT_UPDATE_RATE_LIMIT = 30; // Max updates per second per player
const moveUpdateTimestamps = new Map<string, number[]>(); // clientId -> array of timestamps

/**
 * Check if client can send movement update (rate limiting)
 */
export function canSendMovementUpdate(clientId: string): boolean {
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

/**
 * Clean up rate limiting data for a client
 */
export function cleanupRateLimitData(clientId: string): void {
  moveUpdateTimestamps.delete(clientId);
}

/**
 * Find existing client by player ID
 */
export function findClientByPlayerId(playerId: string, clients: Map<string, WebSocketClient>): string | null {
  for (const [clientId, client] of clients.entries()) {
    if (client.playerId === playerId) {
      return clientId;
    }
  }
  return null;
}

/**
 * Send a message to a specific client
 */
export function sendMessage(clientId: string, message: GameMessage, clients?: Map<string, WebSocketClient>): void {
  if (!clients) {
    // For backward compatibility, try to get clients from the calling context
    throw new Error('Clients map must be provided');
  }
  const client = clients.get(clientId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    const messageWithTimestamp = {
      ...message,
      timestamp: new Date(),
    };
    client.ws.send(JSON.stringify(messageWithTimestamp));
  }
}

/**
 * Send an error message to a specific client
 */
export function sendErrorMessage(clientId: string, error: string, clients?: Map<string, WebSocketClient>): void {
  if (!clients) {
    throw new Error('Clients map must be provided');
  }
  sendMessage(clientId, {
    type: 'error',
    data: { message: error },
  }, clients);
}

/**
 * Handle player movement
 */
export async function handlePlayerMove(
  clientId: string, 
  data: MoveData,
  clients: Map<string, WebSocketClient>,
  gameState: GameState,
  playerService: PlayerService
): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated || !client.userId) {
    sendErrorMessage(clientId, 'Not authenticated', clients);
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
      sendErrorMessage(clientId, 'Cannot move other players', clients);
      return;
    }
    
    if (!position || typeof position.x !== 'number' || typeof position.y !== 'number' || typeof position.z !== 'number') {
      sendErrorMessage(clientId, 'Invalid position data', clients);
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
      }, clients);
    } else {
      console.warn(`Player ${client.playerId} moving but not assigned to any floor`);
    }
  } catch (error) {
    console.error('Player move error:', error);
    sendErrorMessage(clientId, 'Error updating position', clients);
  }
}

/**
 * Handle player actions
 */
export async function handlePlayerAction(
  clientId: string, 
  data: ActionData,
  clients: Map<string, WebSocketClient>,
  gameState: GameState,
  playerService: PlayerService,
  enemyService: EnemyService
): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated) {
    sendErrorMessage(clientId, 'Not authenticated', clients);
    return;
  }

  // Handle different player actions (attack, interact, etc.)
  console.log(`[PLAYER ACTION DEBUG] Player action from ${clientId}:`, JSON.stringify(data, null, 2));
  
  // Special handling for spell_cast actions
  if (data.action === 'spell_cast' && data.data) {
    console.log(`[PLAYER ACTION DEBUG] Detected spell_cast action, calling handleSpellCast`);
    // Type guard for spell data
    const spellData = data.data as unknown as SpellData;
    if (spellData.fromPosition && spellData.toPosition && spellData.spellRadius) {
      await handleSpellCast(clientId, spellData, clients, gameState, playerService, enemyService);
    } else {
      console.log(`[PLAYER ACTION DEBUG] Invalid spell data structure`);
    }
  } else {
    console.log(`[PLAYER ACTION DEBUG] Action type: ${data.action}, has data: ${!!data.data}`);
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
    }, clients);
  } else {
    console.warn(`Player ${client.playerId} performing action but not assigned to any floor`);
  }
}

/**
 * Handle player respawn
 */
export async function handlePlayerRespawn(
  clientId: string, 
  data: RespawnData,
  clients: Map<string, WebSocketClient>,
  gameState: GameState,
  playerService: PlayerService,
  dungeonService: DungeonService
): Promise<void> {
  const client = clients.get(clientId);
  if (!client || !client.isAuthenticated || !client.userId) {
    sendErrorMessage(clientId, 'Not authenticated', clients);
    return;
  }

  console.log(`Player respawn request from ${clientId}:`, data);

  try {
    // Get spawn location from dungeon service
    const spawnDungeonDagNodeName = await dungeonService.getSpawn();
    if (!spawnDungeonDagNodeName) {
      sendErrorMessage(clientId, 'Spawn location not found. Dungeon may not be initialized.', clients);
      return;
    }

    // Generate username if needed for new players
    const username = client.userName || (client.userEmail ? client.userEmail.split('@')[0] : 'Player');

    // Respawn the player (works for both existing and new players)
    const respawnedPlayer = await playerService.respawnPlayer(
      client.userId, 
      spawnDungeonDagNodeName, 
      data.characterData,
      username,
      client.userEmail
    );

    // Update game state
    gameState.players.set(respawnedPlayer.id, respawnedPlayer);
    
    // Update client's playerId if it's a new player
    if (!client.playerId) {
      client.playerId = respawnedPlayer.id;
    }

    // Remove client from current floor and move to spawn floor
    const oldFloor = client.currentDungeonDagNodeName;
    if (oldFloor) {
      // Import floor manager functions
      const { removeClientFromFloor } = await import('./floorManager');
      removeClientFromFloor(clientId, oldFloor, clients);
      
      // Notify old floor that player left
      broadcastToFloor(oldFloor, {
        type: 'player_left_floor',
        data: { 
          playerId: client.playerId,
          fromFloor: oldFloor,
          toFloor: spawnDungeonDagNodeName,
          reason: 'respawn',
        },
      }, clients);
    }
    
    // Add client to spawn floor
    const { addClientToFloor } = await import('./floorManager');
    addClientToFloor(clientId, spawnDungeonDagNodeName, clients);

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
        isNewPlayer: !gameState.players.has(respawnedPlayer.id),
      },
    }, clients);

    // Broadcast respawn to other players on the spawn floor
    broadcastToFloorExcluding(spawnDungeonDagNodeName, clientId, {
      type: 'player_respawned',
      data: createSafePlayerData(respawnedPlayer),
    }, clients);

    console.log(`Player ${respawnedPlayer.username} (${client.userId}) respawned successfully at spawn floor ${spawnDungeonDagNodeName}`);
  } catch (error) {
    console.error('Player respawn error:', error);
    sendErrorMessage(clientId, 'Error respawning player', clients);
  }
}

/**
 * Check players for spell hits
 */
async function checkPlayersForSpellHit(
  casterClientId: string, 
  currentFloor: string, 
  spellData: SpellData, 
  adjustedSpellRadius: number,
  clients: Map<string, WebSocketClient>,
  gameState: GameState,
  playerService: PlayerService
): Promise<string[]> {
  const floorClientIds = floorClients.get(currentFloor);
  const playersHitDetected: string[] = [];
  let playersChecked = 0;
  
  if (!floorClientIds) {
    console.log(`[SPELL HIT DEBUG] No clients found on floor ${currentFloor}`);
    return playersHitDetected;
  }

  const casterClient = clients.get(casterClientId);
  if (!casterClient) {
    console.log(`[SPELL HIT DEBUG] Caster client not found: ${casterClientId}`);
    return playersHitDetected;
  }

  // Check each player on the same floor for spell hits
  for (const targetClientId of floorClientIds) {
    // Skip the caster
    if (targetClientId === casterClientId) {
      console.log(`[SPELL HIT DEBUG] Skipping caster client ${targetClientId}`);
      continue;
    }
    
    const targetClient = clients.get(targetClientId);
    if (!targetClient || !targetClient.playerId || !targetClient.userId) {
      console.log(`[SPELL HIT DEBUG] Target client ${targetClientId} missing required data:`, {
        hasClient: !!targetClient,
        playerId: targetClient?.playerId,
        userId: targetClient?.userId
      });
      continue;
    }
    
    // Get fresh player data from database to ensure we have the latest position
    let targetPlayer;
    try {
      targetPlayer = await playerService.getPlayer(targetClient.userId);
      if (!targetPlayer) {
        console.log(`[SPELL HIT DEBUG] Could not find player in database for userId: ${targetClient.userId}`);
        continue;
      }
    } catch (error) {
      console.error(`[SPELL HIT DEBUG] Error fetching player from database:`, error);
      continue;
    }
    
    if (!targetPlayer.isAlive) {
      console.log(`[SPELL HIT DEBUG] Player ${targetPlayer.username} is already dead, skipping`);
      continue;
    }
    
    playersChecked++;
    console.log(`[SPELL HIT DEBUG] Checking player ${targetPlayer.username} (${targetPlayer.id}) at position (${targetPlayer.position.x}, ${targetPlayer.position.y}, ${targetPlayer.position.z})`);
    
    // Check if this player is hit by the spell
    const adjustedSpellData: SpellData = { 
      ...spellData, 
      spellRadius: adjustedSpellRadius 
    };
    const isHit = isPlayerHitBySpell(targetPlayer.position, adjustedSpellData);
    console.log(`[SPELL HIT DEBUG] Hit detection result for ${targetPlayer.username}: ${isHit}`);
    
    if (isHit) {
      console.log(`[SPELL HIT DEBUG] *** PLAYER HIT DETECTED *** ${targetPlayer.username} (${targetPlayer.id}) hit by spell!`);
      playersHitDetected.push(targetPlayer.username);
      
      // Calculate damage (for now, fixed damage of 20, but this could be made configurable)
      const damage = 20;
      const newHealth = Math.max(0, targetPlayer.health - damage);
      
      try {
        // Update health in database
        await playerService.updatePlayerHealth(targetClient.userId, newHealth);
        console.log(`[SPELL HIT DEBUG] Updated ${targetPlayer.username} health in database: ${targetPlayer.health} -> ${newHealth}`);
        
        // Update game state
        const gameStatePlayer = gameState.players.get(targetClient.playerId);
        if (gameStatePlayer) {
          gameStatePlayer.health = newHealth;
          gameStatePlayer.lastUpdate = new Date();
          
          // Check if player died
          if (newHealth <= 0) {
            gameStatePlayer.isAlive = false;
            console.log(`[SPELL HIT DEBUG] Player ${targetPlayer.username} died from spell damage!`);
          }
        } else {
          console.log(`[SPELL HIT DEBUG] Player ${targetPlayer.username} not found in gameState, updating from fresh data`);
          targetPlayer.health = newHealth;
          if (newHealth <= 0) {
            targetPlayer.isAlive = false;
          }
          gameState.players.set(targetClient.playerId, targetPlayer);
        }
        
        // Send health update to the hit player
        console.log(`[SPELL HIT DEBUG] Sending health_update to ${targetPlayer.username}`);
        sendMessage(targetClientId, {
          type: 'health_update',
          data: {
            health: newHealth,
            maxHealth: targetPlayer.maxHealth,
            damage: damage,
            damageCause: 'spell',
            casterPlayerId: casterClient.playerId,
            isAlive: newHealth > 0,
          },
        }, clients);
        
        // Broadcast the hit to all players on the floor
        console.log(`[SPELL HIT DEBUG] Broadcasting player_hit to all players on floor ${currentFloor}`);
        broadcastToFloor(currentFloor, {
          type: 'player_hit',
          data: {
            targetPlayerId: targetPlayer.id,
            casterPlayerId: casterClient.playerId,
            damage: damage,
            newHealth: newHealth,
            isAlive: newHealth > 0,
            hitType: 'spell',
          },
        }, clients);
        
        console.log(`[SPELL HIT DEBUG] Player ${targetPlayer.username} health updated: ${newHealth}/${targetPlayer.maxHealth}`);
      } catch (error) {
        console.error(`[SPELL HIT DEBUG] Error updating health for player ${targetPlayer.id}:`, error);
      }
    } else {
      // Log why the player wasn't hit for debugging
      const distance = calculateDistance(targetPlayer.position, spellData.fromPosition);
      console.log(`[SPELL HIT DEBUG] Player ${targetPlayer.username} NOT hit. Distance from spell origin: ${distance.toFixed(2)}, adjusted spell radius: ${adjustedSpellRadius}`);
    }
  }
  
  console.log(`[SPELL HIT DEBUG] Player spell hit detection complete. Players checked: ${playersChecked}, Players hit: ${playersHitDetected.length}`);
  if (playersHitDetected.length > 0) {
    console.log(`[SPELL HIT DEBUG] Players hit: ${playersHitDetected.join(', ')}`);
  }

  return playersHitDetected;
}

/**
 * Check enemies for spell hits
 */
async function checkEnemiesForSpellHit(
  casterClientId: string,
  currentFloor: string,
  spellData: SpellData,
  adjustedSpellRadius: number,
  clients: Map<string, WebSocketClient>,
  enemyService: EnemyService
): Promise<string[]> {
  const enemiesHitDetected: string[] = [];
  let enemiesChecked = 0;

  const casterClient = clients.get(casterClientId);
  if (!casterClient) {
    console.log(`[SPELL HIT DEBUG] Caster client not found: ${casterClientId}`);
    return enemiesHitDetected;
  }

  try {
    // Get all enemies on this floor
    const enemiesOnFloor = await enemyService.getEnemiesOnFloor(currentFloor);
    console.log(`[SPELL HIT DEBUG] Found ${enemiesOnFloor.length} enemies on floor ${currentFloor}`);

    for (const enemy of enemiesOnFloor) {
      enemiesChecked++;
      console.log(`[SPELL HIT DEBUG] Checking enemy ${enemy.id} (${enemy.enemyTypeName}) at position (${enemy.positionX}, ${enemy.positionY})`);

      // Check if this enemy is hit by the spell
      const enemyPosition = { x: enemy.positionX, y: enemy.positionY };
      const adjustedSpellData: SpellData = { 
        ...spellData, 
        spellRadius: adjustedSpellRadius 
      };
      const isHit = isEnemyHitBySpell(enemyPosition, adjustedSpellData);
      console.log(`[SPELL HIT DEBUG] Enemy hit detection result for ${enemy.enemyTypeName} (${enemy.id}): ${isHit}`);

      if (isHit) {
        console.log(`[SPELL HIT DEBUG] *** ENEMY HIT DETECTED *** ${enemy.enemyTypeName} (${enemy.id}) hit by spell!`);
        enemiesHitDetected.push(enemy.enemyTypeName);

        // Calculate damage (same as player damage for now)
        const damage = 20;
        const newHealth = Math.max(0, enemy.health - damage);

        try {
          // Update enemy health and check if it died
          const died = await enemyService.updateEnemyHealth(enemy.id, newHealth);
          console.log(`[SPELL HIT DEBUG] Updated enemy ${enemy.id} health: ${enemy.health} -> ${newHealth}, died: ${died}`);

          // Broadcast enemy hit to all players on the floor
          console.log(`[SPELL HIT DEBUG] Broadcasting enemy_hit to all players on floor ${currentFloor}`);
          broadcastToFloor(currentFloor, {
            type: 'enemy_hit',
            data: {
              enemyId: enemy.id,
              enemyTypeName: enemy.enemyTypeName,
              casterPlayerId: casterClient.playerId,
              damage: damage,
              newHealth: newHealth,
              died: died,
              hitType: 'spell',
            },
          }, clients);

          if (died) {
            console.log(`[SPELL HIT DEBUG] Enemy ${enemy.enemyTypeName} (${enemy.id}) was killed by spell!`);
          }
        } catch (error) {
          console.error(`[SPELL HIT DEBUG] Error updating health for enemy ${enemy.id}:`, error);
        }
      } else {
        // Log why the enemy wasn't hit for debugging
        const distance = calculateDistance({ x: enemy.positionX, y: 6, z: enemy.positionY }, spellData.fromPosition);
        console.log(`[SPELL HIT DEBUG] Enemy ${enemy.enemyTypeName} NOT hit. Distance from spell origin: ${distance.toFixed(2)}, adjusted spell radius: ${adjustedSpellRadius}`);
      }
    }

    console.log(`[SPELL HIT DEBUG] Enemy spell hit detection complete. Enemies checked: ${enemiesChecked}, Enemies hit: ${enemiesHitDetected.length}`);
    if (enemiesHitDetected.length > 0) {
      console.log(`[SPELL HIT DEBUG] Enemies hit: ${enemiesHitDetected.join(', ')}`);
    }
  } catch (error) {
    console.error(`[SPELL HIT DEBUG] Error checking enemies for spell hits:`, error);
  }

  return enemiesHitDetected;
}

/**
 * Handle spell casting
 */
export async function handleSpellCast(
  casterClientId: string, 
  spellData: SpellData,
  clients: Map<string, WebSocketClient>,
  gameState: GameState,
  playerService: PlayerService,
  enemyService: EnemyService
): Promise<void> {
  const casterClient = clients.get(casterClientId);
  if (!casterClient || !casterClient.currentDungeonDagNodeName) {
    console.log(`[SPELL HIT DEBUG] Caster client not found or not on a floor. ClientId: ${casterClientId}`);
    return;
  }
  
  const currentFloor = casterClient.currentDungeonDagNodeName;
  const floorClientIds = floorClients.get(currentFloor);
  
  if (!floorClientIds) {
    console.log(`[SPELL HIT DEBUG] No clients found on floor ${currentFloor}`);
    return;
  }
  
  console.log(`[SPELL HIT DEBUG] Processing spell cast from player ${casterClient.playerId} on floor ${currentFloor}`);
  console.log(`[SPELL HIT DEBUG] Spell data:`, JSON.stringify(spellData, null, 2));
  console.log(`[SPELL HIT DEBUG] Players on floor: ${Array.from(floorClientIds).length}`);
  
  // Validate spell data
  const { fromPosition, toPosition, spellRadius } = spellData;
  if (!fromPosition || !toPosition || !spellRadius) {
    console.log(`[SPELL HIT DEBUG] Invalid spell data - missing required fields:`, {
      hasFromPosition: !!fromPosition,
      hasToPosition: !!toPosition,
      hasSpellRadius: !!spellRadius
    });
    return;
  }
  
  // Increase spell radius to account for height differences between spell trajectory and player positions
  // TODO: Fix the root cause of Y-coordinate mismatch between spells (Y=7.2) and players (Y=6)
  const adjustedSpellRadius = Math.max(spellRadius, 2); // Minimum radius of 2 to account for height difference
  console.log(`[SPELL HIT DEBUG] Original spell radius: ${spellRadius}, adjusted radius: ${adjustedSpellRadius}`);
  
  console.log(`[SPELL HIT DEBUG] Spell trajectory: from (${fromPosition.x}, ${fromPosition.y}, ${fromPosition.z}) to (${toPosition.x}, ${toPosition.y}, ${toPosition.z}) with radius ${adjustedSpellRadius}`);
  
  // Check players for spell hits
  const playersHit = await checkPlayersForSpellHit(casterClientId, currentFloor, spellData, adjustedSpellRadius, clients, gameState, playerService);
  
  // Check enemies for spell hits
  const enemiesHit = await checkEnemiesForSpellHit(casterClientId, currentFloor, spellData, adjustedSpellRadius, clients, enemyService);
  
  // Log overall results
  console.log(`[SPELL HIT DEBUG] Spell cast complete. Players hit: ${playersHit.length}, Enemies hit: ${enemiesHit.length}`);
}
