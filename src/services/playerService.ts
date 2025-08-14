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
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
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

  async updatePlayerHealth(userId: string, health: number): Promise<void> {
    const db = getDatabase();
    
    await db.collection(this.collection).updateOne(
      { userId },
      {
        $set: {
          health: Math.max(0, Math.min(health, 100)), // Clamp between 0 and max health
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
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
      experience: player.experience,
      lastUpdate: player.lastUpdate,
      isOnline: player.isOnline,
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
}
