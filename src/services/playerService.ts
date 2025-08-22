import { getDatabase } from '../config/database';
import { Player, Position } from '../types/game';

export class PlayerService {
  private readonly collection = 'players';

  async createPlayer(userId: string, username: string, email?: string): Promise<Player> {
    const db = getDatabase();
    
    const player: Omit<Player, 'id'> = {
      userId,
      username,
      email,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      level: 1,
      experience: 0,
      lastUpdate: new Date(),
      isOnline: false,
      isAlive: true,
      currentDungeonDagNodeName: 'A', // Default to root floor
    };

    const result = await db.collection(this.collection).insertOne(player);
    
    return {
      id: result.insertedId.toString(),
      ...player,
    };
  }

  async getPlayer(userId: string): Promise<Player | null> {
    const db = getDatabase();
    
    const player = await db.collection(this.collection).findOne({ userId });
    
    if (!player) {
      return null;
    }

    return {
      id: player._id.toString(),
      userId: player.userId,
      username: player.username,
      email: player.email,
      position: player.position,
      rotation: player.rotation || { x: 0, y: 0, z: 0 }, // Default rotation if not exists
      character: player.character, // Character appearance/customization data
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
      isAlive: player.isAlive !== undefined ? player.isAlive : true, // Default to alive if not set
      currentDungeonDagNodeName: player.currentDungeonDagNodeName || 'A', // Default to root floor
    };
  }

  async getPlayerByEmail(email: string): Promise<Player | null> {
    const db = getDatabase();
    
    const player = await db.collection(this.collection).findOne({ email });
    
    if (!player) {
      return null;
    }

    return {
      id: player._id.toString(),
      userId: player.userId,
      username: player.username,
      email: player.email,
      position: player.position,
      rotation: player.rotation || { x: 0, y: 0, z: 0 }, // Default rotation if not exists
      character: player.character, // Character appearance/customization data
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
      isAlive: player.isAlive !== undefined ? player.isAlive : true, // Default to alive if not set
      currentDungeonDagNodeName: player.currentDungeonDagNodeName || 'A', // Default to root floor
    };
  }

