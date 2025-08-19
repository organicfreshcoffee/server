import { FloorDagNode, FloorLayout } from '../types/game';
import { 
  Vector2, 
  CubePosition, 
  ServerRoom, 
  ServerHallway, 
  GeneratedFloorData,
  FloorHallwaySegment,
  HallwayGenerationOptions
} from '../types/floorGeneration';

/**
 * Server-side floor generator that processes DAG data into positioned floor layouts
 * Adapted from client-side floorGenerator.ts
 */
export class ServerFloorGenerator {
  /**
   * Process DAG data into positioned floor layout with floor tiles
   */
  static processFloorLayout(floorLayout: FloorLayout): GeneratedFloorData {
    const { dungeonDagNodeName, nodes } = floorLayout;
    
    // Create maps for quick lookup
    const nodeMap = new Map<string, FloorDagNode>();
    const processedNodes = new Map<string, ServerRoom | ServerHallway>();
    
    nodes.forEach(node => nodeMap.set(node.name, node));
    
    // Find root node (no parent references it)
    const rootNode = nodes.find(node => 
      !nodes.some(other => other.children.includes(node.name))
    );
    
    if (!rootNode) {
      throw new Error('No root node found in DAG');
    }

    console.log(`🌳 Processing DAG with root: ${rootNode.name}`);
    
    // Start positioning from root room at origin
    this.processNode(rootNode, nodeMap, processedNodes, { x: 0, y: 0 }, 'north');
    
    // Separate rooms and hallways
    const rooms: ServerRoom[] = [];
    const hallways: ServerHallway[] = [];
    
    processedNodes.forEach(node => {
      if ('width' in node) {
        rooms.push(node as ServerRoom);
      } else {
        hallways.push(node as ServerHallway);
      }
    });

    // Calculate bounds
    const bounds = this.calculateBounds(rooms, hallways);
    
    // Generate floor tiles
    const roomTiles = this.generateRoomTiles(rooms);
    const hallwayTiles = ServerHallwayGenerator.generateMultipleHallwayFloors(hallways);
    
    // Combine all floor tiles
    const allFloorTiles: CubePosition[] = [];
    roomTiles.forEach(tiles => allFloorTiles.push(...tiles));
    hallwayTiles.forEach(tiles => allFloorTiles.push(...tiles));
    
    // Remove duplicates
    const uniqueFloorTiles = this.removeDuplicateCoordinates(allFloorTiles);
    
    console.log(`🏗️ Generated layout: ${rooms.length} rooms, ${hallways.length} hallways, ${uniqueFloorTiles.length} floor tiles`);
    
    return {
      dungeonDagNodeName,
      rooms,
      hallways,
      bounds,
      rootNode: rootNode.name,
      floorTiles: uniqueFloorTiles,
      roomTiles,
      hallwayTiles
    };
  }

  /**
   * Recursively process nodes and calculate positions
   */
  private static processNode(
    node: FloorDagNode,
    nodeMap: Map<string, FloorDagNode>,
    processedNodes: Map<string, ServerRoom | ServerHallway>,
    position: Vector2,
    entrance: 'north' | 'south' | 'east' | 'west'
  ): void {
    if (processedNodes.has(node.name)) {
      return; // Already processed
    }

    if (node.isRoom) {
      const room: ServerRoom = {
        id: node.name, // Using name as ID since it's unique
        name: node.name,
        position: { x: position.x, y: position.y },
        width: node.roomWidth!,
        height: node.roomHeight!,
        hasUpwardStair: node.hasUpwardStair || false,
        hasDownwardStair: node.hasDownwardStair || false,
        stairLocationX: node.stairLocationX,
        stairLocationY: node.stairLocationY,
        children: node.children,
        parentDirection: node.parentDirection,
        parentDoorOffset: node.parentDoorOffset
      };

      // Calculate door position and side based on entrance direction
      this.calculateRoomDoor(room, entrance);
      
      processedNodes.set(node.name, room);
      
      // Process children from this room
      node.children.forEach(childName => {
        const childNode = nodeMap.get(childName);
        if (childNode) {
          const { childPosition, childEntrance } = this.calculateChildPosition(
            childNode, room, entrance
          );
          this.processNode(childNode, nodeMap, processedNodes, childPosition, childEntrance);
        }
      });
      
    } else {
      // Hallway node
      const hallway: ServerHallway = {
        id: node.name,
        name: node.name,
        length: node.hallwayLength!,
        parentDirection: node.parentDirection,
        parentDoorOffset: node.parentDoorOffset,
        children: node.children
      };

      // Calculate hallway path based on parent direction and entrance
      this.calculateHallwayPath(hallway, position, entrance);
      
      processedNodes.set(node.name, hallway);
      
      // Process children from end of hallway
      node.children.forEach(childName => {
        const childNode = nodeMap.get(childName);
        if (childNode) {
          const childEntrance = this.getOppositeDirection(hallway.direction!);
          this.processNode(childNode, nodeMap, processedNodes, hallway.endPosition!, childEntrance);
        }
      });
    }
  }

