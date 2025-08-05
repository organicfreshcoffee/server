// Migration script to add rotation field to existing player records
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function migratePlayersRotation() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    
    const dbName = process.env.MONGODB_DB_NAME || 'gamedb';
    const db = client.db(dbName);
    const playersCollection = db.collection('players');
    
    // Update all players that don't have a rotation field
    const result = await playersCollection.updateMany(
      { rotation: { $exists: false } },
      { 
        $set: { 
          rotation: { x: 0, y: 0, z: 0 },
          lastUpdate: new Date()
        } 
      }
    );
    
    console.log(`Updated ${result.modifiedCount} player records with rotation field`);
    
    // Verify the update
    const totalPlayers = await playersCollection.countDocuments();
    const playersWithRotation = await playersCollection.countDocuments({ rotation: { $exists: true } });
    
    console.log(`Total players: ${totalPlayers}`);
    console.log(`Players with rotation: ${playersWithRotation}`);
    
    if (totalPlayers === playersWithRotation) {
      console.log('✅ Migration completed successfully!');
    } else {
      console.log('⚠️  Some players may still be missing rotation data');
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('Disconnected from MongoDB');
  }
}

// Run the migration
if (require.main === module) {
  migratePlayersRotation().catch(console.error);
}

module.exports = { migratePlayersRotation };
