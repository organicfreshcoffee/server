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

