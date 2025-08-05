# Organic Fresh Coffee Game Server

A TypeScript Express server with WebSocket support for multiplayer gaming, featuring Firebase authentication, MongoDB data persistence, and Google Cloud Secret Manager integration.

## 🏗️ Architecture

- **Backend**: Express.js with TypeScript
- **WebSocket**: Real-time multiplayer communication
- **Authentication**: Firebase Auth with JWT token verification
- **Database**: MongoDB for player data, positions, and game state
- **Secrets Management**: Google Cloud Secret Manager
- **Infrastructure**: Docker Compose for local development
- **Cloud**: Google Cloud Platform (GCP) integration

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Docker](https://www.docker.com/get-started) and Docker Compose
- [Git](https://git-scm.com/)
- A [Firebase](https://firebase.google.com/) account
- A [Google Cloud Platform](https://cloud.google.com/) account
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (gcloud)

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/organicfreshcoffee/server.git
cd server
./setup.sh
```

### 2. Set Up Firebase

#### Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or "Add project"
3. Follow the setup wizard to create your project
4. Enable Authentication:
   - Go to Authentication > Sign-in method
   - Enable Email/Password provider

#### Generate Firebase Credentials

**For Admin SDK (Server-side):**

1. In Project Settings, go to the Service accounts tab
2. Click Generate new private key
3. Download the JSON file and save it temporarily as `firebase-service-account.json`

### 3. Set Up Google Cloud Platform & Secret Manager

This project uses Google Cloud Secret Manager to securely store all Firebase credentials.

#### Install and Configure Google Cloud CLI

```bash
# Install Google Cloud CLI (if not already installed)
# Follow instructions at: https://cloud.google.com/sdk/docs/install

# Authenticate with Google Cloud
gcloud auth login

# Set your project (use the same project ID as Firebase)
gcloud config set project YOUR_PROJECT_ID

# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com
```

#### Store Firebase Secrets in Secret Manager

1. **Store Firebase Service Account:**

```bash
# Create the service account secret
gcloud secrets create firebase-service-account \
    --replication-policy="automatic"

# Add the service account JSON file as the secret value
gcloud secrets versions add firebase-service-account \
    --data-file="./firebase-service-account.json"
```

2. **Set up Service Account for Application Access:**

```bash
# Create a service account for the application
gcloud iam service-accounts create game-server \
    --display-name="Game Server Service Account"

# Grant Secret Manager access
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
    --member="serviceAccount:game-server@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"

# Create and download a key for the service account
gcloud iam service-accounts keys create ./service-account-key.json \
    --iam-account=game-server@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

3. **Clean up temporary files:**

```bash
# Remove the temporary Firebase files (secrets are now in Secret Manager)
rm firebase-service-account.json
```

### 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` with your Google Cloud configuration:

```env
# Google Cloud Configuration
GOOGLE_CLOUD_PROJECT=your-gcp-project-id
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json

# Environment Configuration
NODE_ENV=development
PORT=3001
CLIENT_URL=http://localhost:3000

# Database Configuration
MONGODB_URI=mongodb://admin:password@localhost:27017/gamedb?authSource=admin

# Note: Firebase secrets are stored in GCP Secret Manager
# See setup instructions above
```

### 5. Start the Server

```bash
./start.sh
```

### 6. Access the Application

- **Game Server API**: [http://localhost:3001](http://localhost:3001/)
- **WebSocket Endpoint**: `ws://localhost:3001/game`
- **Health Check**: [http://localhost:3001/health](http://localhost:3001/health)
- **MongoDB**: `mongodb://admin:password@localhost:27017/gamedb`
- **MongoDB Express**: [http://localhost:8081](http://localhost:8081/) (admin/password)

## 📦 Dependencies

### Production Dependencies

| Package | Version | Description |
|---------|---------|-------------|
| express | ^4.18.2 | Web framework |
| ws | ^8.16.0 | WebSocket library |
| mongodb | ^6.3.0 | MongoDB driver |
| firebase-admin | ^12.0.0 | Firebase Admin SDK |
| @google-cloud/secret-manager | ^5.0.1 | GCP Secret Manager |
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

## 🏗️ Project Structure

```
server/
├── src/
│   ├── config/                 # Configuration files
│   │   ├── database.ts         # MongoDB connection
│   │   └── firebase.ts         # Firebase Admin setup
│   ├── middleware/             # Express middleware
│   │   ├── auth.ts            # Authentication middleware
│   │   └── errorHandler.ts    # Error handling
│   ├── routes/                # API routes
│   │   └── auth.ts            # Authentication routes
│   ├── services/              # Business logic
│   │   ├── playerService.ts   # Player data management
│   │   └── websocket.ts       # WebSocket server logic
│   ├── types/                 # TypeScript type definitions
│   │   └── game.ts            # Game-related types
│   └── index.ts               # Server entry point
├── docker-compose.yml         # Docker services
├── Dockerfile                 # Container configuration
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
    "token": "firebase_jwt_token"
  }
}
```

#### Player Movement

```json
{
  "type": "player_move",
  "data": {
    "position": {
      "x": 10.5,
      "y": 2.0,
      "z": -5.3
    }
  }
}
```

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

#### Player Updates

```json
{
  "type": "player_update",
  "data": {
    "playerId": "player_id",
    "position": { "x": 1, "y": 2, "z": 3 },
    "timestamp": "2023-01-01T00:00:00.000Z"
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

- **Google Cloud Secret Manager**: All sensitive Firebase credentials stored securely
- **Firebase Authentication**: Secure user authentication with JWT tokens
- **JWT Token Verification**: Server-side token validation
- **No Environment Secrets**: No sensitive data in `.env` files or code
- **IAM Access Controls**: Fine-grained permissions for secret access
- **CORS Configuration**: Cross-origin request security
- **Helmet Middleware**: Security headers and protection
- **Input Validation**: WebSocket message validation

## 🛠️ Troubleshooting

### Common Issues

1. **Secret Manager Access Error**
   ```
   Error: Failed to retrieve secret: firebase-service-account
   ```
   
   **Solution:**
   - Verify your service account has `roles/secretmanager.secretAccessor` permission
   - Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to the correct service account key
   - Check that the secret exists: `gcloud secrets list`

2. **Firebase Configuration Error**
   ```
   Error: Failed to retrieve Firebase configuration
   ```
   
   **Solution:**
   - Verify the `firebase-service-account` secret exists in Secret Manager
   - Check the secret contains valid JSON: `gcloud secrets versions access latest --secret="firebase-service-account"`

3. **MongoDB Connection Failed**
   ```
   Error connecting to MongoDB
   ```
   
   **Solution:** Make sure MongoDB is running and the connection string is correct.

4. **WebSocket Connection Failed**
   ```
   WebSocket connection to 'ws://localhost:3001/game' failed
   ```
   
   **Solution:**
   - Ensure the server is running: `docker compose ps`
   - Check server logs: `docker compose logs game-server`
   - Verify the WebSocket endpoint is accessible

5. **Authentication Token Invalid**
   ```
   Error: Invalid authentication token
   ```
   
   **Solution:**
   - Ensure the Firebase token is valid and not expired
   - Check that the Firebase project ID matches your configuration
   - Verify the service account has the necessary permissions

6. **Docker Build Failed**
   ```
   Error building game-server
   ```
   
   **Solution:**
   - Ensure all dependencies are installed: `./setup.sh`
   - Check that all required files exist (especially `service-account-key.json`)
   - Try rebuilding: `docker compose build --no-cache game-server`

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

# Check Secret Manager secrets
gcloud secrets list

# View a secret value (for debugging)
gcloud secrets versions access latest --secret="firebase-service-account"

# Test service account permissions
gcloud auth activate-service-account --key-file=./service-account-key.json
gcloud secrets versions access latest --secret="firebase-service-account"

# Reset MongoDB and rerun initialization script
docker compose down
docker volume rm server_mongodb_data
docker compose up -d mongodb
```

## 🌍 Deployment

### Production Considerations

1. **Environment Variables**: Use production Firebase project
2. **Secret Manager**: Store sensitive data in GCP Secret Manager
3. **Database**: Use MongoDB Atlas or managed MongoDB
4. **SSL/TLS**: Configure HTTPS and WSS
5. **Load Balancing**: Consider multiple server instances
6. **Monitoring**: Add application monitoring and logging

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
2. Review the [Firebase Documentation](https://firebase.google.com/docs)
3. Check [WebSocket API documentation](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
4. Open an issue on GitHub
5. Check Docker and Docker Compose documentation

## 🙏 Acknowledgments

- [Express.js](https://expressjs.com/) for the web framework
- [Firebase](https://firebase.google.com/) for authentication services
- [MongoDB](https://www.mongodb.com/) for the database
- [Docker](https://www.docker.com/) for containerization
- [Google Cloud Platform](https://cloud.google.com/) for secret management
- [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) for real-time communication
