import { getDatabase } from '../config/database';
import { DungeonDagNode, FloorDagNode, FloorLayout, RoomStairs } from '../types/game';
import { ServerFloorGenerator } from './floorGenerator';
import { GeneratedFloorData, GeneratedFloorTileData, FloorTileCoordinates } from '../types/floorGeneration';
import { WallGenerator } from './wallGenerator';

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

  /**
   * Initialize the dungeon with the root floor and randomly generated levels
   */
  async initializeDungeon(): Promise<void> {
    const db = getDatabase();
    
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
    await this.generateFloor(rootDungeonNode.name, true, 0, 12); // Root floor with upward stair, max depth 12

    // eslint-disable-next-line no-console
    console.log('Dungeon initialized with root floor A');
  }

  /**
   * Check if we need to generate more floors based on player movement
   */
  async checkAndGenerateFloors(newFloorName: string, playerLevels: string[]): Promise<void> {
    const db = getDatabase();
    
    // Get all existing dungeon nodes
    const allNodes = await db.collection('dungeonDagNodes').find({}).limit(0).toArray() as unknown as DungeonDagNode[];
    
    // Calculate depths of all floors
    const depthMap = this.calculateDepths(allNodes);
    
    // Find the deepest player level
    let deepestPlayerLevel = 0;
    for (const playerLevel of playerLevels) {
      const playerDepth = depthMap[playerLevel] || 0;
      deepestPlayerLevel = Math.max(deepestPlayerLevel, playerDepth);
    }

    // Find leaf nodes (nodes with no children) that aren't boss levels and are close to players
    const leafNodes = allNodes.filter(node => 
      node.children.length === 0 && 
      !node.isBossLevel &&
      (depthMap[node.name] || 0) <= deepestPlayerLevel + this.GENERATION_BUFFER
    );

    if (leafNodes.length > 0) {
      // Use balanced generation for nearby leaf nodes
      const nodeQueue = leafNodes.map(node => ({ 
        node, 
        depth: depthMap[node.name] || 0 
      }));
      
      const currentNodeCount = allNodes.length;
      const generatedCount = { count: currentNodeCount };
      const maxNodes = currentNodeCount + 10; // Limit additional nodes
      const maxDepth = deepestPlayerLevel + this.GENERATION_BUFFER + 3;
      
      await this.generateDungeonRecursive(nodeQueue, maxDepth, generatedCount, maxNodes);
    }
  }

  /**
   * Generate children for a dungeon node using balanced exploration
   */
  private async generateDungeonChildren(parentNode: DungeonDagNode): Promise<void> {
    const db = getDatabase();
    
    // Generate 1-5 downward stairs
    const downStairCount = Math.floor(Math.random() * 5) + 1;
    const children: string[] = [];
    
    for (let i = 0; i < downStairCount; i++) {
      const childName = this.generateChildName(parentNode.name, children.length);
      children.push(childName);
      
      const childNode: DungeonDagNode = {
        name: childName,
        children: [],
        isDownwardsFromParent: true,
        isBossLevel: Math.random() < 0.1, // 10% chance of boss level
        visitedByUserIds: [] // Initialize empty array for tracking visitors
      };
      
      await db.collection('dungeonDagNodes').insertOne(childNode);
      await this.generateFloor(childNode.name, false);
    }

    // Update parent with children
    await db.collection('dungeonDagNodes').updateOne(
      { name: parentNode.name },
      { $set: { children } }
    );
  }

  /**
   * Recursively generate dungeon structure with balanced exploration
   */
  private async generateDungeonRecursive(
    _nodeQueue: { node: DungeonDagNode; depth: number }[],
    _maxDepth: number,
    _generatedCount: { count: number },
    _maxNodes: number
  ): Promise<void> {
    // The recursive generation is now handled within generateFloor -> placeDownwardStairsAndCreateChildren
    // This method is kept for compatibility but the actual generation happens during floor creation
    return;
  }

  /**
   * Generate a floor layout
   */
  private async generateFloor(dungeonNodeName: string, hasUpwardStair: boolean, depth: number = 0, maxDepth: number = 12): Promise<void> {
    const db = getDatabase();
    
    // Generate root room
    const rootRoomName = `${dungeonNodeName}_A`;
    const targetRoomCount = Math.floor(Math.random() * (this.ROOM_COUNT_MAX - this.ROOM_COUNT_MIN + 1)) + this.ROOM_COUNT_MIN;
    
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
        
        // Generate children for current node
        const childrenCount = Math.floor(Math.random() * 4) + 1; // 1-4 children for better balance
        const children: string[] = [];
        
        // Decrease chance of generation as we get closer to target
        const remainingRooms = targetRoomCount - roomCount.count;
        const generationChance = Math.min(0.8, remainingRooms / (targetRoomCount * 0.3));
        
        if (Math.random() > generationChance && roomCount.count > targetRoomCount * 0.5) {
          continue; // Skip generation for this node occasionally to create variation
        }

        for (let i = 0; i < childrenCount && roomCount.count < targetRoomCount; i++) {
          const childName = this.generateChildName(currentNode.name, i);
          children.push(childName);

          let childNode: FloorDagNode;

          if (currentNode.isRoom) {
            // Parent is room, child is hallway
            childNode = this.generateHallwayNode(childName, dungeonNodeName);
            childNode.parentDirection = this.getRandomDirection();
            // Calculate parentDoorOffset for hallway connecting to room
            const parentMinSide = Math.min(currentNode.roomWidth || 8, currentNode.roomHeight || 8);
            childNode.parentDoorOffset = Math.floor(Math.random() * Math.max(1, parentMinSide - 1)) + 1;
            // Set door location on parent room
            this.setDoorLocation(currentNode, i, childrenCount);
          } else {
            // Parent is hallway, child can be room or hallway
            // Force room generation if we're running low on iterations and need more rooms
            const remainingRooms = targetRoomCount - roomCount.count;
            const forceRoom = remainingRooms > 0 && iterationCount > maxIterations * 0.7;
            const isRoom = forceRoom || Math.random() < 0.6; // 60% chance of room, or forced if needed
            
            if (isRoom) {
              childNode = await this.generateRoomNode(childName, dungeonNodeName, false);
              roomCount.count++;
              // Calculate parentDoorOffset as random number from 1 to min(width, height) - 1
              const minSide = Math.min(childNode.roomWidth || 8, childNode.roomHeight || 8);
              childNode.parentDoorOffset = Math.floor(Math.random() * Math.max(1, minSide - 1)) + 1;
              childNode.parentDirection = this.getRandomDirection();
            } else {
              childNode = this.generateHallwayNode(childName, dungeonNodeName);
              childNode.parentDirection = this.getRandomDirection();
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
  private async generateRoomNode(name: string, dungeonNodeName: string, hasUpwardStair: boolean): Promise<FloorDagNode> {
    const roomWidth = Math.floor(Math.random() * (this.ROOM_SIZE_MAX - this.ROOM_SIZE_MIN + 1)) + this.ROOM_SIZE_MIN;
    const roomHeight = Math.floor(Math.random() * (this.ROOM_SIZE_MAX - this.ROOM_SIZE_MIN + 1)) + this.ROOM_SIZE_MIN;
    
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
      room.stairLocationX = Math.floor(Math.random() * roomWidth);
      room.stairLocationY = Math.floor(Math.random() * roomHeight);
      
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
  private generateHallwayNode(name: string, dungeonNodeName: string): FloorDagNode {
    return {
      name,
      dungeonDagNodeName: dungeonNodeName,
      children: [],
      isRoom: false,
      hallwayLength: Math.floor(Math.random() * (this.HALLWAY_LENGTH_MAX - this.HALLWAY_LENGTH_MIN + 1)) + this.HALLWAY_LENGTH_MIN
    };
  }

  /**
   * Set door location on a room
   */
  private setDoorLocation(roomNode: FloorDagNode, doorIndex: number, _totalDoors: number): void {
    if (!roomNode.roomWidth || !roomNode.roomHeight) return;
    
    // Simple door placement - distribute along walls
    const side = doorIndex % 4; // 0: top, 1: right, 2: bottom, 3: left
    
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
    const rooms = floorNodes.filter(node => node.isRoom);
    const stairCount = Math.floor(Math.random() * 2) + 1; // 1-2 stairs
    const childrenNames: string[] = [];
    const roomsToUpdate: FloorDagNode[] = [];
    
    for (let i = 0; i < Math.min(stairCount, rooms.length); i++) {
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      // Ensure a room can only have either upward OR downward stairs, not both
      if (!room.hasDownwardStair && !room.hasUpwardStair) {
        // Create child dungeon node
        const childName = this.generateChildName(dungeonNodeName, i);
        childrenNames.push(childName);
        
        const childNode: DungeonDagNode = {
          name: childName,
          children: [],
          isDownwardsFromParent: true,
          isBossLevel: Math.random() < 0.1, // 10% chance of boss level
          parentFloorDagNodeName: room.name,
          visitedByUserIds: [] // Initialize empty array for tracking visitors
        };
        
        await db.collection('dungeonDagNodes').insertOne(childNode);
        
        // Set up the downward stair in the room
        room.hasDownwardStair = true;
        room.stairLocationX = Math.floor(Math.random() * (room.roomWidth || 10));
        room.stairLocationY = Math.floor(Math.random() * (room.roomHeight || 10));
        room.stairDungeonDagName = childName;
        room.stairFloorDagName = `${childName}_A`; // Child floor's root room
        
        roomsToUpdate.push(room);
        
        // Generate the child floor with upward stair - pass depth + 1
        await this.generateFloor(childName, true, depth + 1, maxDepth);
      }
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
   * Generate child name using alphabetic progression
   */
  private generateChildName(parentName: string, childIndex: number): string {
    const childChar = String.fromCharCode(65 + childIndex); // A, B, C, etc.
    return `${parentName}${childChar}`;
  }

  /**
   * Get random direction for hallway branching
   */
  private getRandomDirection(): 'left' | 'right' | 'center' {
    const directions: ('left' | 'right' | 'center')[] = ['left', 'right', 'center'];
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
