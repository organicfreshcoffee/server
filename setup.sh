#!/bin/bash

# Organic Fresh Coffee Game Server Setup Script
# This script sets up the development environment for the game server

set -e  # Exit on error

echo "🎮 Setting up Organic Fresh Coffee Game Server..."
echo "==============================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js $(node --version) detected"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    echo "Visit: https://www.docker.com/get-started"
    exit 1
fi

echo "✅ Docker detected"

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please ensure Docker Desktop is running."
    exit 1
fi

echo "✅ Docker Compose detected"
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ Google Cloud CLI is installed"
fi

# Install npm dependencies
echo "📦 Installing Node.js dependencies..."
npm install

echo "✅ Dependencies installed successfully"

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "✅ .env file created"
    echo ""
    echo "⚠️  Please review and update the .env file with your configuration:"
    echo "   - AUTH_SERVER_URL: URL of the auth server (default: http://localhost:3001)"
    echo "   - MONGODB_URI: MongoDB connection string (default is fine for local development)"
else
    echo "✅ .env file already exists"
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

echo "✅ TypeScript build completed"

# Test MongoDB connection
echo "�️  Testing MongoDB connection..."
if docker compose up -d mongodb; then
    echo "✅ MongoDB container started"
    
    # Wait for MongoDB to be ready
    echo "⏳ Waiting for MongoDB to be ready..."
    sleep 10
    
    # Test connection
    if docker compose exec -T mongodb mongosh --eval "db.runCommand('ping')" &> /dev/null; then
        echo "✅ MongoDB connection test passed"
    else
        echo "⚠️  MongoDB connection test failed, but container is running"
    fi
    
    # Stop MongoDB (will be started again by start.sh)
    docker compose stop mongodb
else
    echo "❌ Failed to start MongoDB container"
    exit 1
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "  1. Review and update the .env file if needed"
echo "  2. Ensure the auth server is running on the configured URL"
echo "  3. Run './start.sh' to start the game server"
echo ""
echo "Important Notes:"
echo "  - This game server requires an auth server to verify Firebase tokens"
echo "  - Default auth server URL: http://localhost:3001"
echo "  - Game server will run on port 3002"
echo "  - MongoDB will run on port 27017"
echo ""
echo "For more information, see README.md"