  /**
   * Calculate door position for a room based on entrance direction
   */
  private static calculateRoomDoor(room: ServerRoom, entrance: 'north' | 'south' | 'east' | 'west'): void {
    const { width, height, position } = room;
    
    // Map cardinal directions to door sides
    const doorSideMap = {
      'north': 'top' as const,
      'south': 'bottom' as const,
      'east': 'right' as const,
      'west': 'left' as const
    };
    
    room.doorSide = doorSideMap[entrance];
    
    switch (entrance) {
      case 'north': // Door on north wall (top)
        room.doorPosition = {
          x: position.x + Math.floor(width / 2),
          y: position.y + height - 1
        };
        break;
      case 'south': // Door on south wall (bottom) 
        room.doorPosition = {
          x: position.x + Math.floor(width / 2),
          y: position.y
        };
        break;
      case 'east': // Door on east wall (right)
        room.doorPosition = {
          x: position.x + width - 1,
          y: position.y + Math.floor(height / 2)
        };
        break;
      case 'west': // Door on west wall (left)
        room.doorPosition = {
          x: position.x,
          y: position.y + Math.floor(height / 2)
        };
        break;
    }
  }

  /**
   * Calculate the position for a child node relative to its parent
   */
  private static calculateChildPosition(
    childNode: FloorDagNode,
    parentRoom: { position: Vector2; width: number; height: number },
    parentEntrance: 'north' | 'south' | 'east' | 'west'
  ): { childPosition: Vector2; childEntrance: 'north' | 'south' | 'east' | 'west' } {
    const { position, width, height } = parentRoom;
    const direction = childNode.parentDirection!;
    const offset = childNode.parentDoorOffset || 0;
    
    // Determine which side of the room based on entrance and relative direction
    let childEntrance: 'north' | 'south' | 'east' | 'west';
    let childPosition: Vector2;
    
    // Calculate absolute direction from relative direction
    const absoluteDirection = this.getAbsoluteDirection(parentEntrance, direction);
    
    // No gap needed for seamless connections
    const gap = 0;
    
    switch (absoluteDirection) {
      case 'north': // Child extends north from parent
        childEntrance = 'south';
        childPosition = {
          x: position.x + offset,
          y: position.y + height + gap
        };
        break;
      case 'south': // Child extends south from parent
        childEntrance = 'north';
        childPosition = {
          x: position.x + offset,
          y: position.y - (childNode.isRoom ? childNode.roomHeight! : 1) - gap
        };
        break;
      case 'east': // Child extends east from parent
        childEntrance = 'west';
        childPosition = {
          x: position.x + width + gap,
          y: position.y + offset
        };
        break;
      case 'west': // Child extends west from parent
        childEntrance = 'east';
        childPosition = {
          x: position.x - (childNode.isRoom ? childNode.roomWidth! : 1) - gap,
          y: position.y + offset
        };
        break;
    }
    
    return { childPosition, childEntrance };
  }

  /**
   * Calculate hallway path from start position
   */
  private static calculateHallwayPath(
    hallway: ServerHallway,
    startPosition: Vector2,
    entrance: 'north' | 'south' | 'east' | 'west'
  ): void {
    hallway.startPosition = { x: startPosition.x, y: startPosition.y };
    
    // Direction vector based on parent direction
    let direction: Vector2;
    
    if (hallway.parentDirection) {
      // For hallways with a parent direction, we want to extend away from the parent
      // The entrance tells us which side of the parent we're on
      // We should extend in the opposite direction to go away from parent
      const awayDirection = this.getOppositeDirectionString(entrance);
      direction = this.getDirectionVector(awayDirection);
    } else {
      // Continue straight in the entrance direction
      direction = this.getDirectionVector(entrance);
    }
    
    hallway.direction = direction;
    hallway.endPosition = {
      x: startPosition.x + direction.x * hallway.length,
      y: startPosition.y + direction.y * hallway.length
    };
    
    // Create segments for rendering
    hallway.segments = [{
      start: { x: hallway.startPosition.x, y: hallway.startPosition.y },
      end: { x: hallway.endPosition.x, y: hallway.endPosition.y },
      direction: { x: direction.x, y: direction.y },
      length: hallway.length
    }];
  }

