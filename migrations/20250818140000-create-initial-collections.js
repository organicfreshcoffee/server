module.exports = {
  async up(db, client) {
    console.log('Creating initial collections and indexes...');
    
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
  },

  async down(db, client) {
    console.log('Removing collections and indexes...');
    
    // Drop collections (this also removes all indexes)
    await db.collection('players').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    await db.collection('game_sessions').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Collections and indexes removed');
  }
};
