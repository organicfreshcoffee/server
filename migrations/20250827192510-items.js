module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Creating item collections and indexes...');
    
    // Create itemTemplates collection
    console.log('Creating itemTemplates collection...');
    await db.createCollection('itemTemplates').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    const itemTemplatesCollection = db.collection('itemTemplates');
    // Create indexes for item templates
    await itemTemplatesCollection.createIndex({ name: 1 }, { unique: true });
    await itemTemplatesCollection.createIndex({ category: 1 });
    
    // Create itemInstances collection
    console.log('Creating itemInstances collection...');
    await db.createCollection('itemInstances').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    const itemInstancesCollection = db.collection('itemInstances');
    // Create indexes for item instances
    await itemInstancesCollection.createIndex({ itemTemplate: 1 });
    await itemInstancesCollection.createIndex({ owner: 1 });
    await itemInstancesCollection.createIndex({ inWorld: 1 });
    await itemInstancesCollection.createIndex({ "location.x": 1, "location.y": 1 });
    await itemInstancesCollection.createIndex({ spawnDatetime: 1 });
    await itemInstancesCollection.createIndex({ material: 1 });
    await itemInstancesCollection.createIndex({ make: 1 });
    
    console.log('Item collections and indexes created successfully');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing item collections...');
    
    // Drop collections (this also removes all indexes)
    await db.collection('itemTemplates').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    await db.collection('itemInstances').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Item collections removed');
  }
};
