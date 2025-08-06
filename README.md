# Organic Fresh Coffee Game Server

A TypeScript Express server with WebSocket support for multiplayer gaming, featuring MongoDB data persistence and external Firebase authentication via auth server.

## 🏗️ Architecture

- **Backend**: Express.js with TypeScript
- **WebSocket**: Real-time multiplayer communication
- **Authentication**: External auth server for Firebase token verification
- **Database**: MongoDB for player data, positions, and game state
- **Infrastructure**: Docker Compose for local development

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Docker](https://www.docker.com/get-started) and Docker Compose
- [Git](https://git-scm.com/)
- Access to an auth server for Firebase token verification (e.g., the landing page server)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/organicfreshcoffee/server.git
cd server
./setup.sh
```

### 2. Configure Environment

The setup script will create a `.env` file from the template. Review and update it:

```bash
# Environment Configuration
NODE_ENV=development
PORT=3002

# Auth Server Configuration (for Firebase token verification)
AUTH_SERVER_URL=http://localhost:3001

# Client Configuration
CLIENT_URL=http://localhost:3000

# Database Configuration
MONGODB_URI=mongodb://admin:password@localhost:27018/gamedb?authSource=admin
```

### 3. Start the Server

```bash
./start.sh
```

### 4. Access the Application

- **Game Server API**: [http://localhost:3002](http://localhost:3002/)
- **WebSocket Endpoint**: `ws://localhost:3002/game`
- **Health Check**: [http://localhost:3002/health](http://localhost:3002/health)
- **MongoDB**: `mongodb://admin:password@localhost:27018/gamedb`
- **MongoDB Express**: [http://localhost:8081](http://localhost:8081/) (admin/password)

## 📦 Dependencies

### Production Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| express | ^4.18.2 | Web framework |
| ws | ^8.16.0 | WebSocket library |
| mongodb | ^6.3.0 | MongoDB driver |
| cors | ^2.8.5 | Cross-origin requests |
| helmet | ^7.1.0 | Security middleware |
| uuid | ^9.0.1 | UUID generation |
| dotenv | ^16.3.1 | Environment variables |

### Development Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| typescript | ^5.3.3 | Type safety |
| @types/node | ^20.10.6 | Node.js types |
| @types/express | ^4.17.21 | Express types |
| @types/ws | ^8.5.10 | WebSocket types |
| nodemon | ^3.0.2 | Development server |
| eslint | ^8.56.0 | Code linting |

## 🔧 Development

### Running Individual Services

**Server only:**
```bash
npm run dev  # Development with hot reload
npm run build && npm start  # Production build
```

**Database only:**
```bash
docker compose up -d mongodb
```

### Available Scripts

- `npm run dev` - Start development server with nodemon
- `npm run build` - Compile TypeScript
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint errors


## Running the MongoDB Migrations
```
docker build -f migration.Dockerfile -t db-migration .
docker run --rm -e MONGODB_URI="your-mongodb-connection-string-here" db-migration
```

## 🏗️ Project Structure

```
server/
├── src/
│   ├── config/                 # Configuration files
│   │   └── database.ts         # MongoDB connection
│   ├── middleware/             # Express middleware
│   │   └── errorHandler.ts     # Error handling
│   ├── routes/                # API routes
│   │   └── auth.ts            # Authentication routes (proxy to auth server)
│   ├── services/              # Business logic
│   │   ├── authService.ts     # External auth server integration
│   │   ├── playerService.ts   # Player data management
│   │   └── websocket.ts       # WebSocket server logic
│   ├── types/                 # TypeScript type definitions
│   │   └── game.ts            # Game-related types
│   └── index.ts               # Server entry point
├── docker-compose.yml         # Docker services
├── docker-compose.prod.yml    # Production Docker services
├── Dockerfile                 # Container configuration
├── Dockerfile.prod            # Production container
├── init-mongo.js              # MongoDB initialization
├── setup.sh                   # Setup script
├── start.sh                   # Start script
├── healthcheck.js             # Docker health check
└── .env.example               # Environment template
```

## 🎮 WebSocket API

The game server provides a WebSocket endpoint at `/game` for real-time communication.

### Connection

Connect to: `ws://localhost:3001/game`

### Message Format

All messages are JSON objects with the following structure:

```json
{
  "type": "message_type",
  "data": { /* message-specific data */ },
  "timestamp": "2023-01-01T00:00:00.000Z"
}
```

### Client to Server Messages

#### Connect (Authentication)

```json
{
  "type": "connect",
  "data": {
    "token": "firebase_jwt_token",
    "playerId": "optional_player_id",
    "userEmail": "user@example.com",
    "position": {
      "x": 0,
      "y": 0.5,
      "z": 0
    },
    "rotation": {
      "x": 0,
      "y": 0,
      "z": 0
    }
  }
}
```

*Note: The server will verify this token by calling the configured auth server. Position and rotation are optional and will be used to set the player's initial spawn location.*

#### Player Movement

```json
{
  "type": "player_move",
  "data": {
    "position": {
      "x": 10.5,
      "y": 2.0,
      "z": -5.3
    },
    "rotation": {
      "x": 0,
      "y": 1.57,
      "z": 0
    },
    "isMoving": true,
    "movementDirection": "forward"
  }
}
```

*Note: All fields except `position` are optional. Movement updates are rate-limited to 30 updates per second per player to prevent spam. The `isMoving` boolean and `movementDirection` ('forward' | 'backward' | 'none') fields enable smooth movement prediction and interpolation on other clients.*

#### Player Actions

```json
{
  "type": "player_action",
  "data": {
    "action": "attack",
    "target": "player_id",
    "data": { /* action-specific data */ }
  }
}
```

#### Ping

```json
{
  "type": "ping",
  "data": {}
}
```

### Server to Client Messages

#### Connection Established

```json
{
  "type": "connection_established",
  "data": {
    "clientId": "unique_client_id"
  }
}
```

#### Connect Success

```json
{
  "type": "connect_success",
  "data": {
    "player": { /* player object */ },
    "gameState": {
      "players": [ /* array of players */ ],
      "gameStarted": true
    }
  }
}
```

#### Player Movement Updates

```json
{
  "type": "player_moved",
  "data": {
    "playerId": "player_id",
    "position": { "x": 1, "y": 2, "z": 3 },
    "rotation": { "x": 0, "y": 1.57, "z": 0 },
    "isMoving": true,
    "movementDirection": "forward",
    "timestamp": "2023-01-01T00:00:00.000Z"
  }
}
```

*Note: Only `playerId`, `position`, and `timestamp` are always present. Other fields (`rotation`, `isMoving`, `movementDirection`) are included when available and enable smooth movement prediction and interpolation.*

#### Player Joined

```json
{
  "type": "player_joined",
  "data": {
    "id": "player_id",
    "position": { "x": 0, "y": 0, "z": 0 },
    "rotation": { "x": 0, "y": 0, "z": 0 },
    "health": 100,
    "maxHealth": 100,
    "level": 1,
    "experience": 0,
    "isOnline": true,
    "lastUpdate": "2023-01-01T00:00:00.000Z"
  }
}
```

#### Players List

```json
{
  "type": "players_list",
  "data": {
    "players": [
      {
        "id": "player_id",
        "position": { "x": 0, "y": 0, "z": 0 },
        "rotation": { "x": 0, "y": 0, "z": 0 },
        "health": 100,
        "maxHealth": 100,
        "level": 1,
        "experience": 0,
        "isOnline": true,
        "lastUpdate": "2023-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

#### Game State

```json
{
  "type": "game_state",
  "data": {
    "players": [ /* array of all players */ ],
    "gameStarted": true,
    "lastUpdate": "2023-01-01T00:00:00.000Z"
  }
}
```

#### Error Messages

```json
{
  "type": "error",
  "data": {
    "message": "Error description"
  }
}
```

## 🔐 Security Features

- **External Auth Server Integration**: Firebase token verification via external auth server
- **JWT Token Verification**: Secure token validation through auth server proxy
- **No Direct Firebase Dependencies**: Authentication handled by external service
- **CORS Configuration**: Cross-origin request security
- **Helmet Middleware**: Security headers and protection
- **Input Validation**: WebSocket message validation

## 🛠️ Troubleshooting

### Common Issues

1. **Auth Server Connection Error**
   ```
   Error verifying token with auth server
   ```
   
   **Solution:**
   - Ensure the auth server is running on the configured URL
   - Check the `AUTH_SERVER_URL` in your `.env` file
   - Verify the auth server's `/api/auth/verify` endpoint is accessible

2. **Authentication Token Invalid**
   ```
   Error: Invalid authentication token
   ```
   
   **Solution:**
   - Ensure the Firebase token is valid and not expired
   - Check that the auth server can properly verify Firebase tokens
   - Verify the token is being sent in the correct format

3. **MongoDB Connection Failed**
   ```
   Error connecting to MongoDB
   ```
   
   **Solution:** Make sure MongoDB is running and the connection string is correct.

4. **WebSocket Connection Failed**
   ```
   WebSocket connection to 'ws://localhost:3002/game' failed
   ```
   
   **Solution:**
   - Ensure the server is running: `docker compose ps`
   - Check server logs: `docker compose logs game-server`
   - Verify the WebSocket endpoint is accessible

5. **Docker Build Failed**
   ```
   Error building game-server
   ```
   
   **Solution:**
   - Ensure all dependencies are installed: `./setup.sh`
   - Try rebuilding: `docker compose build --no-cache game-server`

6. **Port Already in Use**
   ```
   Error: Port 3002 is already in use
   ```
   
   **Solution:**
   - Stop any existing services on port 3002
   - Change the port in `.env` and Docker configuration files
   - Check what's using the port: `lsof -i :3002`

### Debug Commands

```bash
# Check running containers
docker compose ps

# View logs
docker compose logs -f
docker compose logs -f game-server
docker compose logs -f mongodb

# Restart services
docker compose restart
docker compose restart game-server

# Clean rebuild
docker compose down
docker compose up --build

# Test auth server connection
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3001/api/auth/verify

# Reset MongoDB and rerun initialization script
docker compose down
docker volume rm server_mongodb_data
docker compose up -d mongodb
```

## 🌍 Deployment

### Production Considerations

1. **Environment Variables**: Configure production auth server URL
2. **Database**: Use MongoDB Atlas or managed MongoDB
3. **SSL/TLS**: Configure HTTPS and WSS
4. **Load Balancing**: Consider multiple server instances
5. **Monitoring**: Add application monitoring and logging
6. **Auth Server**: Ensure auth server is properly secured and scaled

### Docker Production Build

```bash
# Build production images
docker compose -f docker-compose.prod.yml build

# Start production services
docker compose -f docker-compose.prod.yml up -d
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

If you encounter any issues or need help:

1. Check the Troubleshooting section above
2. Review the [Express.js Documentation](https://expressjs.com/)
3. Check [WebSocket API documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
4. Open an issue on GitHub
5. Check Docker and Docker Compose documentation

## 🙏 Acknowledgments

- [Express.js](https://expressjs.com/) for the web framework
- [MongoDB](https://www.mongodb.com/) for the database
- [Docker](https://www.docker.com/) for containerization
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) for real-time communication
