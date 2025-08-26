import { getDatabase } from '../config/database';
import { DungeonDagNode, FloorDagNode, FloorLayout, RoomStairs } from '../types/game';
import { ServerFloorGenerator } from './floorGenerator';
import { GeneratedFloorData, GeneratedFloorTileData, FloorTileCoordinates, ServerRoom } from '../types/floorGeneration';
import { WallGenerator } from './wallGenerator';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

/**
 * Seeded random number generator using a simple LCG (Linear Congruential Generator)
 * This ensures deterministic random numbers based on a seed
 */
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    // Convert string seed to numeric seed using a simple hash
    this.seed = this.hashString(seed);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  // Linear Congruential Generator
  next(): number {
    this.seed = (this.seed * 1664525 + 1013904223) % Math.pow(2, 32);
    return this.seed / Math.pow(2, 32);
  }

  // Generate random integer between min and max (inclusive)
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  // Generate random float between 0 and 1
  nextFloat(): number {
    return this.next();
  }

  // Generate random boolean with optional probability
  nextBoolean(probability: number = 0.5): boolean {
    return this.next() < probability;
  }
}

/**
 * DungeonService manages the procedural generation of dungeon structures using two separate DAGs:
 * 1. Dungeon DAG: Represents the overall dungeon structure with floors connected by stairs
 * 2. Floor DAG: Represents the room/hallway layout within each individual floor
 */
export class DungeonService {
  private readonly ROOM_COUNT_MIN = 10;
  private readonly ROOM_COUNT_MAX = 25;
  private readonly ROOM_SIZE_MIN = 5;
  private readonly ROOM_SIZE_MAX = 15;
  private readonly HALLWAY_LENGTH_MIN = 15;
  private readonly HALLWAY_LENGTH_MAX = 30;
  private readonly GENERATION_BUFFER = 3; // Generate floors when player is within 3 levels

  private dungeonSeed: string | null = null;

  /**
   * Get the current dungeon seed from the database
   */
  private async getDungeonSeed(): Promise<string> {
    if (this.dungeonSeed) {
      return this.dungeonSeed;
    }

    const db = getDatabase();
    const seedDoc = await db.collection('dungeon_seed').findOne({});
    
    if (!seedDoc || !seedDoc.seed) {
      throw new Error('No dungeon seed found in database. Please run initializeDungeon first.');
    }

    this.dungeonSeed = seedDoc.seed;
    return this.dungeonSeed as string; // Safe assertion since we check above
  }

  /**
   * Create a seeded random generator for dungeon-level operations
   */
  private async createDungeonRandom(): Promise<SeededRandom> {
    const seed = await this.getDungeonSeed();
    return new SeededRandom(seed);
  }

  /**
   * Create a seeded random generator for floor-level operations
   * Combines dungeon seed with floor name for unique but deterministic randomness
   */
  private async createFloorRandom(floorName: string): Promise<SeededRandom> {
    const dungeonSeed = await this.getDungeonSeed();
    const combinedSeed = `${dungeonSeed}_${floorName}`;
    return new SeededRandom(combinedSeed);
  }

  /**
   * Initialize the dungeon with the root floor and randomly generated levels
   * @param seed Optional seed string for dungeon generation. If not provided, a unique UUID will be generated.
   * @param reuseCurrentSeed If true, keeps the existing seed in the database. If false or undefined, updates the seed.
   */
  async initializeDungeon(seed?: string, reuseCurrentSeed?: boolean): Promise<void> {
    const db = getDatabase();
    
    // Manage dungeon seed
    if (!reuseCurrentSeed) {
      const dungeonSeed = seed || uuidv4();
      
      // Clear existing seed data and insert new seed
      await db.collection('dungeon_seed').deleteMany({});
      await db.collection('dungeon_seed').insertOne({ seed: dungeonSeed });
      
      // Clear cached seed so it gets reloaded
      this.dungeonSeed = null;
      
      console.log(`Dungeon seed set to: ${dungeonSeed}`);
    } else {
      // Reuse current seed - check if one exists
      const existingSeed = await db.collection('dungeon_seed').findOne({});
      if (existingSeed) {
        console.log(`Reusing existing dungeon seed: ${existingSeed.seed}`);
        // Update cache
        this.dungeonSeed = existingSeed.seed;
      } else {
        // No existing seed found, create a new one
        const dungeonSeed = seed || uuidv4();
        await db.collection('dungeon_seed').insertOne({ seed: dungeonSeed });
        this.dungeonSeed = dungeonSeed;
        console.log(`No existing seed found, created new seed: ${dungeonSeed}`);
      }
    }
    
    // Clear existing dungeon data
    await db.collection('dungeonDagNodes').deleteMany({});
    await db.collection('floorDagNodes').deleteMany({});

    // Generate root dungeon node (depth 0)
    const rootDungeonNode: DungeonDagNode = {
      name: 'A',
      children: [],
      isDownwardsFromParent: false, // Root has no parent
      isBossLevel: false,
      visitedByUserIds: [] // Initialize empty array for tracking visitors
    };

    await db.collection('dungeonDagNodes').insertOne(rootDungeonNode);
    await this.generateFloor(rootDungeonNode.name, false, 0, 3); // Root floor without upward stair (it's the spawn), max depth 3

    // Validate and fix stair positions for the root floor
    const rootFloorNodes = await db.collection('floorDagNodes')
      .find({ dungeonDagNodeName: rootDungeonNode.name })
      .toArray() as unknown as FloorDagNode[];
    
    if (rootFloorNodes.length > 0) {
      await this.validateAndFixStairPositions(rootDungeonNode.name, rootFloorNodes);
      console.log(`✅ Validated stair positions for root floor ${rootDungeonNode.name}`);
    }

    // Get spawn location for player respawning
    const spawnFloor = await this.getSpawn();
    if (spawnFloor) {
      console.log(`✅ Spawn location determined: ${spawnFloor}`);
      
      // Initialize PlayerService and respawn all players
      const { PlayerService } = await import('./playerService');
      const playerService = new PlayerService();
      const allPlayers = await playerService.getAllPlayers();
      
      console.log(`Found ${allPlayers.length} players to respawn...`);
      
      for (const player of allPlayers) {
        try {
          console.log(`Respawning player: ${player.username} (${player.userId})`);
          
          // Respawn player - resets floor to spawn, position, character, and health
          await playerService.respawnPlayer(
            player.userId,
            spawnFloor,
            player.character, // Keep existing character data
            player.username,
            player.email
          );
          
          console.log(`✅ Successfully respawned ${player.username}`);
        } catch (error) {
          console.error(`❌ Failed to respawn player ${player.username}:`, error);
        }
      }
      
      console.log(`✅ Player respawn completed. ${allPlayers.length} players processed.`);
    } else {
      console.error('❌ Could not determine spawn location. Skipping player respawn.');
    }

    // eslint-disable-next-line no-console
    console.log('Dungeon initialized with root floor A');
  }

