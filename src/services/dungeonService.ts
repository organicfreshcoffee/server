import { getDatabase } from '../config/database';
import { DungeonDagNode, FloorDagNode, FloorLayout, RoomStairs } from '../types/game';

/**
 * DungeonService manages the procedural generation of dungeon structures using two separate DAGs:
 * 1. Dungeon DAG: Represents the overall dungeon structure with floors connected by stairs
 * 2. Floor DAG: Represents the room/hallway layout within each individual floor
 */
export class DungeonService {
  private readonly ROOM_COUNT_MIN = 5;
  private readonly ROOM_COUNT_MAX = 15;
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
      isBossLevel: false
    };

    await db.collection('dungeonDagNodes').insertOne(rootDungeonNode);
    await this.generateFloor(rootDungeonNode.name, true); // Root floor with upward stair

    // Use balanced recursive generation
    const nodeQueue = [{ node: rootDungeonNode, depth: 0 }];
    const generatedCount = { count: 1 }; // Root already counted
    const maxNodes = 25; // Limit total nodes to prevent infinite generation
    const maxDepth = 8; // Maximum depth
    
    await this.generateDungeonRecursive(nodeQueue, maxDepth, generatedCount, maxNodes);

    const totalFloors = generatedCount.count;
    console.log(`Dungeon initialized with ${totalFloors} floors`);
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
    
    // Generate 1-2 downward stairs
    const downStairCount = Math.floor(Math.random() * 2) + 1;
    const children: string[] = [];
    
    for (let i = 0; i < downStairCount; i++) {
      const childName = this.generateChildName(parentNode.name, children.length);
      children.push(childName);
      
      const childNode: DungeonDagNode = {
        name: childName,
        children: [],
        isDownwardsFromParent: true,
        isBossLevel: Math.random() < 0.1 // 10% chance of boss level
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
    nodeQueue: { node: DungeonDagNode; depth: number }[],
    maxDepth: number,
    generatedCount: { count: number },
    maxNodes: number
  ): Promise<void> {
    const db = getDatabase();
    
    while (nodeQueue.length > 0 && generatedCount.count < maxNodes) {
      // Process nodes at current depth level for balanced exploration
      const currentLevelNodes: { node: DungeonDagNode; depth: number }[] = [];
      const currentDepth = nodeQueue[0].depth;
      
      // Collect all nodes at current depth
      while (nodeQueue.length > 0 && nodeQueue[0].depth === currentDepth) {
        currentLevelNodes.push(nodeQueue.shift()!);
      }
      
      // Generate children for each node at this level
      for (const { node, depth } of currentLevelNodes) {
        if (depth >= maxDepth || generatedCount.count >= maxNodes) {
          continue;
        }
        
        // 70% chance to generate children, decreasing with depth
        const generationChance = Math.max(0.3, 0.9 - (depth * 0.15));
        if (Math.random() > generationChance) {
          continue;
        }
        
        const downStairCount = Math.floor(Math.random() * 2) + 1;
        const children: string[] = [];
        
        for (let i = 0; i < downStairCount && generatedCount.count < maxNodes; i++) {
          const childName = this.generateChildName(node.name, children.length);
          children.push(childName);
          generatedCount.count++;
          
          const childNode: DungeonDagNode = {
            name: childName,
            children: [],
            isDownwardsFromParent: true,
            isBossLevel: depth >= maxDepth - 1 ? Math.random() < 0.3 : Math.random() < 0.1
          };
          
          await db.collection('dungeonDagNodes').insertOne(childNode);
          await this.generateFloor(childNode.name, false);
          
          // Add child to queue for next level processing
          nodeQueue.push({ node: childNode, depth: depth + 1 });
        }
        
        // Update parent with children
        if (children.length > 0) {
          await db.collection('dungeonDagNodes').updateOne(
            { name: node.name },
            { $set: { children } }
          );
        }
      }
    }
  }

  /**
   * Generate a floor layout
   */
  private async generateFloor(dungeonNodeName: string, hasUpwardStair: boolean): Promise<void> {
    const db = getDatabase();
    
    // Generate root room
    const rootRoomName = `${dungeonNodeName}_A`;
    const targetRoomCount = Math.floor(Math.random() * (this.ROOM_COUNT_MAX - this.ROOM_COUNT_MIN + 1)) + this.ROOM_COUNT_MIN;
    
    const floorNodes: FloorDagNode[] = [];
    const roomCount = { count: 1 }; // Use object to pass by reference
    
    // Generate root room
    const rootRoom = this.generateRoomNode(rootRoomName, dungeonNodeName, hasUpwardStair);
    floorNodes.push(rootRoom);
    
    // Generate floor recursively
    await this.generateFloorRecursive(rootRoom, dungeonNodeName, floorNodes, roomCount, targetRoomCount);
    
    // Randomly place downward stairs in rooms
    this.placeDownwardStairs(floorNodes, dungeonNodeName);
    
    // Insert all floor nodes
    await db.collection('floorDagNodes').insertMany(floorNodes);
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
    
    while (nodeQueue.length > 0 && roomCount.count < targetRoomCount) {
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
            const isRoom = Math.random() < 0.6; // 60% chance of room (slightly less to prevent too many rooms)
            
            if (isRoom) {
              childNode = this.generateRoomNode(childName, dungeonNodeName, false);
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
  private generateRoomNode(name: string, dungeonNodeName: string, hasUpwardStair: boolean): FloorDagNode {
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
    
    // Set stair location coordinates when hasUpwardStair is true
    if (hasUpwardStair) {
      room.stairLocationX = Math.floor(Math.random() * roomWidth);
      room.stairLocationY = Math.floor(Math.random() * roomHeight);
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
   * Randomly place downward stairs in rooms
   */
  private placeDownwardStairs(floorNodes: FloorDagNode[], _dungeonNodeName: string): void {
    const rooms = floorNodes.filter(node => node.isRoom);
    const stairCount = Math.floor(Math.random() * 2) + 1; // 1-2 stairs
    
    for (let i = 0; i < Math.min(stairCount, rooms.length); i++) {
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      // Ensure a room can only have either upward OR downward stairs, not both
      if (!room.hasDownwardStair && !room.hasUpwardStair) {
        room.hasDownwardStair = true;
        room.stairLocationX = Math.floor(Math.random() * (room.roomWidth || 10));
        room.stairLocationY = Math.floor(Math.random() * (room.roomHeight || 10));
        // stairDungeonDagName will be set when the child dungeon node is created
      }
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
    
    if (room.hasUpwardStair && room.stairLocationX !== undefined && room.stairLocationY !== undefined) {
      stairs.upwardStair = {
        floorDagNodeName: room.stairFloorDagName || '',
        dungeonDagNodeName: room.stairDungeonDagName || '',
        locationX: room.stairLocationX,
        locationY: room.stairLocationY
      };
    }
    
    if (room.hasDownwardStair && room.stairLocationX !== undefined && room.stairLocationY !== undefined) {
      stairs.downwardStair = {
        floorDagNodeName: room.stairFloorDagName || '',
        dungeonDagNodeName: room.stairDungeonDagName || '',
        locationX: room.stairLocationX,
        locationY: room.stairLocationY
      };
    }
    
    return stairs;
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
}
