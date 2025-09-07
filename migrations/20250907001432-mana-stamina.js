module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    // Set mana and stamina to 100 for all records in the player table
    await db.collection('player').updateMany({}, {$set: {mana: 100, stamina: 100}});
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    // Remove mana and stamina fields from all records in the player table
    await db.collection('player').updateMany({}, {$unset: {mana: "", stamina: ""}});
  }
};
