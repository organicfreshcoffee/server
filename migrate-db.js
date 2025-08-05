// Node.js MongoDB Migration Script
const { MongoClient } = require('mongodb');

async function initializeDatabase() {
  const uri = process.env.MONGODB_URI || 'mongodb://admin:password@mongodb:27017/gamedb?authSource=admin';
  const client = new MongoClient(uri);

  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');

    // Get the gamedb database
    const db = client.db('gamedb');

    // Create collections (MongoDB creates them automatically when first document is inserted)
    // But we can explicitly create them for clarity
    await db.createCollection('players').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    await db.createCollection('game_sessions').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });

    console.log('Collections created');

    // Create indexes for better performance
    await db.collection('players').createIndex({ "userId": 1 }, { unique: true });
    await db.collection('players').createIndex({ "isOnline": 1 });
    await db.collection('players').createIndex({ "lastUpdate": 1 });

    // Create indexes for game sessions
    await db.collection('game_sessions').createIndex({ "playerId": 1 });
    await db.collection('game_sessions').createIndex({ "startTime": 1 });

    console.log('Indexes created');
    console.log('Game database initialized successfully');

  } catch (error) {
    console.error('Error during database initialization:', error);
    process.exit(1);
  } finally {
    // Close the connection
    await client.close();
  }
}

// Run the initialization
initializeDatabase();
