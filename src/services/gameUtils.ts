import { Position, Player } from '../types/game';
import { SpellData } from './gameTypes';

/**
 * Calculate distance between two 3D points
 */
export function calculateDistance(pos1: Position, pos2: Position): number {
  const dx = pos1.x - pos2.x;
  const dy = pos1.y - pos2.y;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Check if a point is within a spell's area of effect
 */
export function isPlayerHitBySpell(playerPosition: Position, spellData: SpellData): boolean {
  const { fromPosition, toPosition, spellRadius } = spellData;
  
  console.log(`[HIT DETECTION DEBUG] Checking hit for player at (${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z})`);
  console.log(`[HIT DETECTION DEBUG] Spell from (${fromPosition.x}, ${fromPosition.y}, ${fromPosition.z}) to (${toPosition.x}, ${toPosition.y}, ${toPosition.z}), radius: ${spellRadius}`);
  
  if (!fromPosition || !toPosition || !spellRadius) {
    console.log(`[HIT DETECTION DEBUG] Missing spell data, returning false`);
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
  
  console.log(`[HIT DETECTION DEBUG] Line length: ${lineLength}`);
  
  if (lineLength === 0) {
    // If spell has no length, just check distance from start point
    const distance = calculateDistance(playerPosition, lineStart);
    console.log(`[HIT DETECTION DEBUG] Zero-length spell, distance from start: ${distance}, hit: ${distance <= spellRadius}`);
    return distance <= spellRadius;
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
  
  console.log(`[HIT DETECTION DEBUG] Projection: ${projection}, clamped: ${clampedProjection}`);
  
  // Find the closest point on the line
  const closestPoint = {
    x: lineStart.x + normalizedLine.x * clampedProjection,
    y: lineStart.y + normalizedLine.y * clampedProjection,
    z: lineStart.z + normalizedLine.z * clampedProjection
  };
  
  // Check if player is within the spell radius of the closest point
  const distanceToLine = calculateDistance(playerPosition, closestPoint);
  const isHit = distanceToLine <= spellRadius;
  
  console.log(`[HIT DETECTION DEBUG] Closest point on line: (${closestPoint.x}, ${closestPoint.y}, ${closestPoint.z})`);
  console.log(`[HIT DETECTION DEBUG] Distance to line: ${distanceToLine}, spell radius: ${spellRadius}, hit: ${isHit}`);
  
  return isHit;
}

/**
 * Check if an enemy is hit by a spell
 * Note: enemies have x,y coordinates that correspond to x,z in spell coordinate system
 */
export function isEnemyHitBySpell(enemyPosition: { x: number; y: number }, spellData: SpellData): boolean {
  // Convert enemy position to 3D coordinates for spell checking
  // Enemy x,y maps to spell x,z coordinates, use a default y coordinate
  const enemyPos3D: Position = {
    x: enemyPosition.x,
    y: 6, // Default y coordinate for enemies (matches typical player y)
    z: enemyPosition.y // Enemy y becomes spell z
  };
  
  console.log(`[ENEMY HIT DEBUG] Checking enemy at (${enemyPosition.x}, ${enemyPosition.y}) -> 3D (${enemyPos3D.x}, ${enemyPos3D.y}, ${enemyPos3D.z})`);
  
  return isPlayerHitBySpell(enemyPos3D, spellData);
}

/**
 * Create safe player data for broadcasting (removes sensitive info)
 */
export function createSafePlayerData(player: Player): Partial<Player> {
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
