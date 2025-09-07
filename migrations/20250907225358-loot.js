module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Creating loot collection and populating with drop data...');
    
    // Create loot collection
    await db.createCollection('loot').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    const lootCollection = db.collection('loot');
    
    // Create indexes for better performance
    await lootCollection.createIndex({ enemyTypeName: 1 });
    await lootCollection.createIndex({ itemTypeName: 1 });
    await lootCollection.createIndex({ enemyTypeName: 1, itemTypeName: 1 }, { unique: true });
    
    console.log('Loot collection created with indexes');
    
    // Define all enemy types (from migrations 20250820181517-enemies.js and 20250907010801-enemies-2.js)
    const enemyTypes = [
      "bull", "cow", "lion", "monkey", "ram", "tiger", // IDs 1-6
      "AngryPig", "Bat", "Bee", "BlueBird", "Bunny", "Chameleon", // IDs 7-12
      "Chicken", "Duck", "FatBird", "Ghost", "Mushroom", "Plant", // IDs 13-18
      "Radish", "Rino", "Rocks", "Skull", "Slime", "Snail", "Trunk", "Turtle" // IDs 19-26
    ];
    
    // Define all item names (from migration 20250827192510-items.js)
    const itemNames = [
      "Ring", "Amulet", "Chain mail", "Plate mail", "Shirt", "Helm", "Cap", 
      "Cloak", "Leggings", "Boots", "Gauntlets", "Gloves", "Round shield", 
      "Large shield", "Bow", "Crossbow", "Axe", "Short Sword", "Staff"
    ];
    
    // Generate loot drops for each enemy type
    const lootData = [];
    
    enemyTypes.forEach(enemyTypeName => {
      // Each enemy type will drop 2-4 different item types
      const numDrops = Math.floor(Math.random() * 3) + 2; // 2-4 drops
      const selectedItems = [...itemNames].sort(() => 0.5 - Math.random()).slice(0, numDrops);
      
      selectedItems.forEach(itemTypeName => {
        // Generate drop percentage between 5% and 25%
        const dropPercentage = Math.round((Math.random() * 0.5 + 0.05) * 100) / 100; // 0.05 to 0.25

        lootData.push({
          enemyTypeName,
          itemTypeName,
          dropPercentage
        });
      });
    });
    
    // Insert all loot data
    await lootCollection.insertMany(lootData);
    console.log(`Inserted ${lootData.length} loot drop entries for ${enemyTypes.length} enemy types`);
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing loot collection...');
    
    // Drop the loot collection (this will remove all data and indexes)
    await db.collection('loot').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "namespace not found" error
    });
    
    console.log('Loot collection removed');
  }
};
