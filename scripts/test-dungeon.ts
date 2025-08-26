import { MongoClient } from 'mongodb';
import { DungeonService } from '../src/services/dungeonService';
import dotenv from 'dotenv';

dotenv.config();

interface TileValidationResult {
  floorName: string;
  isValid: boolean;
  errors: string[];
  stats: {
    floorTiles: number;
    wallTiles: number;
    upwardStairs: number;
    downwardStairs: number;
    overlaps: number;
  };
}

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

    // Set up database connection for the service
    process.env.MONGODB_DB_NAME = dbName;
    process.env.MONGODB_URI = uri;
    
    const { connectToDatabase } = await import('../src/config/database');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    
    // Get a sample of dungeon nodes for testing
    const allDungeons = await dungeonCollection.find({}).limit(10).toArray();
    console.log(`\n🧪 Testing tile data for ${allDungeons.length} dungeon floors...`);
    
    const validationResults: TileValidationResult[] = [];
    let totalErrors = 0;
    
    for (const dungeon of allDungeons) {
      const result = await validateFloorTiles(dungeonService, dungeon.name);
      validationResults.push(result);
      if (!result.isValid) {
        totalErrors += result.errors.length;
      }
    }
    
    // Report results
    console.log('\n📊 TILE VALIDATION RESULTS');
    console.log('='.repeat(50));
    
    let validFloors = 0;
    let invalidFloors = 0;
    
    for (const result of validationResults) {
      if (result.isValid) {
        validFloors++;
        console.log(`✅ ${result.floorName}: VALID (${result.stats.downwardStairs} stairs, ${result.stats.floorTiles} floor tiles, ${result.stats.wallTiles} wall tiles)`);
      } else {
        invalidFloors++;
        console.log(`❌ ${result.floorName}: INVALID (${result.errors.length} errors)`);
        result.errors.forEach(error => {
          console.log(`   - ${error}`);
        });
      }
    }
    
    console.log('\n📈 SUMMARY');
    console.log('='.repeat(30));
    console.log(`Valid floors: ${validFloors}`);
    console.log(`Invalid floors: ${invalidFloors}`);
    console.log(`Total errors: ${totalErrors}`);
    
    if (totalErrors === 0) {
      console.log('\n🎉 All floors passed tile validation!');
    } else {
      console.log(`\n⚠️  Found ${totalErrors} tile validation errors across ${invalidFloors} floors.`);
    }
    
    // Sample some dungeon data for reference
    console.log('\n--- Sample Dungeon Nodes ---');
    const sampleDungeons = await dungeonCollection.find({}).limit(3).toArray();
    sampleDungeons.forEach((dungeon, index) => {
      console.log(`${index + 1}. ${dungeon.name} (Children: ${dungeon.children?.length || 0})`);
    });
    
    console.log('\n--- Sample Floor Nodes ---');
    const sampleFloors = await floorCollection.find({}).limit(3).toArray();
    sampleFloors.forEach((floor, index) => {
      console.log(`${index + 1}. ${floor.name} (Dungeon: ${floor.dungeonDagNodeName || 'unknown'}, Type: ${floor.isRoom ? 'Room' : 'Hallway'})`);
    });
    
    // Close the database connection
    const { closeDatabase } = await import('../src/config/database');
    await closeDatabase();
    
    console.log('\n✅ Dungeon test completed successfully!');
    
  } catch (error) {
    console.error('❌ Dungeon test failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

async function validateFloorTiles(dungeonService: DungeonService, floorName: string): Promise<TileValidationResult> {
  const result: TileValidationResult = {
    floorName,
    isValid: true,
    errors: [],
    stats: {
      floorTiles: 0,
      wallTiles: 0,
      upwardStairs: 0,
      downwardStairs: 0,
      overlaps: 0
    }
  };

  try {
    // Get the generated tile data for this floor
    const tileData = await dungeonService.getGeneratedFloorTileData(floorName);
    
    if (!tileData) {
      result.isValid = false;
      result.errors.push('Could not generate tile data for floor');
      return result;
    }

    const { tiles } = tileData;
    
    // Update stats
    result.stats.floorTiles = tiles.floorTiles.length;
    result.stats.wallTiles = tiles.wallTiles.length;
    result.stats.upwardStairs = tiles.upwardStairTiles.length;
    result.stats.downwardStairs = tiles.downwardStairTiles.length;

    // Create sets for quick position lookup
    const floorPositions = new Set<string>();
    const wallPositions = new Set<string>();
    const upwardStairPositions = new Set<string>();
    const downwardStairPositions = new Set<string>();

    // Populate position sets
    tiles.floorTiles.forEach(tile => {
      floorPositions.add(`${tile.x},${tile.y}`);
    });

    tiles.wallTiles.forEach(tile => {
      wallPositions.add(`${tile.x},${tile.y}`);
    });

    tiles.upwardStairTiles.forEach(tile => {
      upwardStairPositions.add(`${tile.x},${tile.y}`);
    });

    tiles.downwardStairTiles.forEach(tile => {
      downwardStairPositions.add(`${tile.x},${tile.y}`);
    });

    // Check for overlaps between different tile types
    
    // 1. Check downward stairs vs floor tiles
    for (const stair of tiles.downwardStairTiles) {
      const pos = `${stair.x},${stair.y}`;
      if (floorPositions.has(pos)) {
        result.errors.push(`Downward stair at (${stair.x}, ${stair.y}) overlaps with floor tile`);
        result.stats.overlaps++;
      }
    }

    // 2. Check downward stairs vs wall tiles  
    for (const stair of tiles.downwardStairTiles) {
      const pos = `${stair.x},${stair.y}`;
      if (wallPositions.has(pos)) {
        result.errors.push(`Downward stair at (${stair.x}, ${stair.y}) overlaps with wall tile`);
        result.stats.overlaps++;
      }
    }

    // 3. Check upward stairs vs wall tiles (upward stairs can overlap with floor tiles)
    for (const stair of tiles.upwardStairTiles) {
      const pos = `${stair.x},${stair.y}`;
      if (wallPositions.has(pos)) {
        result.errors.push(`Upward stair at (${stair.x}, ${stair.y}) overlaps with wall tile`);
        result.stats.overlaps++;
      }
    }

    // 4. Check upward vs downward stairs (no room should have both)
    for (const upStair of tiles.upwardStairTiles) {
      for (const downStair of tiles.downwardStairTiles) {
        if (upStair.room_name === downStair.room_name) {
          result.errors.push(`Room ${upStair.room_name} has both upward and downward stairs`);
        }
      }
    }

    // 5. Check floor vs wall overlap (should be minimal/expected at boundaries)
    let floorWallOverlaps = 0;
    for (const floor of tiles.floorTiles) {
      const pos = `${floor.x},${floor.y}`;
      if (wallPositions.has(pos)) {
        floorWallOverlaps++;
      }
    }
    
    if (floorWallOverlaps > 0) {
      result.errors.push(`${floorWallOverlaps} positions have both floor and wall tiles`);
      result.stats.overlaps += floorWallOverlaps;
    }

    // Set validation result
    result.isValid = result.errors.length === 0;

  } catch (error) {
    result.isValid = false;
    result.errors.push(`Error during validation: ${error}`);
  }

  return result;
}

async function testSpecificFloor(floorName: string): Promise<void> {
  // Use MongoDB URI from environment variable or fallback to default
  const uri = process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin';

  const client = new MongoClient(uri);
  
  try {
    console.log(`Testing specific floor: ${floorName}`);
    console.log('Connecting to MongoDB...');
    await client.connect();
    
    const dbName = process.env.MONGODB_DB_NAME || 'gamedb';
    const db = client.db(dbName);
    
    // Set up database connection for the service
    process.env.MONGODB_DB_NAME = dbName;
    process.env.MONGODB_URI = uri;
    
    const { connectToDatabase } = await import('../src/config/database');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    
    // Check if floor exists
    const floorCollection = db.collection('floorDagNodes');
    const floorExists = await floorCollection.findOne({ dungeonDagNodeName: floorName });
    
    if (!floorExists) {
      console.log(`❌ Floor '${floorName}' not found in database`);
      return;
    }
    
    console.log(`✅ Floor '${floorName}' found, running validation...`);
    
    // Validate the specific floor
    const result = await validateFloorTiles(dungeonService, floorName);
    
    console.log(`\n--- Floor ${floorName} Validation Results ---`);
    console.log(`Status: ${result.isValid ? '✅ VALID' : '❌ INVALID'}`);
    console.log(`Floor tiles: ${result.stats.floorTiles}`);
    console.log(`Wall tiles: ${result.stats.wallTiles}`);
    console.log(`Upward stairs: ${result.stats.upwardStairs}`);
    console.log(`Downward stairs: ${result.stats.downwardStairs}`);
    console.log(`Total overlaps: ${result.stats.overlaps}`);
    
    if (result.errors.length > 0) {
      console.log(`\nErrors (${result.errors.length}):`);
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error}`);
      });
    }
    
    // Get floor layout details
    const generatedData = await dungeonService.getGeneratedFloorData(floorName);
    if (generatedData) {
      console.log(`\n--- Floor ${floorName} Layout Details ---`);
      console.log(`Bounds: ${JSON.stringify(generatedData.bounds)}`);
      console.log(`Rooms: ${generatedData.rooms.length}`);
      console.log(`Hallways: ${generatedData.hallways.length}`);
      
      // List rooms with stairs
      const roomsWithStairs = generatedData.rooms.filter(room => 
        room.hasUpwardStair || room.hasDownwardStair
      );
      
      if (roomsWithStairs.length > 0) {
        console.log('\nRooms with stairs:');
        roomsWithStairs.forEach(room => {
          const stairTypes: string[] = [];
          if (room.hasUpwardStair) stairTypes.push('UP');
          if (room.hasDownwardStair) stairTypes.push('DOWN');
          console.log(`  - ${room.name}: ${stairTypes.join(', ')} at local (${room.stairLocationX}, ${room.stairLocationY}) global (${room.position.x + (room.stairLocationX || 0)}, ${room.position.y + (room.stairLocationY || 0)})`);
        });
      }
    }
    
    // Close the database connection
    const { closeDatabase } = await import('../src/config/database');
    await closeDatabase();
    
    console.log(`\n✅ Specific floor test completed for ${floorName}!`);
    
  } catch (error) {
    console.error(`❌ Specific floor test failed for ${floorName}:`, error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  // Check if a specific floor was requested via command line argument
  const specificFloor = process.argv[2];
  
  if (specificFloor) {
    testSpecificFloor(specificFloor).catch(console.error);
  } else {
    testDungeon().catch(console.error);
  }
}

export { testDungeon };