  /**
   * Check if we need to generate more floors based on player movement
   * Generates children and grandchildren (2 levels deep) to provide buffer time
   */
  async checkAndGenerateFloors(newFloorName: string): Promise<void> {
    const db = getDatabase();
    
    // Find the dungeon node for the floor the player is traveling to
    const targetDungeonNode = await db.collection('dungeonDagNodes')
      .findOne({ name: newFloorName }) as unknown as DungeonDagNode | null;
    
    if (!targetDungeonNode) {
      console.log(`Target dungeon node ${newFloorName} not found, no generation needed`);
      return;
    }
    
    console.log(`Checking generation needs for dungeon node ${newFloorName}...`);
    
    // Calculate current depth for generation limits
    const allNodes = await db.collection('dungeonDagNodes').find({}).limit(0).toArray() as unknown as DungeonDagNode[];
    const depthMap = this.calculateDepths(allNodes);
    const currentDepth = depthMap[newFloorName] || 0;
    const maxDepth = currentDepth + 3; // Allow generation up to 3 levels deeper

    let generationPerformed = false;
    
    // Level 1: Generate children for the target node if it has none
    if (targetDungeonNode.children.length === 0 && !targetDungeonNode.isBossLevel) {
      console.log(`Generating children for dungeon node ${newFloorName} (level 1)...`);
      await this.generateDungeonChildren(targetDungeonNode, maxDepth);
      generationPerformed = true;
    }
    
    // Level 2: Check children and generate grandchildren if needed
    const updatedTargetNode = await db.collection('dungeonDagNodes')
      .findOne({ name: newFloorName }) as unknown as DungeonDagNode | null;
    
    if (updatedTargetNode && updatedTargetNode.children.length > 0) {
      for (const childName of updatedTargetNode.children) {
        const childNode = await db.collection('dungeonDagNodes')
          .findOne({ name: childName }) as unknown as DungeonDagNode | null;
        
        if (childNode && childNode.children.length === 0 && !childNode.isBossLevel) {
          console.log(`Generating grandchildren for dungeon node ${childName} (level 2)...`);
          await this.generateDungeonChildren(childNode, maxDepth);
          generationPerformed = true;
        }
      }
    }
    
    if (generationPerformed) {
      // Get final state for logging
      const finalTargetNode = await db.collection('dungeonDagNodes')
        .findOne({ name: newFloorName }) as unknown as DungeonDagNode | null;
      
      if (finalTargetNode) {
        console.log(`✅ Generation complete for ${newFloorName}:`);
        console.log(`  - Children: ${finalTargetNode.children.length > 0 ? finalTargetNode.children.join(', ') : 'none'}`);
        
        // Log grandchildren info
        let grandchildrenCount = 0;
        for (const childName of finalTargetNode.children) {
          const childNode = await db.collection('dungeonDagNodes')
            .findOne({ name: childName }) as unknown as DungeonDagNode | null;
          if (childNode) {
            grandchildrenCount += childNode.children.length;
          }
        }
        console.log(`  - Total grandchildren: ${grandchildrenCount}`);
      }
    } else {
      console.log(`No generation needed for ${newFloorName} - already has sufficient structure`);
    }
  }

