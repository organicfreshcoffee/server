const { spawn } = require('child_process');
const path = require('path');

module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Running dungeon regeneration with seed "initial"...');
    
    return new Promise((resolve, reject) => {
      // Run the TypeScript script using ts-node with seed "initial"
      const scriptPath = path.join(__dirname, '..', 'scripts', 'regenerate-dungeon.ts');
      const child = spawn('npx', ['ts-node', scriptPath, '--seed', 'initial'], {
        stdio: 'inherit', // This will show the script output in the migration console
        cwd: path.join(__dirname, '..'), // Set working directory to project root
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Dungeon regeneration with seed "initial" completed successfully!');
          resolve();
        } else {
          console.error(`❌ Dungeon regeneration script failed with exit code ${code}`);
          reject(new Error(`Migration script failed with exit code ${code}`));
        }
      });

      child.on('error', (error) => {
        console.error('❌ Failed to start dungeon regeneration script:', error);
        reject(error);
      });
    });
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
