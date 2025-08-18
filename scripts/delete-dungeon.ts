import { MongoClient } from 'mongodb';
import { DungeonService } from '../src/services/dungeonService';
import dotenv from 'dotenv';

dotenv.config();

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

    // Close the database connection from the service to ensure clean state
    const { closeDatabase } = await import('../src/config/database');
    await closeDatabase();
    
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