  /**
   * Generate children for a dungeon node using balanced exploration
   */
  private async generateDungeonChildren(parentNode: DungeonDagNode, maxDepth?: number): Promise<void> {
    const db = getDatabase();
    const dungeonRandom = await this.createDungeonRandom();

    // Calculate current depth and set reasonable max depth if not provided
    const allNodes = await db.collection('dungeonDagNodes').find({}).limit(0).toArray() as unknown as DungeonDagNode[];
    const depthMap = this.calculateDepths(allNodes);
    const currentDepth = depthMap[parentNode.name] || 0;
    const effectiveMaxDepth = maxDepth || (currentDepth + 6);

    console.log(`Generating children for ${parentNode.name} at depth ${currentDepth}, max depth ${effectiveMaxDepth}`);

    // Get the parent floor nodes to place stairs
    const parentFloorNodes = await db.collection('floorDagNodes')
      .find({ dungeonDagNodeName: parentNode.name })
      .toArray() as unknown as FloorDagNode[];

    if (parentFloorNodes.length === 0) {
      console.warn(`No floor nodes found for parent ${parentNode.name}, cannot place stairs`);
      return;
    }

    // Generate 2-5 downward stairs using seeded randomness
    const downStairCount = dungeonRandom.nextInt(2, 5);
    const children: string[] = [];
    const parentRooms = parentFloorNodes.filter(node => node.isRoom);
    
    // Ensure we don't try to place more stairs than available rooms
    const actualStairCount = Math.min(downStairCount, parentRooms.length);
    const roomsToUpdate: FloorDagNode[] = [];
    
    for (let i = 0; i < actualStairCount; i++) {
      // Find a room that doesn't already have a downward stair AND doesn't have an upward stair
      const availableRooms = parentRooms.filter(r => !r.hasDownwardStair && !r.hasUpwardStair);
      if (availableRooms.length === 0) {
        console.log(`No more rooms available for downward stairs on floor ${parentNode.name}`);
        break;
      }
      
      const room = availableRooms[dungeonRandom.nextInt(0, availableRooms.length - 1)];
      
      const childName = this.generateChildName(parentNode.name, children.length);
      children.push(childName);
      
      const childNode: DungeonDagNode = {
        name: childName,
        children: [],
        isDownwardsFromParent: true,
        isBossLevel: dungeonRandom.nextBoolean(0.1), // 10% chance of boss level
        parentFloorDagNodeName: room.name,
        visitedByUserIds: [] // Initialize empty array for tracking visitors
      };
      
      await db.collection('dungeonDagNodes').insertOne(childNode);
      
      // Generate valid stair location that doesn't conflict with floor/wall tiles
      const stairLocation = await this.generateValidStairLocation(room, parentNode.name);
      if (!stairLocation) {
        console.log(`Could not find valid stair location for room ${room.name}, using fallback position`);
        // Use a fallback position in the center of the room
        const fallbackX = Math.floor((room.roomWidth || 8) / 2);
        const fallbackY = Math.floor((room.roomHeight || 8) / 2);
        room.stairLocationX = fallbackX;
        room.stairLocationY = fallbackY;
      } else {
        room.stairLocationX = stairLocation.x;
        room.stairLocationY = stairLocation.y;
      }
      
      // Set up the downward stair in the room
      room.hasDownwardStair = true;
      room.stairDungeonDagName = childName;
      room.stairFloorDagName = `${childName}_A`; // Child floor's root room
      
      roomsToUpdate.push(room);
      
      console.log(`Creating downward stair in room ${room.name} at (${room.stairLocationX}, ${room.stairLocationY}) leading to dungeon ${childName}`);
      
      // Generate the floor for this child, passing depth information
      const childDepth = currentDepth + 1;
      await this.generateFloor(childNode.name, true, childDepth, effectiveMaxDepth); // true for hasUpwardStair
    }

    // Update the rooms in the database with stair information
    for (const room of roomsToUpdate) {
      await db.collection('floorDagNodes').updateOne(
        { name: room.name },
        { 
          $set: { 
            hasDownwardStair: room.hasDownwardStair,
            stairLocationX: room.stairLocationX,
            stairLocationY: room.stairLocationY,
            stairDungeonDagName: room.stairDungeonDagName,
            stairFloorDagName: room.stairFloorDagName
          } 
        }
      );
    }

    // Validate and fix stair positions for the parent floor after adding new stairs
    if (roomsToUpdate.length > 0) {
      await this.validateAndFixStairPositions(parentNode.name, parentFloorNodes);
      console.log(`✅ Validated stair positions for parent floor ${parentNode.name} after dynamic generation`);
    }

    // Update parent with children
    if (children.length > 0) {
      await db.collection('dungeonDagNodes').updateOne(
        { name: parentNode.name },
        { $set: { children } }
      );
    }
  }

  /**
   * Generate a floor layout
   */
  private async generateFloor(dungeonNodeName: string, hasUpwardStair: boolean, depth: number = 0, maxDepth: number = 12): Promise<void> {
    const db = getDatabase();
    const floorRandom = await this.createFloorRandom(dungeonNodeName);
    
    // Generate root room
    const rootRoomName = `${dungeonNodeName}_A`;
    const targetRoomCount = floorRandom.nextInt(this.ROOM_COUNT_MIN, this.ROOM_COUNT_MAX);
    
    const floorNodes: FloorDagNode[] = [];
    const roomCount = { count: 1 }; // Use object to pass by reference
    
    // Generate root room
    const rootRoom = await this.generateRoomNode(rootRoomName, dungeonNodeName, hasUpwardStair);
    floorNodes.push(rootRoom);
    
    // Generate floor recursively
    await this.generateFloorRecursive(rootRoom, dungeonNodeName, floorNodes, roomCount, targetRoomCount);
    
    // Insert all floor nodes first before creating children
    await db.collection('floorDagNodes').insertMany(floorNodes);
    
    // Only create child floors if we haven't reached max depth
    if (depth < maxDepth) {
      // Randomly place downward stairs in rooms and create child dungeon nodes
      await this.placeDownwardStairsAndCreateChildren(floorNodes, dungeonNodeName, depth, maxDepth);
    }

    // Validate and fix stair positions after floor generation is complete
    await this.validateAndFixStairPositions(dungeonNodeName, floorNodes);
  }

