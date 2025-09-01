import { MongoClient, Db } from 'mongodb';
import { traceDbOperation } from './tracing';

let db: Db | null = null;
let client: MongoClient | null = null;

export async function connectToDatabase(): Promise<Db> {
  if (db) {
    return db;
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
      return db;
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  });
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not initialized. Call connectToDatabase() first.');
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('MongoDB connection closed');
  }
}
