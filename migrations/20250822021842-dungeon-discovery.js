module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Adding visitedByUserIds field to dungeonDagNodes collection...');
    
    // Add visitedByUserIds field to all existing dungeonDagNodes
    // This field will store an array of user IDs that have visited this dungeon node
    const result = await db.collection('dungeonDagNodes').updateMany(
      {}, // Empty filter to match all documents
      {
        $set: {
          visitedByUserIds: [] // Initialize as empty array
        }
      }
    );
    
    console.log(`Updated ${result.modifiedCount} dungeon DAG nodes with visitedByUserIds field`);
    
    // Create an index on visitedByUserIds for efficient querying
    await db.collection('dungeonDagNodes').createIndex(
      { visitedByUserIds: 1 },
      { name: 'visitedByUserIds_index' }
    );
    
    console.log('Created index on visitedByUserIds field');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing visitedByUserIds field from dungeonDagNodes collection...');
    
    // Remove the index first
    await db.collection('dungeonDagNodes').dropIndex('visitedByUserIds_index').catch(err => {
      if (err.code !== 27) throw err; // Ignore "index doesn't exist" error
    });
    
    console.log('Dropped visitedByUserIds index');
    
    // Remove visitedByUserIds field from all dungeonDagNodes
    const result = await db.collection('dungeonDagNodes').updateMany(
      {}, // Empty filter to match all documents
      {
        $unset: {
          visitedByUserIds: ""
        }
      }
    );
    
    console.log(`Removed visitedByUserIds field from ${result.modifiedCount} dungeon DAG nodes`);
  }
};
