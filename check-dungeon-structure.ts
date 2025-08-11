import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

async function checkDungeonStructure() {
  const uri = 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin';
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('gamedb');
  
  console.log('Checking dungeon structure...');
  
  const dungeonNodes = await db.collection('dungeonDagNodes').find({}).toArray();
  
  console.log(`Total dungeon nodes: ${dungeonNodes.length}`);
  console.log('\nDungeon tree structure:');
  
  dungeonNodes.forEach(node => {
    const childrenText = node.children.length > 0 ? `[${node.children.join(', ')}]` : '[]';
    console.log(`${node.name}: ${node.children.length} children ${childrenText}`);
  });
  
  // Check for proper branching
  const nodesWithMultipleChildren = dungeonNodes.filter(node => node.children.length > 1);
  const nodesWithOneChild = dungeonNodes.filter(node => node.children.length === 1);
  const leafNodes = dungeonNodes.filter(node => node.children.length === 0);
  
  console.log(`\n📊 Structure analysis:`);
  console.log(`  Nodes with multiple children: ${nodesWithMultipleChildren.length}`);
  console.log(`  Nodes with one child: ${nodesWithOneChild.length}`);
  console.log(`  Leaf nodes (no children): ${leafNodes.length}`);
  
  if (nodesWithMultipleChildren.length > 0) {
    console.log('✅ Good! The dungeon has proper branching.');
  } else {
    console.log('❌ Problem: No nodes have multiple children - this creates a linear dungeon.');
  }
  
  await client.close();
}

checkDungeonStructure().catch(console.error);
