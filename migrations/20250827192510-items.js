module.exports = {
  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async up(db, client) {
    console.log('Creating item collections and indexes...');
    
    // Create itemTemplates collection
    console.log('Creating itemTemplates collection...');
    await db.createCollection('itemTemplates').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    const itemTemplatesCollection = db.collection('itemTemplates');
    // Create indexes for item templates
    await itemTemplatesCollection.createIndex({ name: 1 }, { unique: true });
    await itemTemplatesCollection.createIndex({ category: 1 });
    
    // Create itemInstances collection
    console.log('Creating itemInstances collection...');
    await db.createCollection('itemInstances').catch(err => {
      if (err.code !== 48) throw err; // Ignore "collection already exists" error
    });
    
    const itemInstancesCollection = db.collection('itemInstances');
    // Create indexes for item instances
    await itemInstancesCollection.createIndex({ itemTemplate: 1 });
    await itemInstancesCollection.createIndex({ owner: 1 });
    await itemInstancesCollection.createIndex({ inWorld: 1 });
    await itemInstancesCollection.createIndex({ "location.x": 1, "location.y": 1 });
    await itemInstancesCollection.createIndex({ spawnDatetime: 1 });
    await itemInstancesCollection.createIndex({ material: 1 });
    await itemInstancesCollection.createIndex({ make: 1 });
    await itemInstancesCollection.createIndex({ floor: 1 });
    
    console.log('Item collections and indexes created successfully');
    
    // Insert item templates
    console.log('Inserting item templates...');
    
    const itemTemplates = [
      // Ring
      {
        category: 'Ring',
        name: 'Ring',
        possibleMaterials: ['Copper', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Jade']
      },
      
      // Amulet
      {
        category: 'Amulet',
        name: 'Amulet',
        possibleMaterials: ['Copper', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Jade']
      },
      
      // Chest armor
      {
        category: 'Chest armor',
        name: 'Chain mail',
        possibleMaterials: ['Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Chest armor',
        name: 'Plate mail',
        possibleMaterials: ['Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Chest armor',
        name: 'Shirt',
        possibleMaterials: ['Cloth', 'Leather']
      },
      
      // Head armor
      {
        category: 'Head armor',
        name: 'Helm',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Head armor',
        name: 'Cap',
        possibleMaterials: ['Cloth', 'Leather']
      },
      
      // Cloak
      {
        category: 'Cloak',
        name: 'Cloak',
        possibleMaterials: ['Cloth', 'Leather']
      },
      
      // Leg armor
      {
        category: 'Leg armor',
        name: 'Leggings',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril', 'Cloth', 'Leather']
      },
      
      // Shoes
      {
        category: 'Shoes',
        name: 'Boots',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril', 'Cloth', 'Leather']
      },
      
      // Gloves
      {
        category: 'Gloves',
        name: 'Gauntlets',
        possibleMaterials: ['Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Gloves',
        name: 'Gloves',
        possibleMaterials: ['Cloth', 'Leather']
      },
      
      // Shield
      {
        category: 'Shield',
        name: 'Round shield',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Shield',
        name: 'Large shield',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      
      // Range Weapon
      {
        category: 'Range Weapon',
        name: 'Bow',
        possibleMaterials: ['Wood']
      },
      {
        category: 'Range Weapon',
        name: 'Crossbow',
        possibleMaterials: ['Wood']
      },
      
      // Melee Weapon
      {
        category: 'Melee Weapon',
        name: 'Axe',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      {
        category: 'Melee Weapon',
        name: 'Short Sword',
        possibleMaterials: ['Wood', 'Copper', 'Bronze', 'Iron', 'Steel', 'Mythril']
      },
      
      // Magic Weapon
      {
        category: 'Magic Weapon',
        name: 'Staff',
        possibleMaterials: ['Wood']
      }
    ];
    
    await itemTemplatesCollection.insertMany(itemTemplates);
    console.log(`Inserted ${itemTemplates.length} item templates`);
  },

  /**
   * @param db {import('mongodb').Db}
   * @param client {import('mongodb').MongoClient}
   * @returns {Promise<void>}
   */
  async down(db, client) {
    console.log('Removing item collections...');
    
    // Drop collections (this also removes all indexes)
    await db.collection('itemTemplates').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    await db.collection('itemInstances').drop().catch(err => {
      if (err.code !== 26) throw err; // Ignore "collection doesn't exist" error
    });
    
    console.log('Item collections removed');
  }
};
