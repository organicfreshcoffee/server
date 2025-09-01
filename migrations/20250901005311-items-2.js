module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Deleting all item instances...');
    
    // Delete all existing item instances to reset the items system
    const deleteResult = await db.collection('itemInstances').deleteMany({});
    console.log(`Deleted ${deleteResult.deletedCount} item instances`);
    
    console.log('Item instances cleanup completed');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    // Cannot rollback deletion of item instances
    console.log('Cannot rollback deletion of item instances - this migration is irreversible');
  }
};