  /**
   * Recursively generate floor nodes with balanced exploration
   */
  private async generateFloorRecursive(
    parentNode: FloorDagNode,
    dungeonNodeName: string,
    floorNodes: FloorDagNode[],
    roomCount: { count: number },
    targetRoomCount: number
  ): Promise<void> {
    if (roomCount.count >= targetRoomCount) {
      return;
    }

    const floorRandom = await this.createFloorRandom(dungeonNodeName);

    // Use a queue for breadth-first generation to ensure balanced exploration
    const nodeQueue: FloorDagNode[] = [parentNode];
    let iterationCount = 0;
    const maxIterations = targetRoomCount * 10; // Safety limit to prevent infinite loops
    
    while (nodeQueue.length > 0 && roomCount.count < targetRoomCount && iterationCount < maxIterations) {
      iterationCount++;
      // Process nodes level by level for balanced exploration
      const currentLevelSize = nodeQueue.length;
      const nodesToProcess = nodeQueue.splice(0, currentLevelSize);
      
      for (const currentNode of nodesToProcess) {
        if (roomCount.count >= targetRoomCount) {
          break;
        }
        
        // Generate children for current node using seeded randomness
        const childrenCount = floorRandom.nextInt(1, 4); // 1-4 children for better balance
        const children: string[] = [];
        
        // Decrease chance of generation as we get closer to target
        const remainingRooms = targetRoomCount - roomCount.count;
        const generationChance = Math.min(0.8, remainingRooms / (targetRoomCount * 0.3));
        
        if (floorRandom.nextFloat() > generationChance && roomCount.count > targetRoomCount * 0.5) {
          continue; // Skip generation for this node occasionally to create variation
        }

        for (let i = 0; i < childrenCount && roomCount.count < targetRoomCount; i++) {
          const childName = this.generateChildName(currentNode.name, i);
          children.push(childName);

          let childNode: FloorDagNode;

          if (currentNode.isRoom) {
            // Parent is room, child is hallway
            childNode = this.generateHallwayNode(childName, dungeonNodeName, floorRandom);
            childNode.parentDirection = this.getRandomDirection(floorRandom);
            // Calculate parentDoorOffset for hallway connecting to room
            const parentMinSide = Math.min(currentNode.roomWidth || 8, currentNode.roomHeight || 8);
            childNode.parentDoorOffset = floorRandom.nextInt(1, Math.max(1, parentMinSide - 1));
            // Set door location on parent room
            this.setDoorLocation(currentNode, i, childrenCount, floorRandom);
          } else {
            // Parent is hallway, child can be room or hallway
            // Force room generation if we're running low on iterations and need more rooms
            const remainingRooms = targetRoomCount - roomCount.count;
            const forceRoom = remainingRooms > 0 && iterationCount > maxIterations * 0.7;
            const isRoom = forceRoom || floorRandom.nextBoolean(0.6); // 60% chance of room, or forced if needed
            
            if (isRoom) {
              childNode = await this.generateRoomNode(childName, dungeonNodeName, false, floorRandom);
              roomCount.count++;
              // Calculate parentDoorOffset as random number from 1 to min(width, height) - 1
              const minSide = Math.min(childNode.roomWidth || 8, childNode.roomHeight || 8);
              childNode.parentDoorOffset = floorRandom.nextInt(1, Math.max(1, minSide - 1));
              childNode.parentDirection = this.getRandomDirection(floorRandom);
            } else {
              childNode = this.generateHallwayNode(childName, dungeonNodeName, floorRandom);
              childNode.parentDirection = this.getRandomDirection(floorRandom);
            }
          }

          floorNodes.push(childNode);
          nodeQueue.push(childNode); // Add to queue for next level processing
        }

        // Update parent with children
        currentNode.children = children;
      }
    }
  }

  /**
   * Generate a room node
   */
  private async generateRoomNode(name: string, dungeonNodeName: string, hasUpwardStair: boolean, floorRandom?: SeededRandom): Promise<FloorDagNode> {
    // Use the passed random generator or create a new one for this specific room
    const random = floorRandom || await this.createFloorRandom(name);
    
    const roomWidth = random.nextInt(this.ROOM_SIZE_MIN, this.ROOM_SIZE_MAX);
    const roomHeight = random.nextInt(this.ROOM_SIZE_MIN, this.ROOM_SIZE_MAX);
    
    const room: FloorDagNode = {
      name,
      dungeonDagNodeName: dungeonNodeName,
      children: [],
      isRoom: true,
      hasUpwardStair,
      hasDownwardStair: false, // Will be set later
      roomWidth,
      roomHeight
    };
    
    // Set stair location coordinates and connections when hasUpwardStair is true
    if (hasUpwardStair) {
      // For upward stairs, use a simple placement initially
      // We'll validate and potentially relocate after floor generation
      room.stairLocationX = random.nextInt(0, roomWidth - 1);
      room.stairLocationY = random.nextInt(0, roomHeight - 1);
      
      // Find parent dungeon node to set up upward stair connection
      const db = getDatabase();
      const currentDungeonNode = await db.collection('dungeonDagNodes')
        .findOne({ name: dungeonNodeName }) as unknown as DungeonDagNode | null;
      
      if (currentDungeonNode?.parentFloorDagNodeName) {
        // The upward stair connects to the parent room that has the downward stair
        room.stairFloorDagName = currentDungeonNode.parentFloorDagNodeName;
        
        // Find the parent floor node to get the parent dungeon name
        const parentFloorNode = await db.collection('floorDagNodes')
          .findOne({ name: currentDungeonNode.parentFloorDagNodeName }) as unknown as FloorDagNode | null;
        
        if (parentFloorNode) {
          // The upward stair leads to the parent dungeon (not the current one)
          room.stairDungeonDagName = parentFloorNode.dungeonDagNodeName;
        }
      }
    }
    
    return room;
  }

