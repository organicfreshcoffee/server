const { spawn } = require('child_process');
const path = require('path');

module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Running dungeon regeneration and player respawn...');
    
    return new Promise((resolve, reject) => {
      // Run the TypeScript script using ts-node
      const scriptPath = path.join(__dirname, '..', 'scripts', 'regenerate-dungeon.ts');
      const child = spawn('npx', ['ts-node', scriptPath], {
        stdio: 'inherit', // This will show the script output in the migration console
        cwd: path.join(__dirname, '..'), // Set working directory to project root
      });

      child.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Dungeon regeneration and player respawn completed successfully!');
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
    console.log('⚠️  WARNING: Dungeon regeneration cannot be easily rolled back.');
    console.log('This migration cleared and regenerated the entire dungeon structure and respawned all players.');
    console.log('To "rollback", you would need to restore from a database backup made before running this migration.');
    console.log('No automatic rollback is implemented for safety reasons.');
    
    // We don't actually perform any rollback operations here because:
    // 1. The dungeon data was completely regenerated
    // 2. Player positions and stats were reset
    // 3. A rollback would require a full database restore from backup
    // 4. Automated rollback could cause more harm than good
  }
};
