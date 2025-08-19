#!/bin/bash

# WSL Setup Script for Organic Fresh Coffee Game Server
# This script helps set up the development environment on WSL

set -e

echo "🚀 Setting up Organic Fresh Coffee Game Server for WSL..."

# Check if we're running on WSL
if ! grep -q Microsoft /proc/version 2>/dev/null; then
    echo "⚠️  This script is designed for WSL. You might want to use the regular setup.sh instead."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop for Windows first."
    echo "   Download from: https://docs.docker.com/desktop/windows/install/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please ensure Docker Desktop is properly installed."
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOL
# MongoDB Configuration
MONGODB_URI=mongodb://admin:password@localhost:27018/gamedb?authSource=admin

# Server Configuration
PORT=3002
NODE_ENV=development

# Auth Server Configuration
AUTH_SERVER_URL=http://localhost:3001

# WSL-specific configurations
DOCKER_BUILDKIT=1
COMPOSE_DOCKER_CLI_BUILD=1
EOL
    echo "✅ Created .env file with default WSL-compatible settings"
else
    echo "📄 .env file already exists"
fi

# Install Node.js dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Build the project to check for TypeScript errors
echo "🔨 Building TypeScript project..."
npm run build

# Clean up any existing containers
echo "🧹 Cleaning up existing containers..."
docker-compose -f docker-compose.wsl.yml down --volumes --remove-orphans 2>/dev/null || true

# Build and start services using WSL-compatible compose file
echo "🐳 Building and starting services with WSL-compatible configuration..."
docker-compose -f docker-compose.wsl.yml up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
echo "🔍 Checking service status..."
if docker-compose -f docker-compose.wsl.yml ps | grep -q "Up"; then
    echo "✅ Services are running!"
    echo ""
    echo "🎉 Setup complete! Your services are available at:"
    echo "   🎮 Game Server: http://localhost:3002"
    echo "   🗄️  MongoDB: localhost:27018"
    echo "   📊 Mongo Express: http://localhost:8081 (admin/password)"
    echo ""
    echo "📋 Useful commands:"
    echo "   View logs: docker-compose -f docker-compose.wsl.yml logs -f"
    echo "   Stop services: docker-compose -f docker-compose.wsl.yml down"
    echo "   Restart: docker-compose -f docker-compose.wsl.yml restart"
    echo ""
    echo "🔧 Development workflow:"
    echo "   1. Make code changes in your editor"
    echo "   2. Rebuild: docker-compose -f docker-compose.wsl.yml up --build -d"
    echo "   3. Test your changes at http://localhost:3002"
else
    echo "❌ Some services failed to start. Check the logs:"
    docker-compose -f docker-compose.wsl.yml logs
    exit 1
fi
