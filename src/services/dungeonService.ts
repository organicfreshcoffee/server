import { getDatabase } from '../config/database';
import { DungeonDagNode, FloorDagNode, FloorLayout, RoomStairs } from '../types/game';

export class DungeonService {
  private readonly ROOM_COUNT_MIN = 5;
  private readonly ROOM_COUNT_MAX = 10;
  private readonly ROOM_SIZE_MIN = 8;
  private readonly ROOM_SIZE_MAX = 20;
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

    // Generate children for root using the same random logic
    await this.generateDungeonChildren(rootDungeonNode);
    
    // Get all current nodes and generate a few more levels
    let allNodes = await db.collection('dungeonDagNodes').find({}).toArray() as unknown as DungeonDagNode[];
    
    // Generate 2-3 more levels to start with
    for (let level = 0; level < 2; level++) {
      const leafNodes = allNodes.filter(node => node.children.length === 0);
      
      for (const leafNode of leafNodes) {
        await this.generateDungeonChildren(leafNode);
      }
      
      // Refresh the nodes list
      allNodes = await db.collection('dungeonDagNodes').find({}).toArray() as unknown as DungeonDagNode[];
    }

    const totalFloors = allNodes.length;
    console.log(`Dungeon initialized with ${totalFloors} floors`);
  }

  /**
   * Check if we need to generate more floors based on player movement
   */
  async checkAndGenerateFloors(newFloorName: string, playerLevels: string[]): Promise<void> {
    const db = getDatabase();
    
    // Get all existing dungeon nodes
    const allNodes = await db.collection('dungeonDagNodes').find({}).toArray() as unknown as DungeonDagNode[];
    
    // Calculate depths of all floors
    const depthMap = this.calculateDepths(allNodes);
    const currentDepth = depthMap[newFloorName] || 0;
    
    // Find the deepest player level
    let deepestPlayerLevel = 0;
    for (const playerLevel of playerLevels) {
      const playerDepth = depthMap[playerLevel] || 0;
      deepestPlayerLevel = Math.max(deepestPlayerLevel, playerDepth);
    }

    // Find leaf nodes (nodes with no children) that aren't boss levels
    const leafNodes = allNodes.filter(node => 
      node.children.length === 0 && 
      !node.isBossLevel &&
      (depthMap[node.name] || 0) <= deepestPlayerLevel + this.GENERATION_BUFFER
    );

    // Generate children for leaf nodes that are close to players
    for (const leafNode of leafNodes) {
      await this.generateDungeonChildren(leafNode);
    }
  }

  /**
   * Generate children for a dungeon node
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
   * Recursively generate floor nodes
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

    const childrenCount = Math.floor(Math.random() * 3) + 1; // 1-3 children
    const children: string[] = [];

    for (let i = 0; i < childrenCount && roomCount.count < targetRoomCount; i++) {
      const childName = this.generateChildName(parentNode.name, i);
      children.push(childName);

      let childNode: FloorDagNode;

      if (parentNode.isRoom) {
        // Parent is room, child is hallway
        childNode = this.generateHallwayNode(childName, dungeonNodeName);
        childNode.parentDirection = this.getRandomDirection();
        // Calculate parentDoorOffset for hallway connecting to room
        const parentMinSide = Math.min(parentNode.roomWidth || 8, parentNode.roomHeight || 8);
        childNode.parentDoorOffset = Math.floor(Math.random() * Math.max(1, parentMinSide - 1)) + 1;
        // Set door location on parent room (this would be more sophisticated in a real implementation)
        this.setDoorLocation(parentNode, i, childrenCount);
      } else {
        // Parent is hallway, child can be room or hallway
        const isRoom = Math.random() < 0.7; // 70% chance of room
        
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
    }

    // Update parent with children
    parentNode.children = children;

    // Now recurse for each child
    for (const childName of children) {
      const childNode = floorNodes.find(node => node.name === childName);
      if (childNode && roomCount.count < targetRoomCount) {
        await this.generateFloorRecursive(childNode, dungeonNodeName, floorNodes, roomCount, targetRoomCount);
      }
    }
  }

  /**
   * Generate a room node
   */
  private generateRoomNode(name: string, dungeonNodeName: string, hasUpwardStair: boolean): FloorDagNode {
    return {
      name,
      dungeonDagNodeName: dungeonNodeName,
      children: [],
      isRoom: true,
      hasUpwardStair,
      hasDownwardStair: false, // Will be set later
      roomWidth: Math.floor(Math.random() * (this.ROOM_SIZE_MAX - this.ROOM_SIZE_MIN + 1)) + this.ROOM_SIZE_MIN,
      roomHeight: Math.floor(Math.random() * (this.ROOM_SIZE_MAX - this.ROOM_SIZE_MIN + 1)) + this.ROOM_SIZE_MIN
    };
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
  private setDoorLocation(roomNode: FloorDagNode, doorIndex: number, totalDoors: number): void {
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
  private placeDownwardStairs(floorNodes: FloorDagNode[], dungeonNodeName: string): void {
    const rooms = floorNodes.filter(node => node.isRoom);
    const stairCount = Math.floor(Math.random() * 2) + 1; // 1-2 stairs
    
    for (let i = 0; i < Math.min(stairCount, rooms.length); i++) {
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      if (!room.hasDownwardStair) {
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
    const nodes = await db.collection('dungeonDagNodes').find({}).toArray() as unknown as DungeonDagNode[];
    
    if (nodes.length === 0) {
      return null;
    }
    
    const root = nodes.reduce((min, node) => 
      node.name.length < min.name.length ? node : min
    );
    
    return root.name;
  }
}
