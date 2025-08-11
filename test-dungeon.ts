import { DungeonService } from './src/services/dungeonService';
import { connectToDatabase } from './src/config/database';
import dotenv from 'dotenv';

dotenv.config();

async function testDungeonSystem(): Promise<void> {
  try {
    console.log('🔌 Connecting to database...');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    
    console.log('🏰 Initializing dungeon...');
    await dungeonService.initializeDungeon();
    
    console.log('📍 Getting spawn location...');
    const spawn = await dungeonService.getSpawn();
    console.log('Spawn:', spawn);
    
    console.log('🗺️  Getting floor layout...');
    const floorLayout = await dungeonService.getFloor(spawn!);
    console.log('Floor layout:', JSON.stringify(floorLayout, null, 2));
    
    console.log('🪜 Getting room stairs...');
    const roomNodes = floorLayout?.nodes.filter(node => node.isRoom) || [];
    if (roomNodes.length > 0) {
      const stairs = await dungeonService.getRoomStairs(roomNodes[0].name);
      console.log('Room stairs:', JSON.stringify(stairs, null, 2));
    }
    
    console.log('📈 Testing floor generation...');
    await dungeonService.checkAndGenerateFloors(spawn!, [spawn!]);
    
    console.log('✅ All tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    process.exit(0);
  }
}

testDungeonSystem();
