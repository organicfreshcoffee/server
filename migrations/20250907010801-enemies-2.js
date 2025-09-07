module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Adding additional enemy types...');
    
    // Add new enemy types starting from ID 7 (since the first migration used IDs 1-6)
    const newEnemyTypes = [
      { enemyTypeID: 7, enemyTypeName: "AngryPig", maxHealth: 100 },
      { enemyTypeID: 8, enemyTypeName: "Bat", maxHealth: 100 },
      { enemyTypeID: 9, enemyTypeName: "Bee", maxHealth: 100 },
      { enemyTypeID: 10, enemyTypeName: "BlueBird", maxHealth: 100 },
      { enemyTypeID: 11, enemyTypeName: "Bunny", maxHealth: 100 },
      { enemyTypeID: 12, enemyTypeName: "Chameleon", maxHealth: 100 },
      { enemyTypeID: 13, enemyTypeName: "Chicken", maxHealth: 100 },
      { enemyTypeID: 14, enemyTypeName: "Duck", maxHealth: 100 },
      { enemyTypeID: 15, enemyTypeName: "FatBird", maxHealth: 100 },
      { enemyTypeID: 16, enemyTypeName: "Ghost", maxHealth: 100 },
      { enemyTypeID: 17, enemyTypeName: "Mushroom", maxHealth: 100 },
      { enemyTypeID: 18, enemyTypeName: "Plant", maxHealth: 100 },
      { enemyTypeID: 19, enemyTypeName: "Radish", maxHealth: 100 },
      { enemyTypeID: 20, enemyTypeName: "Rino", maxHealth: 100 },
      { enemyTypeID: 21, enemyTypeName: "Rocks", maxHealth: 100 },
      { enemyTypeID: 22, enemyTypeName: "Skull", maxHealth: 100 },
      { enemyTypeID: 23, enemyTypeName: "Slime", maxHealth: 100 },
      { enemyTypeID: 24, enemyTypeName: "Snail", maxHealth: 100 },
      { enemyTypeID: 25, enemyTypeName: "Trunk", maxHealth: 100 },
      { enemyTypeID: 26, enemyTypeName: "Turtle", maxHealth: 100 }
    ];

    await db.collection('enemyTypes').insertMany(newEnemyTypes);
    console.log(`Added ${newEnemyTypes.length} new enemy types`);
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing additional enemy types...');
    
    // Remove the enemy types we added (IDs 7-26)
    const enemyTypeIdsToRemove = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26];
    
    await db.collection('enemyTypes').deleteMany({
      enemyTypeID: { $in: enemyTypeIdsToRemove }
    });
    
    console.log('Removed additional enemy types');
  }
};
