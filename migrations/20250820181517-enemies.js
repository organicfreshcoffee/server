module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Creating enemies and enemyTypes collections...');
    
    // Create enemies collection
    await db.createCollection('enemies').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    // Create enemyTypes collection
    await db.createCollection('enemyTypes').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });

    console.log('Collections created');

    // Create indexes for better performance
    await db.collection('enemies').createIndex({ "id": 1 }, { unique: true });
    await db.collection('enemies').createIndex({ "enemyTypeID": 1 });
    await db.collection('enemies').createIndex({ "floorName": 1 });
    await db.collection('enemies').createIndex({ "positionX": 1, "positionY": 1 });
    
    await db.collection('enemyTypes').createIndex({ "enemyTypeID": 1 }, { unique: true });
    await db.collection('enemyTypes').createIndex({ "enemyTypeName": 1 }, { unique: true });

    console.log('Indexes created');

    // Populate enemyTypes table with predefined enemy types
    const enemyTypes = [
      { enemyTypeID: 1, enemyTypeName: "bull", maxHealth: 100 },
      { enemyTypeID: 2, enemyTypeName: "cow", maxHealth: 100 },
      { enemyTypeID: 3, enemyTypeName: "lion", maxHealth: 100 },
      { enemyTypeID: 4, enemyTypeName: "monkey", maxHealth: 100 },
      { enemyTypeID: 5, enemyTypeName: "ram", maxHealth: 100 },
      { enemyTypeID: 6, enemyTypeName: "tiger", maxHealth: 100 }
    ];

    await db.collection('enemyTypes').insertMany(enemyTypes);
    console.log('Enemy types populated');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Reversing enemies migration...');
    
    // Drop the collections (this will remove all data and indexes)
    await db.collection('enemies').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "namespace not found" error
    });
    
    await db.collection('enemyTypes').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "namespace not found" error
    });
    
    console.log('Enemies collections dropped');
  }
};
