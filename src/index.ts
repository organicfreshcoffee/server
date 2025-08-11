import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { connectToDatabase } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { setupWebSocketServer } from './services/websocket';
import authRoutes from './routes/auth';
import dungeonRoutes from './routes/dungeon';
import { DungeonService } from './services/dungeonService';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [CLIENT_URL, 'http://localhost:3000'],
  credentials: true,
}));

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/dungeon', dungeonRoutes);

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

    // Check if dungeon is initialized, if not initialize it
    console.log('Checking dungeon initialization...');
    const dungeonService = new DungeonService();
    const spawn = await dungeonService.getSpawn();
    if (!spawn) {
      console.log('Dungeon not found, initializing...');
      await dungeonService.initializeDungeon();
      console.log('Dungeon initialized successfully');
    } else {
      console.log('Dungeon already initialized');
    }

    // Setup WebSocket server
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
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start the server
startServer();
