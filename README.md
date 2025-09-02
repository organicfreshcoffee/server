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

# Google Cloud Tracing Configuration (optional)
# Use GCP_PROJECT_ID for production, GCP_PROJECT_ID_STAGING for staging
# GCP_PROJECT_ID=your-production-gcp-project-id
# GCP_PROJECT_ID_STAGING=your-staging-gcp-project-id
TRACE_SAMPLING_RATE=1.0
```

### 3. Start the Server

```bash
./start.sh
```

**Note**: When running with Docker, migrations are automatically executed during startup. For local development without Docker:

```bash
# Start MongoDB locally first, then run:
npm run migrate:up
npm run dev
```

### 4. Initialize Dungeon Data (Optional)

After the server is running, you can generate initial dungeon data:

```bash
npm run scripts:regenerate-dungeon
```

### 5. Access the Application

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
| @google-cloud/trace-agent | Latest | Google Cloud Trace integration |
| @opentelemetry/api | ^1.0.0 | OpenTelemetry API for custom spans |
| @opentelemetry/sdk-node | ^0.52.0 | OpenTelemetry SDK for Node.js |

### Development Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| typescript | ^5.3.3 | Type safety |
| @types/node | ^20.10.6 | Node.js types |
| @types/express | ^4.17.21 | Express types |
| @types/ws | ^8.5.10 | WebSocket types |
| nodemon | ^3.0.2 | Development server |
| eslint | ^8.56.0 | Code linting |

## 📊 Google Cloud Tracing

This server includes built-in support for Google Cloud Trace to monitor performance and latency. Tracing is automatically enabled and provides insights into:

- **Database Operations**: MongoDB queries, inserts, updates, and deletes
- **HTTP Requests**: External API calls (like auth server verification)
- **Game Logic**: Player operations, dungeon generation, and game state management

### Configuration

To enable GCP tracing, set these environment variables:

```bash
# Production environment
GCP_PROJECT_ID=your-production-gcp-project-id

# Staging environment  
GCP_PROJECT_ID_STAGING=your-staging-gcp-project-id

# Optional: Control sampling rate (0.0-1.0)
TRACE_SAMPLING_RATE=1.0  # 1.0 = trace all requests, 0.1 = trace 10%
```

**Note**: The system will automatically use `GCP_PROJECT_ID` for production or `GCP_PROJECT_ID_STAGING` for staging environments. If neither is set, tracing will be disabled and the application will run in local development mode.

### Viewing Traces

1. **In GCP Console**: Navigate to "Trace" in your Google Cloud Console
2. **Trace Explorer**: View detailed trace timelines and performance metrics
3. **Custom Spans**: Look for spans prefixed with:
   - `db.*` - Database operations
   - `http.*` - HTTP requests
   - `game.*` - Game logic operations
   - `auth.*` - Authentication operations

### Local Development

Tracing works in local development but requires GCP credentials. For local development without GCP:
- Set neither `GCP_PROJECT_ID` nor `GCP_PROJECT_ID_STAGING` 
- Traces will be logged to console but not sent to GCP Trace
- No GCP authentication is required
- Performance impact is minimal

## �🔧 Development

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
- `npm run migrate:up` - Run database migrations
- `npm run migrate:status` - Check migration status
- `npm run scripts:regenerate-dungeon` - Regenerate dungeon data
- `npm run scripts:test-dungeon` - Test dungeon system


## 🗄️ Database Migrations

This project uses **migrate-mongo** to manage database schema changes and versioning.

### Creating and Running Migrations

```bash
# Check migration status
npm run migrate:status

# Run all pending migrations
npm run migrate:up

# Rollback the last migration
npm run migrate:down

# Create a new migration
npm run migrate:create your-migration-name
```

### Available Migrations

The project includes these migrations:
- **20250818140000-create-initial-collections.js** - Creates players and game_sessions collections with indexes
- **20250818140001-add-player-rotation.js** - Adds rotation field to existing player records
- **20250818140002-create-dungeon-collections.js** - Creates dungeon and floor collections with indexes

### Environment Configuration

Migrations use the same environment variables as the application:
- `MONGODB_URI` - MongoDB connection string
- `MONGODB_DB_NAME` - Database name (defaults to 'gamedb')

## 🔧 Available Scripts

### Migration Scripts
- `npm run migrate:up` - Run all pending migrations
- `npm run migrate:down` - Rollback the last migration
- `npm run migrate:status` - Check which migrations have been applied
- `npm run migrate:create` - Create a new migration file

### Utility Scripts
- `npm run scripts:regenerate-dungeon` - Clear and regenerate all dungeon data
- `npm run scripts:delete-dungeon` - Delete all dungeon data
- `npm run scripts:test-dungeon` - Test dungeon data integrity

## 🏗️ Project Structure

```
server/
├── src/
│   ├── config/                 # Configuration files
│   │   └── database.ts         # MongoDB connection
│   ├── middleware/             # Express middleware
│   │   ├── auth.ts            # Authentication middleware
│   │   └── errorHandler.ts     # Error handling
│   ├── routes/                # API routes
│   │   └── dungeon.ts         # Dungeon generation endpoints
│   ├── services/              # Business logic
│   │   ├── authService.ts     # External auth server integration
│   │   ├── dungeonService.ts  # Dungeon and floor generation
│   │   ├── playerService.ts   # Player data management
│   │   └── websocket.ts       # WebSocket server logic
│   ├── types/                 # TypeScript type definitions
│   │   └── game.ts            # Game-related types (including dungeon types)
│   └── index.ts               # Server entry point
├── migrations/                # Database migrations (migrate-mongo)
│   ├── 20250818140000-create-initial-collections.js
│   ├── 20250818140001-add-player-rotation.js
│   └── 20250818140002-create-dungeon-collections.js
├── scripts/                   # Utility scripts
│   ├── regenerate-dungeon.ts  # Regenerate dungeon data
│   ├── delete-dungeon.ts      # Delete dungeon data
│   └── test-dungeon.ts        # Test dungeon system
├── migrate-mongo-config.js    # Migration configuration
├── docker-compose.yml         # Docker services
├── docker-compose.prod.yml    # Production Docker services
├── Dockerfile                 # Container configuration
├── Dockerfile.prod            # Production container
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