  /**
   * Generate a hallway node
   */
  private generateHallwayNode(name: string, dungeonNodeName: string, floorRandom?: SeededRandom): FloorDagNode {
    // Use the passed random generator or create a simple fallback
    const hallwayLength = floorRandom 
      ? floorRandom.nextInt(this.HALLWAY_LENGTH_MIN, this.HALLWAY_LENGTH_MAX)
      : Math.floor(Math.random() * (this.HALLWAY_LENGTH_MAX - this.HALLWAY_LENGTH_MIN + 1)) + this.HALLWAY_LENGTH_MIN;
    
    return {
      name,
      dungeonDagNodeName: dungeonNodeName,
      children: [],
      isRoom: false,
      hallwayLength
    };
  }

  /**
   * Set door location on a room
   */
  private setDoorLocation(roomNode: FloorDagNode, doorIndex: number, _totalDoors: number, floorRandom?: SeededRandom): void {
    if (!roomNode.roomWidth || !roomNode.roomHeight) return;
    
    // Simple door placement - distribute along walls using seeded randomness
    const side = floorRandom ? floorRandom.nextInt(0, 3) : doorIndex % 4; // 0: top, 1: right, 2: bottom, 3: left
    
    switch (side) {
      case 0: // top
        // Door location would be set here in a more complete implementation
        break;
      case 1: // right
        break;
      case 2: // bottom
        break;
      case 3: // left
        break;
    }
  }

  /**
   * Randomly place downward stairs in rooms and create child dungeon nodes
   */
  private async placeDownwardStairsAndCreateChildren(floorNodes: FloorDagNode[], dungeonNodeName: string, depth: number, maxDepth: number): Promise<void> {
    const db = getDatabase();
    const dungeonRandom = await this.createDungeonRandom();
    const rooms = floorNodes.filter(node => node.isRoom);
    const stairCount = dungeonRandom.nextInt(2, 5); // 2-5 stairs using seeded randomness
    const childrenNames: string[] = [];
    const roomsToUpdate: FloorDagNode[] = [];
    
    for (let i = 0; i < Math.min(stairCount, rooms.length); i++) {
      // Find a room that doesn't already have a downward stair AND doesn't have an upward stair
      const availableRooms = rooms.filter(r => !r.hasDownwardStair && !r.hasUpwardStair);
      if (availableRooms.length === 0) {
        console.log(`No more rooms available for downward stairs on floor ${dungeonNodeName}`);
        break;
      }
      
      const room = availableRooms[dungeonRandom.nextInt(0, availableRooms.length - 1)];
      
      // Create child dungeon node
      const childName = this.generateChildName(dungeonNodeName, i);
      childrenNames.push(childName);
      
      const childNode: DungeonDagNode = {
        name: childName,
        children: [],
        isDownwardsFromParent: true,
        isBossLevel: dungeonRandom.nextBoolean(0.1), // 10% chance of boss level
        parentFloorDagNodeName: room.name,
        visitedByUserIds: [] // Initialize empty array for tracking visitors
      };
      
      await db.collection('dungeonDagNodes').insertOne(childNode);
      
      // Generate valid stair location that doesn't conflict with floor/wall tiles
      const stairLocation = await this.generateValidStairLocation(room, dungeonNodeName);
      if (!stairLocation) {
        console.log(`Could not find valid stair location for room ${room.name}, skipping...`);
        continue;
      }
      
      // Set up the downward stair in the room
      room.hasDownwardStair = true;
      room.stairLocationX = stairLocation.x;
      room.stairLocationY = stairLocation.y;
      room.stairDungeonDagName = childName;
      room.stairFloorDagName = `${childName}_A`; // Child floor's root room
      
      roomsToUpdate.push(room);
      
      console.log(`Creating downward stair in room ${room.name} at (${stairLocation.x}, ${stairLocation.y}) leading to dungeon ${childName}`);
      
      // Generate the child floor with upward stair - pass depth + 1
      await this.generateFloor(childName, true, depth + 1, maxDepth);
    }
    
    // Update parent dungeon node with children
    if (childrenNames.length > 0) {
      await db.collection('dungeonDagNodes').updateOne(
        { name: dungeonNodeName },
        { $set: { children: childrenNames } }
      );
    }
    
    // Update the rooms in the database with stair information
    for (const room of roomsToUpdate) {
      await db.collection('floorDagNodes').updateOne(
        { name: room.name },
        { 
          $set: { 
            hasDownwardStair: room.hasDownwardStair,
            stairLocationX: room.stairLocationX,
            stairLocationY: room.stairLocationY,
            stairDungeonDagName: room.stairDungeonDagName,
            stairFloorDagName: room.stairFloorDagName
          } 
        }
      );
    }
  }

