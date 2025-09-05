module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Adding equipped field to all itemInstances...');
    
    // Add equiped field set to false for all existing item instances
    const updateResult = await db.collection('itemInstances').updateMany(
      {}, // Match all documents
      { $set: { equipped: false } }
    );
    
    console.log(`Updated ${updateResult.modifiedCount} item instances with equipped: false`);
    console.log('Equipped field migration completed');
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing equipped field from all itemInstances...');

    // Remove the equipped field from all item instances
    const updateResult = await db.collection('itemInstances').updateMany(
      {}, // Match all documents
      { $unset: { equipped: "" } }
    );

    console.log(`Removed equipped field from ${updateResult.modifiedCount} item instances`);
    console.log('Equipped field rollback completed');
  }
};
