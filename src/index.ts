import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { connectToDatabase } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { setupWebSocketServer } from './services/websocket';
import dungeonRoutes from './routes/dungeon';
import userRoutes from './routes/user';
import { dungeonService, enemyService } from './services';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    'https://organicfreshcoffee.com',
    'https://www.organicfreshcoffee.com',
    'https://server.organicfreshcoffee.com',
    'https://staging.organicfreshcoffee.com',
    'https://staging-api.organicfreshcoffee.com',
    'https://staging-server.organicfreshcoffee.com',
    CLIENT_URL,
    'http://localhost:3000', // for development
    'http://localhost:3001',
    'http://localhost:3002'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/dungeon', dungeonRoutes);
app.use('/api/user', userRoutes);

// Error handling middleware
app.use(errorHandler);

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/game'
});

async function startServer(): Promise<void> {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await connectToDatabase();
    console.log('MongoDB connected successfully');

    // Initialize dungeon system
    console.log('Initializing dungeon system...');
    
    // Check if dungeon is already initialized (root node exists)
    const db = await connectToDatabase();
    const rootNode = await db.collection('dungeonDagNodes').findOne({ name: 'A' });
    
    if (!rootNode) {
      await dungeonService.initializeDungeon();
      console.log('Dungeon initialized successfully');
    } else {
      console.log('Dungeon already initialized');
    }    // Setup WebSocket server
    console.log('Setting up WebSocket server...');
    setupWebSocketServer(wss);
    console.log('WebSocket server setup complete');

    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Game Server running on port ${PORT}`);
      console.log(`📡 WebSocket server available at ws://localhost:${PORT}/game`);
      console.log(`🌐 API available at http://localhost:${PORT}`);
      console.log(`🏥 Health check at http://localhost:${PORT}/health`);
      console.log(`🔐 Auth server: ${process.env.AUTH_SERVER_URL || 'http://localhost:3001'}`);
      console.log(`🏰 Dungeon system initialized and ready`);
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  enemyService.cleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  enemyService.cleanup();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
