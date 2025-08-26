module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Creating dungeon seed collection...');
    
    // Create dungeon_seed collection
    await db.createCollection('dungeon_seed').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    // Create index to ensure only one seed document exists
    await db.collection('dungeon_seed').createIndex({ seed: 1 }, { unique: true });

    console.log('Dungeon seed collection created');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing dungeon seed collection...');
    
    // Drop the dungeon_seed collection
    await db.collection('dungeon_seed').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Dungeon seed collection removed');
  }
};
