import { MongoClient, Db, Collection, Document } from 'mongodb';
import { traceDbOperation, addSpanAttributes } from './tracing';

let db: Db | null = null;
let client: MongoClient | null = null;

// Wrapper for MongoDB collection to add tracing
class TracedCollection<T extends Document = Document> {
  constructor(private collection: Collection<T>) {}

  async findOne(filter: any, options?: any): Promise<any> {
    return traceDbOperation('findOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.findOne(filter, options);
    });
  }

  async find(filter: any, options?: any) {
    return traceDbOperation('find', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.find(filter, options);
    });
  }

  async insertOne(doc: any, options?: any) {
    return traceDbOperation('insertOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.document_size': JSON.stringify(doc).length,
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.insertOne(doc, options);
    });
  }

  async insertMany(docs: any[], options?: any) {
    return traceDbOperation('insertMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.document_count': docs.length,
        'db.mongodb.batch_size': JSON.stringify(docs).length,
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.insertMany(docs, options);
    });
  }

  async updateOne(filter: any, update: any, options?: any) {
    return traceDbOperation('updateOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.update': JSON.stringify(update),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.updateOne(filter, update, options);
    });
  }

  async updateMany(filter: any, update: any, options?: any) {
    return traceDbOperation('updateMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.update': JSON.stringify(update),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.updateMany(filter, update, options);
    });
  }

  async deleteOne(filter: any, options?: any) {
    return traceDbOperation('deleteOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.deleteOne(filter, options);
    });
  }

  async deleteMany(filter: any, options?: any) {
    return traceDbOperation('deleteMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.deleteMany(filter, options);
    });
  }

  async countDocuments(filter?: any, options?: any) {
    return traceDbOperation('countDocuments', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': filter ? JSON.stringify(filter) : '{}',
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.countDocuments(filter, options);
    });
  }

  async aggregate(pipeline: any[], options?: any) {
    return traceDbOperation('aggregate', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.pipeline': JSON.stringify(pipeline),
        'db.mongodb.pipeline_stages': pipeline.length,
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.aggregate(pipeline, options);
    });
  }
}

// Wrapper for MongoDB database to add tracing
class TracedDatabase {
  constructor(private db: Db) {}

  collection<T extends Document = Document>(name: string): TracedCollection<T> {
    return new TracedCollection<T>(this.db.collection<T>(name));
  }

  // Pass through other database methods
  admin() { return this.db.admin(); }
  command(command: any, options?: any) { return this.db.command(command, options); }
  createCollection(name: string, options?: any) { return this.db.createCollection(name, options); }
  dropCollection(name: string) { return this.db.dropCollection(name); }
  listCollections(filter?: any, options?: any) { return this.db.listCollections(filter, options); }
  stats(options?: any) { return this.db.stats(options); }
}

export async function connectToDatabase(): Promise<TracedDatabase> {
  if (db) {
    return new TracedDatabase(db);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is required');
  }

  return traceDbOperation('connect', 'system', async () => {
    try {
      client = new MongoClient(uri);
      await client.connect();
      
      // Extract database name from URI or use default
      const dbName = process.env.MONGODB_DB_NAME || 'gamedb';
      db = client.db(dbName);
      
      console.log(`Connected to MongoDB database: ${dbName}`);
      return new TracedDatabase(db);
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  });
}

export function getDatabase(): TracedDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return new TracedDatabase(db);
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}
