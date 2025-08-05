// MongoDB Initialization Script
// This script runs when MongoDB starts for the first time

db = db.getSiblingDB('gamedb');

// Create collections
db.createCollection('players');
db.createCollection('game_sessions');

// Create indexes for better performance
db.players.createIndex({ "userId": 1 }, { unique: true });
db.players.createIndex({ "isOnline": 1 });
db.players.createIndex({ "lastUpdate": 1 });

// Create indexes for game sessions
db.game_sessions.createIndex({ "playerId": 1 });
db.game_sessions.createIndex({ "startTime": 1 });

print('Game database initialized successfully');

// Insert sample data for testing (optional)
if (db.players.countDocuments() === 0) {
  db.players.insertOne({
    userId: "test-user-1",
    username: "TestPlayer",
    email: "test@example.com",
    position: { x: 0, y: 0, z: 0 },
    health: 100,
    maxHealth: 100,
    level: 1,
    experience: 0,
    lastUpdate: new Date(),
    isOnline: false
  });
  
  print('Sample player data inserted');
}
