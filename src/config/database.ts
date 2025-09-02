import { MongoClient, Db, Collection, Document, Filter, FindOptions, InsertOneOptions, UpdateOptions, DeleteOptions, CountDocumentsOptions, AggregateOptions, FindCursor, WithId, InsertOneResult, InsertManyResult, UpdateResult, DeleteResult, BulkWriteOptions, OptionalUnlessRequiredId } from 'mongodb';
import { traceDbOperation, addSpanAttributes } from './tracing';

let db: Db | null = null;
let client: MongoClient | null = null;

// Wrapper for MongoDB collection to add tracing
class TracedCollection<T extends Document = Document> {
  constructor(private collection: Collection<T>) {}

  async findOne(filter: Filter<T>, options?: FindOptions<T>): Promise<WithId<T> | null> {
    return traceDbOperation('findOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.findOne(filter, options);
    });
  }

  find(filter: Filter<T>, options?: FindOptions<T>): FindCursor<WithId<T>> {
    // Note: find() returns a cursor, so we can't wrap it with tracing in the same way
    // The actual database operation happens when the cursor is consumed
    addSpanAttributes({
      'db.mongodb.filter': JSON.stringify(filter),
      'db.mongodb.options': options ? JSON.stringify(options) : '',
    });
    return this.collection.find(filter, options);
  }

  async insertOne(doc: OptionalUnlessRequiredId<T>, options?: InsertOneOptions): Promise<InsertOneResult<T>> {
    return traceDbOperation('insertOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.document_size': JSON.stringify(doc).length,
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.insertOne(doc, options);
    });
  }

  async insertMany(docs: OptionalUnlessRequiredId<T>[], options?: BulkWriteOptions): Promise<InsertManyResult<T>> {
    return traceDbOperation('insertMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.document_count': docs.length,
        'db.mongodb.batch_size': JSON.stringify(docs).length,
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.insertMany(docs, options);
    });
  }

  async updateOne(filter: Filter<T>, update: Document, options?: UpdateOptions): Promise<UpdateResult> {
    return traceDbOperation('updateOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.update': JSON.stringify(update),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.updateOne(filter, update, options);
    });
  }

  async updateMany(filter: Filter<T>, update: Document, options?: UpdateOptions): Promise<UpdateResult> {
    return traceDbOperation('updateMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.update': JSON.stringify(update),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.updateMany(filter, update, options);
    });
  }

  async deleteOne(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    return traceDbOperation('deleteOne', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.deleteOne(filter, options);
    });
  }

  async deleteMany(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
    return traceDbOperation('deleteMany', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': JSON.stringify(filter),
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.deleteMany(filter, options);
    });
  }

  async countDocuments(filter?: Filter<T>, options?: CountDocumentsOptions): Promise<number> {
    return traceDbOperation('countDocuments', this.collection.collectionName, async () => {
      addSpanAttributes({
        'db.mongodb.filter': filter ? JSON.stringify(filter) : '{}',
        'db.mongodb.options': options ? JSON.stringify(options) : '',
      });
      return this.collection.countDocuments(filter, options);
    });
  }

  aggregate<TResult extends Document = Document>(pipeline: Document[], options?: AggregateOptions): ReturnType<Collection<T>['aggregate']> {
    // Note: aggregate returns a cursor, so we can't wrap it with async tracing
    addSpanAttributes({
      'db.mongodb.pipeline': JSON.stringify(pipeline),
      'db.mongodb.pipeline_stages': pipeline.length,
      'db.mongodb.options': options ? JSON.stringify(options) : '',
    });
    return this.collection.aggregate<TResult>(pipeline, options);
  }
}

// Wrapper for MongoDB database to add tracing
class TracedDatabase {
  constructor(private db: Db) {}

  collection<T extends Document = Document>(name: string): TracedCollection<T> {
    return new TracedCollection<T>(this.db.collection<T>(name));
  }

  // Pass through other database methods
  admin(): ReturnType<Db['admin']> { 
    return this.db.admin(); 
  }
  
  command(command: Document, options?: Document): ReturnType<Db['command']> { 
    return this.db.command(command, options); 
  }
  
  createCollection(name: string, options?: Document): ReturnType<Db['createCollection']> { 
    return this.db.createCollection(name, options); 
  }
  
  dropCollection(name: string): ReturnType<Db['dropCollection']> { 
    return this.db.dropCollection(name); 
  }
  
  listCollections(filter?: Document, options?: Document): ReturnType<Db['listCollections']> { 
    return this.db.listCollections(filter, options); 
  }
  
  stats(options?: Document): ReturnType<Db['stats']> { 
    return this.db.stats(options); 
  }
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
      
      // eslint-disable-next-line no-console
      console.log(`Connected to MongoDB database: ${dbName}`);
      return new TracedDatabase(db);
    } catch (error) {
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.log('MongoDB connection closed');
  }
}
