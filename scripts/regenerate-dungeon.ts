import { MongoClient } from 'mongodb';
import { DungeonService } from '../src/services/dungeonService';

require('dotenv').config();

interface ScriptOptions {
  seed?: string;
  reuseCurrentSeed?: boolean;
}

function parseCommandLineArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--seed':
      case '-s':
        if (i + 1 < args.length) {
          options.seed = args[i + 1];
          i++; // Skip next argument as it's the seed value
        } else {
          console.error('Error: --seed requires a value');
          process.exit(1);
        }
        break;
        
      case '--reuse-current-seed':
      case '--reuse':
      case '-r':
        options.reuseCurrentSeed = true;
        break;
        
      case '--help':
      case '-h':
        console.log(`
Usage: npm run scripts:regenerate-dungeon [options]

Options:
  --seed, -s <value>           Use specific seed for dungeon generation
  --reuse-current-seed, -r     Reuse existing seed from database
  --help, -h                   Show this help message

Examples:
  npm run scripts:regenerate-dungeon
  npm run scripts:regenerate-dungeon -- --seed "my-custom-seed"
  npm run scripts:regenerate-dungeon -- --reuse-current-seed
  npm run scripts:regenerate-dungeon -- -s "test-seed"
  npm run scripts:regenerate-dungeon -- -r

Note: When using npm run, use -- before script arguments to pass them correctly.
        `);
        process.exit(0);
        break;
        
      default:
        console.error(`Unknown argument: ${arg}`);
        console.log('Use --help for usage information');
        process.exit(1);
    }
  }
  
  return options;
}

async function runMigration(options: ScriptOptions = {}): Promise<void> {
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
    
    // Log the options being used
    if (options.seed) {
      console.log(`Using custom seed: ${options.seed}`);
    }
    if (options.reuseCurrentSeed) {
      console.log('Reusing current seed from database');
    }
    if (!options.seed && !options.reuseCurrentSeed) {
      console.log('Generating new random seed');
    }
    
    // We need to set up a temporary database connection for the service
    // In a real migration, you'd pass the db instance to the service
    process.env.MONGODB_DB_NAME = dbName;
    process.env.MONGODB_URI = uri;
    
    // Import and set up database connection
    const { connectToDatabase } = await import('../src/config/database');
    await connectToDatabase();
    
    const dungeonService = new DungeonService();
    await dungeonService.initializeDungeon(options.seed, options.reuseCurrentSeed);
    
    // Close the database connection from the service to ensure clean state
    const { closeDatabase } = await import('../src/config/database');
    await closeDatabase();
    
    console.log('✅ Dungeon regeneration completed successfully! Player respawn is handled automatically.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  const options = parseCommandLineArgs();
  runMigration(options).catch(console.error);
}

export { runMigration };
