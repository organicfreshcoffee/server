import { MongoClient } from 'mongodb';
import { DungeonService } from '../src/services/dungeonService';
import { PlayerService } from '../src/services/playerService';

require('dotenv').config();

async function runMigration(): Promise<void> {
  // Use MongoDB URI from environment variable or fallback to default
  const uri = process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin';

  const client = new MongoClient(uri);
  
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    
    const dbName = process.env.MONGODB_DB_NAME || 'gamedb';
    const db = client.db(dbName);
    
    console.log('Running dungeon migration...');
    
    // Create collections with indexes
    console.log('Creating dungeonDagNodes collection...');
    const dungeonCollection = db.collection('dungeonDagNodes');
    await dungeonCollection.createIndex({ name: 1 }, { unique: true });
    
    console.log('Creating floorDagNodes collection...');
    const floorCollection = db.collection('floorDagNodes');
    await floorCollection.createIndex({ name: 1 }, { unique: true });
    await floorCollection.createIndex({ dungeonDagNodeName: 1 });
    
    // Clear existing data
    console.log('Clearing existing dungeon data...');
    const dungeonDeleteResult = await dungeonCollection.deleteMany({});
    const floorDeleteResult = await floorCollection.deleteMany({});
    
    console.log(`Deleted ${dungeonDeleteResult.deletedCount} dungeon nodes`);
    console.log(`Deleted ${floorDeleteResult.deletedCount} floor nodes`);
    
    // Initialize dungeon with new data
    console.log('Initializing dungeon...');
    
    // We need to set up a temporary database connection for the service
    // In a real migration, you'd pass the db instance to the service
    process.env.MONGODB_DB_NAME = dbName;
    process.env.MONGODB_URI = uri;
    
    // Import and set up database connection
    const { connectToDatabase } = await import('../src/config/database');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    await dungeonService.initializeDungeon();
    
    // Get spawn location for player respawning
    const spawnFloor = await dungeonService.getSpawn();
    if (!spawnFloor) {
      console.error('❌ Could not determine spawn location. Skipping player respawn.');
    } else {
      console.log(`✅ Spawn location determined: ${spawnFloor}`);
      
      // Initialize PlayerService and respawn all players
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
    }
    
    // Close the database connection from the service to ensure clean state
    const { closeDatabase } = await import('../src/config/database');
    await closeDatabase();
    
    console.log('✅ Dungeon regeneration and player respawn completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  runMigration().catch(console.error);
}

export { runMigration };