  async updatePlayerPosition(userId: string, position: Position): Promise<void> {
    const db = getDatabase();
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          position,
          lastUpdate: new Date(),
        },
      }
    );
  }

  async updatePlayerPositionAndRotation(userId: string, position: Position, rotation: Position): Promise<void> {
    const db = getDatabase();
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          position,
          rotation,
          lastUpdate: new Date(),
        },
      }
    );
  }

  async updatePlayerPositionRotationAndCharacter(userId: string, position: Position, rotation?: Position, character?: Record<string, unknown>): Promise<void> {
    const db = getDatabase();
    
    const updateData: {
      position: Position;
      lastUpdate: Date;
      rotation?: Position;
      character?: Record<string, unknown>;
    } = {
      position,
      lastUpdate: new Date(),
    };
    
    if (rotation) {
      updateData.rotation = rotation;
    }
    
    if (character) {
      updateData.character = character;
    }
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: updateData,
      }
    );
  }

  async updatePlayerHealth(userId: string, health: number): Promise<void> {
    const db = getDatabase();
    
    // Get current player to check max health
    const player = await this.getPlayer(userId);
    if (!player) {
      throw new Error('Player not found');
    }
    
    const clampedHealth = Math.max(0, Math.min(health, player.maxHealth));
    const isAlive = clampedHealth > 0;
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          health: clampedHealth,
          isAlive: isAlive,
          lastUpdate: new Date(),
        },
      }
    );
  }

  async setPlayerOnlineStatus(userId: string, isOnline: boolean): Promise<void> {
    const db = getDatabase();
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          isOnline,
          lastUpdate: new Date(),
        },
      }
    );
  }

  async getAllPlayers(): Promise<Player[]> {
    const db = getDatabase();
    
    const players = await db.collection(this.collection)
      .find({})
      .toArray();

    return players.map(player => ({
      id: player._id.toString(),
      userId: player.userId,
      username: player.username,
      email: player.email,
      position: player.position,
      rotation: player.rotation || { x: 0, y: 0, z: 0 }, // Default rotation if not exists
      character: player.character, // Character appearance/customization data
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
      isAlive: player.isAlive !== undefined ? player.isAlive : true, // Default to alive if not set
      currentDungeonDagNodeName: player.currentDungeonDagNodeName || 'A', // Default to root floor
    }));
  }

  async getAllOnlinePlayers(): Promise<Player[]> {
    const db = getDatabase();
    
    const players = await db.collection(this.collection)
      .find({ isOnline: true })
      .toArray();

    return players.map(player => ({
      id: player._id.toString(),
      userId: player.userId,
      username: player.username,
      email: player.email,
      position: player.position,
      rotation: player.rotation || { x: 0, y: 0, z: 0 }, // Default rotation if not exists
      character: player.character, // Character appearance/customization data
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
      isAlive: player.isAlive !== undefined ? player.isAlive : true, // Default to alive if not set
      currentDungeonDagNodeName: player.currentDungeonDagNodeName || 'A', // Default to root floor
    }));
  }

  async updatePlayerFloor(userId: string, dungeonDagNodeName: string): Promise<void> {
    const db = getDatabase();
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          currentDungeonDagNodeName: dungeonDagNodeName,
          lastUpdate: new Date(),
        },
      }
    );
  }

  async deletePlayer(userId: string): Promise<void> {
    const db = getDatabase();
    await db.collection(this.collection).deleteOne({ userId });
  }

  async respawnPlayer(userId: string, spawnDungeonDagNodeName: string, newCharacterData?: Record<string, unknown>, username?: string, email?: string): Promise<Player> {
    const db = getDatabase();
    
    // Get current player data
    const existingPlayer = await this.getPlayer(userId);
    
    if (existingPlayer) {
      // Existing player respawning
      // eslint-disable-next-line no-console
      console.log(`Respawning existing player: ${existingPlayer.username} (${userId})`);
      
      // Reset health, alive status, position, and floor location
      const updateData: {
        health: number;
        isAlive: boolean;
        position: Position;
        currentDungeonDagNodeName: string;
        lastUpdate: Date;
        character?: Record<string, unknown>;
      } = {
        health: existingPlayer.maxHealth, // Reset to full health
        isAlive: true,
        position: { x: 0, y: 0, z: 0 }, // Reset to spawn position
        currentDungeonDagNodeName: spawnDungeonDagNodeName, // Move to spawn floor
        lastUpdate: new Date(),
      };
      
      // Update character data if provided
      if (newCharacterData) {
        updateData.character = newCharacterData;
      }
      
      await db.collection(this.collection).updateOne(
        { userId },
        { $set: updateData }
      );
      
      // Return updated player data
      return await this.getPlayer(userId) as Player;
    } else {
      // New player spawning in
      // eslint-disable-next-line no-console
      console.log(`Creating new player for spawn: ${username || 'Unknown'} (${userId})`);
      
      if (!username) {
        throw new Error('Username is required for new player creation');
      }
      
      const newPlayer: Omit<Player, 'id'> = {
        userId,
        username,
        email,
        position: { x: 0, y: 0, z: 0 }, // Spawn position
        rotation: { x: 0, y: 0, z: 0 },
        character: newCharacterData, // Character data if provided
        health: 100,
        maxHealth: 100,
        level: 1,
        experience: 0,
        lastUpdate: new Date(),
        isOnline: false,
        isAlive: true,
        currentDungeonDagNodeName: spawnDungeonDagNodeName, // Spawn floor
      };

      const result = await db.collection(this.collection).insertOne(newPlayer);
      
      return {
        id: result.insertedId.toString(),
        ...newPlayer,
      };
    }
  }
}
