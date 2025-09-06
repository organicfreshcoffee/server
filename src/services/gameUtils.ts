import { Position, Player } from '../types/game';
import { SpellData, AttackData } from './gameTypes';

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
 * Check if a player is hit by an attack (punch, melee, or ranged)
 */
export function isPlayerHitByAttack(playerPosition: Position, attackData: AttackData): boolean {
  const { fromPosition, toPosition, range } = attackData;
  
  console.log(`[ATTACK HIT DEBUG] Checking hit for player at (${playerPosition.x}, ${playerPosition.y}, ${playerPosition.z})`);
  console.log(`[ATTACK HIT DEBUG] Attack from (${fromPosition.x}, ${fromPosition.y}, ${fromPosition.z}) to (${toPosition.x}, ${toPosition.y}, ${toPosition.z}), range: ${range}`);
  
  if (!fromPosition || !toPosition || !range) {
    console.log(`[ATTACK HIT DEBUG] Missing attack data, returning false`);
    return false;
  }
  
  // For attacks, we check if the player is within the attack range from the starting position
  // and if they're roughly in the direction of the attack
  
  // Calculate distance from attack start to player
  const distanceFromStart = calculateDistance(playerPosition, fromPosition);
  
  console.log(`[ATTACK HIT DEBUG] Distance from attack start: ${distanceFromStart}, attack range: ${range}`);
  
  // If player is too far from attack start, they can't be hit
  if (distanceFromStart > range) {
    console.log(`[ATTACK HIT DEBUG] Player too far from attack start, not hit`);
    return false;
  }
  
  // Calculate attack direction vector
  const attackDirection = {
    x: toPosition.x - fromPosition.x,
    y: toPosition.y - fromPosition.y,
    z: toPosition.z - fromPosition.z
  };
  
  // Normalize attack direction
  const attackLength = Math.sqrt(
    attackDirection.x * attackDirection.x + 
    attackDirection.y * attackDirection.y + 
    attackDirection.z * attackDirection.z
  );
  
  if (attackLength === 0) {
    // If attack has no direction, just check if player is within range
    const isHit = distanceFromStart <= range;
    console.log(`[ATTACK HIT DEBUG] Zero-direction attack, hit: ${isHit}`);
    return isHit;
  }
  
  const normalizedAttackDirection = {
    x: attackDirection.x / attackLength,
    y: attackDirection.y / attackLength,
    z: attackDirection.z / attackLength
  };
  
  // Vector from attack start to player
  const toPlayerVector = {
    x: playerPosition.x - fromPosition.x,
    y: playerPosition.y - fromPosition.y,
    z: playerPosition.z - fromPosition.z
  };
  
  // Calculate dot product to see if player is in the general direction of the attack
  const dotProduct = 
    toPlayerVector.x * normalizedAttackDirection.x + 
    toPlayerVector.y * normalizedAttackDirection.y + 
    toPlayerVector.z * normalizedAttackDirection.z;
  
  console.log(`[ATTACK HIT DEBUG] Dot product (direction alignment): ${dotProduct}`);
  
  // Player must be in the forward direction of the attack (dot product > 0)
  // and within a reasonable cone angle (we'll use a generous threshold)
  const isInDirection = dotProduct > 0;
  
  // Calculate the perpendicular distance from the attack line
  const projectionLength = Math.max(0, Math.min(range, dotProduct));
  const projectedPoint = {
    x: fromPosition.x + normalizedAttackDirection.x * projectionLength,
    y: fromPosition.y + normalizedAttackDirection.y * projectionLength,
    z: fromPosition.z + normalizedAttackDirection.z * projectionLength
  };
  
  const perpendicularDistance = calculateDistance(playerPosition, projectedPoint);
  
  // Use a generous hit radius for attacks (wider than spells since they're more direct)
  const attackHitRadius = 2.5; // Adjust this value as needed for game balance
  
  const isWithinCone = perpendicularDistance <= attackHitRadius;
  const isHit = isInDirection && isWithinCone && distanceFromStart <= range;
  
  console.log(`[ATTACK HIT DEBUG] In direction: ${isInDirection}, within cone: ${isWithinCone}, perpendicular distance: ${perpendicularDistance}, hit: ${isHit}`);
  
  return isHit;
}

/**
 * Check if an enemy is hit by an attack
 */
export function isEnemyHitByAttack(enemyPosition: { x: number; y: number }, attackData: AttackData): boolean {
  // Convert enemy position to 3D coordinates for attack checking
  const enemyPos3D: Position = {
    x: enemyPosition.x,
    y: 6, // Default y coordinate for enemies
    z: enemyPosition.y // Enemy y becomes attack z
  };
  
  console.log(`[ENEMY ATTACK HIT DEBUG] Checking enemy at (${enemyPosition.x}, ${enemyPosition.y}) -> 3D (${enemyPos3D.x}, ${enemyPos3D.y}, ${enemyPos3D.z})`);
  
  return isPlayerHitByAttack(enemyPos3D, attackData);
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