  /**
   * Convert relative direction to absolute direction
   */
  private static getAbsoluteDirection(
    currentDirection: 'north' | 'south' | 'east' | 'west',
    relativeDirection: 'left' | 'right' | 'center'
  ): 'north' | 'south' | 'east' | 'west' {
    const rotationMap: Record<string, Record<string, 'north' | 'south' | 'east' | 'west'>> = {
      'north': { left: 'west', right: 'east', center: 'north' },
      'south': { left: 'east', right: 'west', center: 'south' },
      'east': { left: 'north', right: 'south', center: 'east' },
      'west': { left: 'south', right: 'north', center: 'west' }
    };
    
    return rotationMap[currentDirection][relativeDirection];
  }

  /**
   * Get direction vector for cardinal direction
   */
  private static getDirectionVector(direction: 'north' | 'south' | 'east' | 'west'): Vector2 {
    switch (direction) {
      case 'north': return { x: 0, y: 1 };
      case 'south': return { x: 0, y: -1 };
      case 'east': return { x: 1, y: 0 };
      case 'west': return { x: -1, y: 0 };
    }
  }

  /**
   * Get opposite direction from string
   */
  private static getOppositeDirectionString(direction: 'north' | 'south' | 'east' | 'west'): 'north' | 'south' | 'east' | 'west' {
    switch (direction) {
      case 'north': return 'south';
      case 'south': return 'north';
      case 'east': return 'west';
      case 'west': return 'east';
    }
  }

  /**
   * Get opposite direction
   */
  private static getOppositeDirection(direction: Vector2): 'north' | 'south' | 'east' | 'west' {
    if (direction.x === 0 && direction.y === 1) return 'south';
    if (direction.x === 0 && direction.y === -1) return 'north';
    if (direction.x === 1 && direction.y === 0) return 'west';
    if (direction.x === -1 && direction.y === 0) return 'east';
    return 'north'; // fallback
  }

