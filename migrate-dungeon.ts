import { MongoClient } from 'mongodb';
import { DungeonService } from './src/services/dungeonService';
import dotenv from 'dotenv';

dotenv.config();

async function runMigration(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required');
  }

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
    await dungeonCollection.deleteMany({});
    await floorCollection.deleteMany({});
    
    // Initialize dungeon
    console.log('Initializing dungeon...');
    
    // We need to set up a temporary database connection for the service
    // In a real migration, you'd pass the db instance to the service
    process.env.MONGODB_DB_NAME = dbName;
    
    // Import and set up database connection
    const { connectToDatabase } = await import('./src/config/database');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    await dungeonService.initializeDungeon();
    
    console.log('✅ Dungeon migration completed successfully!');
    
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