## 🏰 Dungeon Generation API

The server includes a procedural dungeon generation system with REST endpoints for managing dungeon exploration.

### Authentication

All dungeon endpoints require Firebase authentication. Include the token in the Authorization header:

```
Authorization: Bearer your_firebase_jwt_token
```

### Endpoints

#### Player Movement Notification

**POST** `/api/dungeon/player-moved-floor`

Notify the server that a player has moved to a new floor. This triggers automatic generation of additional floors if needed.

**Request Body:**
```json
{
  "newFloorName": "A"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Floor generation checked and updated if needed"
}
```

#### Get Floor Layout

**GET** `/api/dungeon/floor/:dungeonDagNodeName`

Retrieve the complete floor layout for rendering on the client.

**Parameters:**
- `dungeonDagNodeName`: The name of the dungeon node (e.g., "A", "AA", "AB")

**Response:**
```json
{
  "success": true,
  "data": {
    "dungeonDagNodeName": "A",
    "nodes": [
      {
        "name": "A_A",
        "dungeonDagNodeName": "A",
        "children": ["A_AA", "A_AB"],
        "isRoom": true,
        "hasUpwardStair": true,
        "hasDownwardStair": false,
        "roomWidth": 15,
        "roomHeight": 12,
        "stairLocationX": 7.5,
        "stairLocationY": 6.0
      },
      {
        "name": "A_AA",
        "dungeonDagNodeName": "A",
        "children": [],
        "isRoom": false,
        "hallwayLength": 8
      }
    ]
  }
}
```

#### Get Room Stairs

**GET** `/api/dungeon/room-stairs/:floorDagNodeName`

Get stair information for a specific room, including connections to other floors.

**Parameters:**
- `floorDagNodeName`: The name of the room node (e.g., "A_A")

**Response:**
```json
{
  "success": true,
  "data": {
    "upwardStair": {
      "floorDagNodeName": "A_A",
      "dungeonDagNodeName": "ROOT",
      "locationX": 7.5,
      "locationY": 6.0
    },
    "downwardStair": {
      "floorDagNodeName": "AA_A",
      "dungeonDagNodeName": "AA",
      "locationX": 12.3,
      "locationY": 8.7
    }
  }
}
```

#### Get Spawn Location

**GET** `/api/dungeon/spawn`

Get the starting dungeon floor for new players.

**Response:**
```json
{
  "success": true,
  "data": {
    "dungeonDagNodeName": "A"
  }
}
```

### Dungeon System Architecture

The dungeon generation system uses two interconnected DAGs (Directed Acyclic Graphs):

#### Dungeon DAG
- Represents the overall dungeon structure with floors and connections
- Nodes are named using alphabetic progression: A → AA, AB, AC → AAA, AAB, etc.
- Each node represents a complete floor
- Supports infinite procedural generation

#### Floor DAG  
- Represents the layout of a single floor
- Contains rooms (rectangular spaces) and hallways (connective passages)
- Rooms can contain upward/downward stairs
- Each floor typically contains 5-10 rooms

#### Procedural Generation Features

- **Infinite Generation**: New floors are generated as players explore deeper
- **Dynamic Loading**: Floors are generated 3 levels ahead of the deepest player
- **Boss Levels**: Special floors that terminate branches (10% chance)
- **Multiple Paths**: Each floor can have 1-2 downward connections
- **Randomized Layouts**: Room sizes, hallway lengths, and connections are procedurally generated

## 🔐 Security Features

- **External Auth Server Integration**: Firebase token verification via external auth server
- **JWT Token Verification**: Secure token validation through auth server proxy
- **No Direct Firebase Dependencies**: Authentication handled by external service
- **No Local Auth Endpoints**: This server focuses on game logic, authentication is delegated
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
