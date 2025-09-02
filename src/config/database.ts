import { MongoClient, Db, Collection, Document, Filter, FindOptions, InsertOneOptions, UpdateOptions, DeleteOptions, CountDocumentsOptions, AggregateOptions, FindCursor, WithId, InsertOneResult, InsertManyResult, UpdateResult, DeleteResult, BulkWriteOptions, OptionalUnlessRequiredId } from 'mongodb';
import { traceDbOperation, addSpanAttributes } from './tracing';

let db: Db | null = null;
let client: MongoClient | null = null;

// Wrapper for MongoDB FindCursor to add tracing
class TracedFindCursor<T extends Document = Document> {
  constructor(private cursor: FindCursor<WithId<T>>, private collectionName: string) {}

  async toArray(): Promise<WithId<T>[]> {
    return traceDbOperation('find.toArray', this.collectionName, async () => {
      const results = await this.cursor.toArray();
      addSpanAttributes({
        'db.mongodb.result_count': results.length,
        'db.mongodb.result_size': JSON.stringify(results).length,
      });
      return results;
    });
  }

  async next(): Promise<WithId<T> | null> {
    return traceDbOperation('find.next', this.collectionName, async () => {
      return this.cursor.next();
    });
  }

  async forEach(iterator: (doc: WithId<T>) => void): Promise<void> {
    return traceDbOperation('find.forEach', this.collectionName, async () => {
      return this.cursor.forEach(iterator);
    });
  }

  limit(value: number): TracedFindCursor<T> {
    addSpanAttributes({ 'db.mongodb.limit': value });
    this.cursor.limit(value);
    return this;
  }

  skip(value: number): TracedFindCursor<T> {
    addSpanAttributes({ 'db.mongodb.skip': value });
    this.cursor.skip(value);
    return this;
  }

  sort(sort: Document): TracedFindCursor<T> {
    addSpanAttributes({ 'db.mongodb.sort': JSON.stringify(sort) });
    this.cursor.sort(sort);
    return this;
  }

  async count(): Promise<number> {
    return traceDbOperation('find.count', this.collectionName, async () => {
      return this.cursor.count();
    });
  }

  // Delegate other methods to the original cursor
  async hasNext(): Promise<boolean> {
    return this.cursor.hasNext();
  }

  close(): Promise<void> {
    return this.cursor.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<WithId<T>> {
    return this.cursor[Symbol.asyncIterator]();
  }
}

// Wrapper for MongoDB AggregationCursor to add tracing
class TracedAggregateCursor<T extends Document = Document> {
  constructor(private cursor: ReturnType<Collection['aggregate']>, private collectionName: string) {}

  async toArray(): Promise<T[]> {
    return traceDbOperation('aggregate.toArray', this.collectionName, async () => {
      const results = await this.cursor.toArray() as T[];
      addSpanAttributes({
        'db.mongodb.result_count': results.length,
        'db.mongodb.result_size': JSON.stringify(results).length,
      });
      return results;
    });
  }

  async next(): Promise<T | null> {
    return traceDbOperation('aggregate.next', this.collectionName, async () => {
      return this.cursor.next() as Promise<T | null>;
    });
  }

  async forEach(iterator: (doc: T) => void): Promise<void> {
    return traceDbOperation('aggregate.forEach', this.collectionName, async () => {
      return this.cursor.forEach((doc: Document) => iterator(doc as T));
    });
  }

  // Delegate other methods to the original cursor
  async hasNext(): Promise<boolean> {
    return this.cursor.hasNext();
  }

  close(): Promise<void> {
    return this.cursor.close();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    const originalIterator = this.cursor[Symbol.asyncIterator]();
    return {
      async next() {
        const result = await originalIterator.next();
        return {
          done: result.done,
          value: result.value as T
        };
      }
    };
  }
}

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

  find(filter: Filter<T>, options?: FindOptions<T>): TracedFindCursor<T> {
    // Return a traced cursor wrapper that will trace when the cursor is consumed
    addSpanAttributes({
      'db.mongodb.filter': JSON.stringify(filter),
      'db.mongodb.options': options ? JSON.stringify(options) : '',
    });
    const cursor = this.collection.find(filter, options);
    return new TracedFindCursor(cursor, this.collection.collectionName);
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

  aggregate<TResult extends Document = Document>(pipeline: Document[], options?: AggregateOptions): TracedAggregateCursor<TResult> {
    // Add tracing attributes for the aggregation pipeline
    addSpanAttributes({
      'db.mongodb.pipeline': JSON.stringify(pipeline),
      'db.mongodb.pipeline_stages': pipeline.length,
      'db.mongodb.options': options ? JSON.stringify(options) : '',
    });
    const cursor = this.collection.aggregate<TResult>(pipeline, options);
    return new TracedAggregateCursor<TResult>(cursor, this.collection.collectionName);
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