  /**
   * Validate and fix stair positions to ensure they don't conflict with floor/wall tiles
   */
  private async validateAndFixStairPositions(dungeonNodeName: string, floorNodes: FloorDagNode[]): Promise<void> {
    const db = getDatabase();

    // Get the generated floor tile data to check for conflicts
    const generatedFloorData = await this.getGeneratedFloorTileData(dungeonNodeName);
    if (!generatedFloorData) {
      console.warn(`Could not get tile data for ${dungeonNodeName}, skipping stair validation`);
      return;
    }

    // Get the generated floor data to access positioned rooms
    const generatedData = await this.getGeneratedFloorData(dungeonNodeName);
    if (!generatedData) {
      console.warn(`Could not get generated floor data for ${dungeonNodeName}, skipping stair validation`);
      return;
    }

    // Filter rooms that have stairs
    const roomsWithStairs = generatedData.rooms.filter(room => 
      room.hasUpwardStair || room.hasDownwardStair
    );

    if (roomsWithStairs.length === 0) {
      return;
    }

    // Create sets of occupied positions for quick lookup
    const floorTilePositions = new Set<string>();
    const wallTilePositions = new Set<string>();
    
    generatedFloorData.tiles.floorTiles.forEach(tile => {
      floorTilePositions.add(`${tile.x},${tile.y}`);
    });
    
    generatedFloorData.tiles.wallTiles.forEach(tile => {
      wallTilePositions.add(`${tile.x},${tile.y}`);
    });

    const roomsToUpdate: FloorDagNode[] = [];

    for (const room of roomsWithStairs) {
      if (room.stairLocationX === undefined || room.stairLocationY === undefined) {
        continue;
      }

      // Convert local room coordinates to global coordinates
      const globalStairX = room.position.x + room.stairLocationX;
      const globalStairY = room.position.y + room.stairLocationY;
      const currentStairKey = `${globalStairX},${globalStairY}`;
      
      // Check if current stair position conflicts with floor or wall tiles
      if (floorTilePositions.has(currentStairKey) || wallTilePositions.has(currentStairKey)) {
        console.log(`Stair position conflict detected for room ${room.name} at global position (${globalStairX}, ${globalStairY}), finding new position...`);
        
        // Find the corresponding FloorDagNode for database update
        const floorDagNode = floorNodes.find(node => node.name === room.name);
        if (!floorDagNode) {
          console.warn(`Could not find FloorDagNode for room ${room.name}`);
          continue;
        }
        
        // Find a new valid position
        const newPosition = await this.findValidStairPositionForRoom(room, floorTilePositions, wallTilePositions);
        if (newPosition) {
          // Update both the ServerRoom (for current processing) and FloorDagNode (for database)
          room.stairLocationX = newPosition.x;
          room.stairLocationY = newPosition.y;
          floorDagNode.stairLocationX = newPosition.x;
          floorDagNode.stairLocationY = newPosition.y;
          roomsToUpdate.push(floorDagNode);
          console.log(`Moved stair for room ${room.name} to new position (${newPosition.x}, ${newPosition.y})`);
        } else {
          console.warn(`Could not find valid stair position for room ${room.name}, keeping current position`);
        }
      }
    }

    // Update the database with corrected stair positions
    for (const room of roomsToUpdate) {
      await db.collection('floorDagNodes').updateOne(
        { name: room.name },
        { 
          $set: { 
            stairLocationX: room.stairLocationX,
            stairLocationY: room.stairLocationY
          } 
        }
      );
    }

    if (roomsToUpdate.length > 0) {
      console.log(`✅ Fixed stair positions for ${roomsToUpdate.length} rooms in ${dungeonNodeName}`);
    }
  }

  /**
   * Find a valid stair position within a room that doesn't conflict with tiles
   */
  private async findValidStairPositionForRoom(
    room: ServerRoom, 
    floorTilePositions: Set<string>, 
    wallTilePositions: Set<string>
  ): Promise<{ x: number; y: number } | null> {
    if (!room.width || !room.height) {
      return null;
    }

    // Create a seeded random generator for this specific room's stair relocation
    const roomRandom = await this.createFloorRandom(`${room.name}_stair_fix`);

    // Try to find a valid position within the room bounds
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const localX = roomRandom.nextInt(0, room.width - 1);
      const localY = roomRandom.nextInt(0, room.height - 1);
      
      // Convert to global coordinates for checking
      const globalX = room.position.x + localX;
      const globalY = room.position.y + localY;
      const positionKey = `${globalX},${globalY}`;
      
      // Check if this position conflicts with existing tiles
      if (!floorTilePositions.has(positionKey) && !wallTilePositions.has(positionKey)) {
        return { x: localX, y: localY }; // Return local coordinates for storage
      }
    }

    // If we couldn't find a valid position, try the center of the room
    const centerX = Math.floor(room.width / 2);
    const centerY = Math.floor(room.height / 2);
    const globalCenterX = room.position.x + centerX;
    const globalCenterY = room.position.y + centerY;
    const centerKey = `${globalCenterX},${globalCenterY}`;
    
    if (!floorTilePositions.has(centerKey) && !wallTilePositions.has(centerKey)) {
      return { x: centerX, y: centerY }; // Return local coordinates for storage
    }

