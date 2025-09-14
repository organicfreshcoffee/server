module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Dropping enemies collection (moving to in-memory only)...');
    
    // Drop the enemies collection - we're keeping enemyTypes for enemy generation
    await db.collection('enemies').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Enemies collection dropped successfully');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Recreating enemies collection...');
    
    // Recreate the enemies collection and indexes
    await db.createCollection('enemies').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });

    // Recreate the indexes that were originally created in the enemies migration
    await db.collection('enemies').createIndex({ "id": 1 }, { unique: true });
    await db.collection('enemies').createIndex({ "enemyTypeID": 1 });
    await db.collection('enemies').createIndex({ "floorName": 1 });
    await db.collection('enemies').createIndex({ "positionX": 1, "positionY": 1 });
    
    console.log('Enemies collection and indexes recreated');
  }
};
