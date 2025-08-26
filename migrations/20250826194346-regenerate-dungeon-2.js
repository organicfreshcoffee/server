module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Regenerating dungeon with seed "initial"...');
    
    try {
      // Set up environment variables for the database connection
      process.env.MONGODB_DB_NAME = db.databaseName;
      
      // Import and set up database connection
      const { connectToDatabase, closeDatabase } = await import('../src/config/database.js');
      await connectToDatabase();
      
      // Import DungeonService
      const { DungeonService } = await import('../src/services/dungeonService.js');
      
      // Initialize dungeon with the seed "initial"
      const dungeonService = new DungeonService();
      await dungeonService.initializeDungeon("initial");
      
      console.log('✅ Dungeon regenerated successfully with seed "initial"');
      
      // Close the database connection to ensure clean state
      await closeDatabase();
      
    } catch (error) {
      console.error('❌ Failed to regenerate dungeon:', error);
      throw error;
    }
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Rolling back dungeon regeneration...');
    
    try {
      // Clear all dungeon-related collections
      console.log('Clearing dungeon collections...');
      
      await db.collection('dungeonDagNodes').deleteMany({});
      await db.collection('floorDagNodes').deleteMany({});
      await db.collection('dungeon_seed').deleteMany({});
      
      console.log('✅ Dungeon data cleared successfully');
      
    } catch (error) {
      console.error('❌ Failed to rollback dungeon regeneration:', error);
      throw error;
    }
  }
};
