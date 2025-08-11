import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

async function checkData() {
  // Use the same MongoDB URI as the Docker server (port 27018)
  const uri = 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gamedb');
  
  console.log('Using MongoDB URI: mongodb://admin:***@localhost:27018/gamedb?authSource=admin');
  console.log('Checking if dungeon data was deleted...');
  
  const dungeonCount = await db.collection('dungeonDagNodes').countDocuments({});
  const floorCount = await db.collection('floorDagNodes').countDocuments({});
  
  console.log(`Dungeon nodes count: ${dungeonCount}`);
  console.log(`Floor nodes count: ${floorCount}`);
  
  if (dungeonCount === 0 && floorCount === 0) {
    console.log('✅ All dungeon data successfully deleted!');
  } else {
    console.log('❌ Some data still exists');
    
    if (dungeonCount > 0) {
      console.log('Sample dungeon nodes:');
      const sampleDungeons = await db.collection('dungeonDagNodes').find({}).limit(3).toArray();
      sampleDungeons.forEach(node => console.log(`  - ${node.name}`));
    }
    
    if (floorCount > 0) {
      console.log('Sample floor nodes:');
      const sampleFloors = await db.collection('floorDagNodes').find({}).limit(3).toArray();
      sampleFloors.forEach(node => console.log(`  - ${node.name}`));
    }
  }
  
  await client.close();
}

checkData().catch(console.error);
