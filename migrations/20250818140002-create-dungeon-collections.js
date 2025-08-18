module.exports = {
  async up(db, client) {
    console.log('Creating dungeon collections and indexes...');
    
    // Create dungeonDagNodes collection
    console.log('Creating dungeonDagNodes collection...');
    await db.createCollection('dungeonDagNodes').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    const dungeonCollection = db.collection('dungeonDagNodes');
    await dungeonCollection.createIndex({ name: 1 }, { unique: true });
    
    // Create floorDagNodes collection
    console.log('Creating floorDagNodes collection...');
    await db.createCollection('floorDagNodes').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    const floorCollection = db.collection('floorDagNodes');
    await floorCollection.createIndex({ name: 1 }, { unique: true });
    await floorCollection.createIndex({ dungeonDagNodeName: 1 });
    
    console.log('Dungeon collections and indexes created successfully');
  },

  async down(db, client) {
    console.log('Removing dungeon collections...');
    
    // Drop collections (this also removes all indexes)
    await db.collection('dungeonDagNodes').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    await db.collection('floorDagNodes').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Dungeon collections removed');
  }
};