    return null;
  }

  /**
   * Generate child name using alphabetic progression
   */
  private generateChildName(parentName: string, childIndex: number): string {
    const childChar = String.fromCharCode(65 + childIndex); // A, B, C, etc.
    return `${parentName}${childChar}`;
  }

  /**
   * Generate a valid stair location that doesn't conflict with floor or wall tiles
   */
  private async generateValidStairLocation(room: FloorDagNode, dungeonNodeName: string): Promise<{ x: number; y: number } | null> {
    if (!room.roomWidth || !room.roomHeight) {
      return null;
    }

    // Create a seeded random generator for this specific room's stair placement
    const roomRandom = await this.createFloorRandom(`${room.name}_stair`);

    // Get the generated floor tile data to check for conflicts
    const generatedFloorData = await this.getGeneratedFloorTileData(dungeonNodeName);
    if (!generatedFloorData) {
      // If we can't get tile data, fallback to simple random placement
      return {
        x: roomRandom.nextInt(0, room.roomWidth - 1),
        y: roomRandom.nextInt(0, room.roomHeight - 1)
      };
    }

    // Create sets of occupied positions for quick lookup
    const floorTilePositions = new Set<string>();
    const wallTilePositions = new Set<string>();
    
    generatedFloorData.tiles.floorTiles.forEach(tile => {
      floorTilePositions.add(`${tile.x},${tile.y}`);
    });
    
    generatedFloorData.tiles.wallTiles.forEach(tile => {
      wallTilePositions.add(`${tile.x},${tile.y}`);
    });

    // Try to find a valid position within the room bounds
    const maxAttempts = 50;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const x = roomRandom.nextInt(0, room.roomWidth - 1);
      const y = roomRandom.nextInt(0, room.roomHeight - 1);
      const positionKey = `${x},${y}`;
      
      // Check if this position conflicts with existing tiles
      if (!floorTilePositions.has(positionKey) && !wallTilePositions.has(positionKey)) {
        return { x, y };
      }
    }

    // If we couldn't find a valid position, try the center of the room
    const centerX = Math.floor(room.roomWidth / 2);
    const centerY = Math.floor(room.roomHeight / 2);
    const centerKey = `${centerX},${centerY}`;
    
    if (!floorTilePositions.has(centerKey) && !wallTilePositions.has(centerKey)) {
      return { x: centerX, y: centerY };
    }

    // As a last resort, return a random position (better than failing completely)
    console.warn(`Could not find ideal stair location for room ${room.name}, using fallback position`);
    return {
      x: roomRandom.nextInt(0, room.roomWidth - 1),
      y: roomRandom.nextInt(0, room.roomHeight - 1)
    };
  }

  /**
   * Get random direction for hallway branching
   */
  private getRandomDirection(floorRandom?: SeededRandom): 'left' | 'right' | 'center' {
    const directions: ('left' | 'right' | 'center')[] = ['left', 'right', 'center'];
    if (floorRandom) {
      return directions[floorRandom.nextInt(0, directions.length - 1)];
    }
    return directions[Math.floor(Math.random() * directions.length)];
  }

  /**
   * Calculate depth of each node in the dungeon DAG
   */
  private calculateDepths(nodes: DungeonDagNode[]): Record<string, number> {
    const depthMap: Record<string, number> = {};
    const visited = new Set<string>();
    
    // Find root (node with shortest name)
    const root = nodes.reduce((min, node) => 
      node.name.length < min.name.length ? node : min
    );
    
    // BFS to calculate depths
    const queue: { node: DungeonDagNode; depth: number }[] = [{ node: root, depth: 0 }];
    
    while (queue.length > 0) {
      const { node, depth } = queue.shift()!;
      
      if (visited.has(node.name)) continue;
      visited.add(node.name);
      depthMap[node.name] = depth;
      
      for (const childName of node.children) {
        const childNode = nodes.find(n => n.name === childName);
        if (childNode && !visited.has(childName)) {
          queue.push({ node: childNode, depth: depth + 1 });
        }
      }
    }
    
    return depthMap;
  }

  /**
   * Get floor layout for rendering
   */
  async getFloor(dungeonDagNodeName: string): Promise<FloorLayout | null> {
    const db = getDatabase();
    
    const nodes = await db.collection('floorDagNodes')
      .find({ dungeonDagNodeName })
      .limit(0) // 0 means no limit - get all results
      .toArray() as unknown as FloorDagNode[];
    
    if (nodes.length === 0) {
      return null;
    }
    
    return {
      dungeonDagNodeName,
      nodes
    };
  }

  /**
   * Get stairs information for a room
   */
  async getRoomStairs(floorDagNodeName: string): Promise<RoomStairs | null> {
    const db = getDatabase();
    
    const room = await db.collection('floorDagNodes')
      .findOne({ name: floorDagNodeName, isRoom: true }) as unknown as FloorDagNode | null;
    
    if (!room) {
      return null;
    }
    
    const stairs: RoomStairs = {};
    
    // Handle upward stairs
    if (room.hasUpwardStair && room.stairLocationX !== undefined && room.stairLocationY !== undefined) {
      // If the room already has stair connection info, use it
      if (room.stairFloorDagName && room.stairDungeonDagName) {
        stairs.upwardStair = {
          floorDagNodeName: room.stairFloorDagName,
          dungeonDagNodeName: room.stairDungeonDagName,
          locationX: room.stairLocationX,
          locationY: room.stairLocationY
        };
      } else {
        // For root rooms, find parent through dungeon node relationships
        const currentDungeonNode = await db.collection('dungeonDagNodes')
          .findOne({ name: room.dungeonDagNodeName }) as unknown as DungeonDagNode | null;
        
        if (currentDungeonNode?.parentFloorDagNodeName) {
          // Find the parent floor node to get the parent dungeon name
          const parentFloorNode = await db.collection('floorDagNodes')
            .findOne({ name: currentDungeonNode.parentFloorDagNodeName }) as unknown as FloorDagNode | null;
          
          if (parentFloorNode) {
            stairs.upwardStair = {
              floorDagNodeName: currentDungeonNode.parentFloorDagNodeName,
              dungeonDagNodeName: parentFloorNode.dungeonDagNodeName,
              locationX: room.stairLocationX,
              locationY: room.stairLocationY
            };
          }
        }
      }
    }
    
    // Handle downward stairs
    if (room.hasDownwardStair && room.stairLocationX !== undefined && room.stairLocationY !== undefined) {
      stairs.downwardStair = {
        floorDagNodeName: room.stairFloorDagName || '',
        dungeonDagNodeName: room.stairDungeonDagName || '',
        locationX: room.stairLocationX,
        locationY: room.stairLocationY
      };
    }
    
    return Object.keys(stairs).length > 0 ? stairs : null;
  }

  /**
   * Get the spawn location (root dungeon node)
   */
  async getSpawn(): Promise<string | null> {
    const db = getDatabase();
    
    // Find the root node (shortest name, typically 'A')
    const nodes = await db.collection('dungeonDagNodes').find({}).limit(0).toArray() as unknown as DungeonDagNode[];
    
    if (nodes.length === 0) {
      return null;
    }
    
    const root = nodes.reduce((min, node) => 
      node.name.length < min.name.length ? node : min
    );
    
    return root.name;
  }

  /**
   * Get generated floor data with positioned rooms, hallways, and floor tiles
   */
  async getGeneratedFloorData(dungeonDagNodeName: string): Promise<GeneratedFloorData | null> {
    // First get the raw floor layout
    const floorLayout = await this.getFloor(dungeonDagNodeName);
    
    if (!floorLayout) {
      return null;
    }
    
    // Process the DAG data into positioned layout with floor tiles
    try {
      const generatedData = ServerFloorGenerator.processFloorLayout(floorLayout);
      return generatedData;
    } catch (error) {
      console.error('Error generating floor data:', error);
      return null;
    }
  }

  /**
   * Get complete tile data for rendering (floors, walls, stairs, ceiling)
   * This is the most comprehensive endpoint for client rendering
   */
  async getGeneratedFloorTileData(dungeonDagNodeName: string): Promise<GeneratedFloorTileData | null> {
    // First get the generated floor data
    const generatedData = await this.getGeneratedFloorData(dungeonDagNodeName);
    
    if (!generatedData) {
      return null;
    }

    try {
      // Get all floor tiles
      const floorTiles = generatedData.floorTiles;
      
      // Generate stair tiles from rooms
      const { upwardStairs, downwardStairs } = WallGenerator.generateStairTiles(generatedData.rooms);
      
      // Generate wall tiles (excluding stair positions to avoid blocking stairs)
      const allStairPositions = [...upwardStairs, ...downwardStairs].map(stair => ({ x: stair.x, y: stair.y }));
      const wallTiles = WallGenerator.generateWalls(floorTiles, allStairPositions, {
        includeCorners: true,
        includeCeiling: false
      });

      const tileCoordinates: FloorTileCoordinates = {
        floorTiles,
        wallTiles,
        upwardStairTiles: upwardStairs,
        downwardStairTiles: downwardStairs
      };

      console.log(`🎯 Generated complete tile data for ${dungeonDagNodeName}:`);
      console.log(`  - Floor tiles: ${floorTiles.length}`);
      console.log(`  - Wall tiles: ${wallTiles.length}`);
      console.log(`  - Upward stairs: ${upwardStairs.length}`);
      console.log(`  - Downward stairs: ${downwardStairs.length}`);

      return {
        dungeonDagNodeName,
        bounds: generatedData.bounds,
        tiles: tileCoordinates
      };
    } catch (error) {
      console.error('Error generating complete tile data:', error);
      return null;
    }
  }

  /**
   * Mark a dungeon node as visited by a user
   */
  async markDungeonNodeVisited(dungeonDagNodeName: string, userId: string): Promise<void> {
    const db = getDatabase();
    
    // Use $addToSet to add userId to visitedByUserIds array only if it's not already there
    await db.collection('dungeonDagNodes').updateOne(
      { name: dungeonDagNodeName },
      { $addToSet: { visitedByUserIds: userId } }
    );
  }

  /**
   * Check if a user has visited a dungeon node
   */
  async hasUserVisitedDungeonNode(dungeonDagNodeName: string, userId: string): Promise<boolean> {
    const db = getDatabase();
    
    const dungeonNode = await db.collection('dungeonDagNodes')
      .findOne({ 
        name: dungeonDagNodeName,
        visitedByUserIds: userId 
      }) as unknown as DungeonDagNode | null;
    
    return dungeonNode !== null;
  }

  /**
   * Get all users who have visited a dungeon node
   */
  async getDungeonNodeVisitors(dungeonDagNodeName: string): Promise<string[]> {
    const db = getDatabase();
    
    const dungeonNode = await db.collection('dungeonDagNodes')
      .findOne({ name: dungeonDagNodeName }) as unknown as DungeonDagNode | null;
    
    return dungeonNode?.visitedByUserIds || [];
  }

  /**
   * Get all dungeon nodes visited by a user
   */
  async getDungeonNodesVisitedByUser(userId: string): Promise<string[]> {
    const db = getDatabase();
    
    const dungeonNodes = await db.collection('dungeonDagNodes')
      .find({ visitedByUserIds: userId })
      .limit(0) // 0 means no limit - get all results
      .toArray() as unknown as DungeonDagNode[];
    
    return dungeonNodes.map(node => node.name);
  }
}
