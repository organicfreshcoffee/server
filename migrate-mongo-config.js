require('dotenv').config();

module.exports = {
  mongodb: {
    url: process.env.MONGODB_URI || 'mongodb://admin:password@localhost:27018/gamedb?authSource=admin',
    databaseName: process.env.MONGODB_DB_NAME || 'gamedb',
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'changelog',
  migrationFileExtension: '.js'
};
