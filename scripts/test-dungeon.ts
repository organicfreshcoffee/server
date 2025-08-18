import { MongoClient } from 'mongodb';
import { DungeonService } from '../src/services/dungeonService';
import dotenv from 'dotenv';

dotenv.config();

async function testDungeon(): Promise<void> {
  // Use MongoDB URI from environment variable or fallback to default
  const uri = process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin';

  const client = new MongoClient(uri);
  
  try {
    console.log('Connecting to MongoDB...');
    await client.connect();
    
    const dbName = process.env.MONGODB_DB_NAME || 'gamedb';
    const db = client.db(dbName);
    
    console.log('Testing dungeon data...');
    
    // Check dungeon collections
    const dungeonCollection = db.collection('dungeonDagNodes');
    const floorCollection = db.collection('floorDagNodes');
    
    const dungeonCount = await dungeonCollection.countDocuments();
    const floorCount = await floorCollection.countDocuments();
    
    console.log(`Found ${dungeonCount} dungeon nodes`);
    console.log(`Found ${floorCount} floor nodes`);
    
    if (dungeonCount === 0 || floorCount === 0) {
      console.log('⚠️  Warning: Dungeon appears to be empty. Run regenerate-dungeon script first.');
      return;
    }
    
    // Sample some dungeon data
    console.log('\n--- Sample Dungeon Nodes ---');
    const sampleDungeons = await dungeonCollection.find({}).limit(3).toArray();
    sampleDungeons.forEach((dungeon, index) => {
      console.log(`${index + 1}. ${dungeon.name} (Type: ${dungeon.type || 'unknown'})`);
    });
    
    console.log('\n--- Sample Floor Nodes ---');
    const sampleFloors = await floorCollection.find({}).limit(3).toArray();
    sampleFloors.forEach((floor, index) => {
      console.log(`${index + 1}. ${floor.name} (Dungeon: ${floor.dungeonDagNodeName || 'unknown'})`);
    });
    
    console.log('\n✅ Dungeon test completed successfully!');
    
  } catch (error) {
    console.error('❌ Dungeon test failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testDungeon().catch(console.error);
}

export { testDungeon };