  /**
   * Calculate bounds of the entire floor
   */
  private static calculateBounds(rooms: ServerRoom[], hallways: ServerHallway[]): { width: number; height: number } {
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    
    // Check room bounds
    rooms.forEach(room => {
      minX = Math.min(minX, room.position.x);
      maxX = Math.max(maxX, room.position.x + room.width);
      minY = Math.min(minY, room.position.y);
      maxY = Math.max(maxY, room.position.y + room.height);
    });
    
    // Check hallway bounds
    hallways.forEach(hallway => {
      if (hallway.startPosition && hallway.endPosition) {
        minX = Math.min(minX, hallway.startPosition.x, hallway.endPosition.x);
        maxX = Math.max(maxX, hallway.startPosition.x, hallway.endPosition.x);
        minY = Math.min(minY, hallway.startPosition.y, hallway.endPosition.y);
        maxY = Math.max(maxY, hallway.startPosition.y, hallway.endPosition.y);
      }
    });
    
    return {
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Generate floor tiles for all rooms
   */
  private static generateRoomTiles(rooms: ServerRoom[]): Map<string, CubePosition[]> {
    const roomTiles = new Map<string, CubePosition[]>();
    
    rooms.forEach(room => {
      const tiles: CubePosition[] = [];
      
      for (let x = room.position.x; x < room.position.x + room.width; x++) {
        for (let y = room.position.y; y < room.position.y + room.height; y++) {
          tiles.push({ x, y });
        }
      }
      
      roomTiles.set(room.name, tiles);
    });
    
    return roomTiles;
  }

  /**
   * Remove duplicate coordinates
   */
  private static removeDuplicateCoordinates(coordinates: CubePosition[]): CubePosition[] {
    const uniqueCoords = new Map<string, CubePosition>();
    
    coordinates.forEach(coord => {
      const key = `${coord.x},${coord.y}`;
      uniqueCoords.set(key, coord);
    });
    
    return Array.from(uniqueCoords.values());
  }
}

/**
 * Server-side hallway generator that generates hallway floor coordinates
 * Adapted from client-side hallwayGenerator.ts
 */
export class ServerHallwayGenerator {
  private static readonly DEFAULT_OPTIONS: Required<HallwayGenerationOptions> = {
    width: 1,
    cornerRadius: 1,
    minimizeOverlaps: true
  };

  /**
   * Generate floor coordinates for a single hallway
   */
  static generateHallwayFloor(
    hallway: ServerHallway,
    options: HallwayGenerationOptions = {}
  ): CubePosition[] {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    
    if (!hallway.segments || hallway.segments.length === 0) {
      console.warn(`No segments found for hallway ${hallway.name}`);
      return [];
    }

    let coordinates: CubePosition[] = [];
    
    // Generate coordinates for each segment
    hallway.segments.forEach(segment => {
      const segmentCoords = this.generateSegmentCoordinates(segment, opts.width);
      coordinates = coordinates.concat(segmentCoords);
    });

    // Remove duplicates to avoid overlaps
    if (opts.minimizeOverlaps) {
      coordinates = this.removeDuplicateCoordinates(coordinates);
    }

    console.log(`🛤️ Generated ${coordinates.length} floor cubes for hallway ${hallway.name}`);
    return coordinates;
  }

  /**
   * Generate floor coordinates for multiple hallways
   */
  static generateMultipleHallwayFloors(
    hallways: ServerHallway[],
    options: HallwayGenerationOptions = {}
  ): Map<string, CubePosition[]> {
    const opts = { ...this.DEFAULT_OPTIONS, ...options };
    const hallwayFloors = new Map<string, CubePosition[]>();
    
    hallways.forEach(hallway => {
      const coordinates = this.generateHallwayFloor(hallway, opts);
      hallwayFloors.set(hallway.name, coordinates);
    });

    return hallwayFloors;
  }

  /**
   * Generate coordinates for a single hallway segment
   */
  private static generateSegmentCoordinates(
    segment: FloorHallwaySegment,
    width: number
  ): CubePosition[] {
    const coordinates: CubePosition[] = [];
    const { start, end } = segment;
    
    // Calculate direction and length
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) {
      // Single point hallway
      return this.generateWidthCoordinates(start.x, start.y, width, segment.direction);
    }
    
    // Normalize direction
    const dirX = dx / length;
    const dirY = dy / length;
    
    // Calculate perpendicular for width
    const perpX = -dirY;
    const perpY = dirX;
    
    // Number of steps along the segment
    const steps = Math.max(1, Math.ceil(length));
    
    // Generate cubes along the segment (excluding end point to avoid overlaps with rooms)
    for (let i = 0; i < steps; i++) {
      const t = steps > 0 ? i / steps : 0;
      const centerX = start.x + dirX * length * t;
      const centerY = start.y + dirY * length * t;
      
      // Add cubes for width
      const widthCoords = this.generateWidthCoordinates(
        centerX, 
        centerY, 
        width, 
        { x: perpX, y: perpY }
      );
      
      coordinates.push(...widthCoords);
    }
    
    return coordinates;
  }

  /**
   * Generate coordinates for hallway width at a specific point
   */
  private static generateWidthCoordinates(
    centerX: number,
    centerY: number,
    width: number,
    perpDirection: Vector2
  ): CubePosition[] {
    const coordinates: CubePosition[] = [];
    
    for (let w = 0; w < width; w++) {
      const widthOffset = w - Math.floor(width / 2);
      const finalX = Math.round(centerX + perpDirection.x * widthOffset);
      const finalY = Math.round(centerY + perpDirection.y * widthOffset);
      
      coordinates.push({ x: finalX, y: finalY });
    }
    
    return coordinates;
  }

  /**
   * Remove duplicate coordinates
   */
  private static removeDuplicateCoordinates(coordinates: CubePosition[]): CubePosition[] {
    const uniqueCoords = new Map<string, CubePosition>();
    
    coordinates.forEach(coord => {
      const key = `${coord.x},${coord.y}`;
      uniqueCoords.set(key, coord);
    });
    
    return Array.from(uniqueCoords.values());
  }
}
