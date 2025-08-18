module.exports = {
  async up(db, client) {
    console.log('Adding rotation field to existing player records...');
    
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
    
    if (result.modifiedCount === 0) {
      console.log('No players found without rotation field - migration already applied or no players exist');
    }
    
    console.log('✅ Player rotation migration completed successfully!');
  },

  async down(db, client) {
    console.log('Removing rotation field from player records...');
    
    const playersCollection = db.collection('players');
    
    // Remove rotation field from all players
    const result = await playersCollection.updateMany(
      {},
      { $unset: { rotation: "" } }
    );
    
    console.log(`Removed rotation field from ${result.modifiedCount} player records`);
    console.log('✅ Player rotation rollback completed successfully!');
  }
};
