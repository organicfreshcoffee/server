#!/bin/bash

# Organic Fresh Coffee Game Server Start Script - WSL Version
# This script starts the game server using Docker Compose with WSL-compatible configuration

set -e  # Exit on error

echo "🎮 Starting Organic Fresh Coffee Game Server (WSL Compatible)..."
echo "================================================================"

# Check if we're on WSL (optional warning)
if grep -q Microsoft /proc/version 2>/dev/null; then
    echo "🐧 WSL environment detected - using WSL-compatible configuration"
else
    echo "⚠️  This is the WSL-specific start script. For non-WSL systems, consider using ./start.sh"
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker Desktop."
    echo "   Make sure WSL integration is enabled in Docker Desktop settings."
    exit 1
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "❌ .env file not found. Please run ./setup-wsl.sh first."
    exit 1
fi

# Load environment variables
source .env

# Check required environment variables
if [ -z "$AUTH_SERVER_URL" ]; then
    echo "⚠️  AUTH_SERVER_URL is not set in .env file, using default: http://localhost:3001"
fi

# Determine which docker compose command to use
DOCKER_COMPOSE_CMD=""
if command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker compose"
else
    echo "❌ Neither 'docker-compose' nor 'docker compose' is available."
    echo "   Please ensure Docker Compose is properly installed."
    exit 1
fi

echo "🔧 Using Docker Compose command: $DOCKER_COMPOSE_CMD"

# Build and start services using WSL-compatible compose file
echo "🔨 Building and starting services with WSL configuration..."
$DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml down  # Stop any existing containers
$DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml up --build -d

# Wait for services to be ready
echo "⏳ Waiting for services to start..."
sleep 10

# Check service health
echo "🏥 Checking service health..."

# Check MongoDB
if $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml ps mongodb | grep -q "Up"; then
    echo "✅ MongoDB is running"
else
    echo "❌ MongoDB failed to start"
    $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml logs mongodb
    exit 1
fi

# Check Game Server
if $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml ps game-server | grep -q "Up"; then
    echo "✅ Game Server is running"
else
    echo "❌ Game Server failed to start"
    $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml logs game-server
    exit 1
fi

# Test server health endpoint
echo "🔍 Testing server health..."
sleep 5  # Give server more time to start

if curl -f http://localhost:3002/health &> /dev/null; then
    echo "✅ Server health check passed"
else
    echo "⚠️  Server health check failed, but container is running"
    echo "Check logs with: $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml logs game-server"
fi

echo ""
echo "🚀 Game Server is running!"
echo ""
echo "📊 Access URLs:"
echo "  🎮 Game Server: http://localhost:3002"
echo "  🗃️  MongoDB: mongodb://admin:password@localhost:27018/gamedb"
echo "  🖥️  MongoDB Express: http://localhost:8081 (admin/password)"
echo ""
echo "📋 Useful WSL commands:"
echo "  📝 View logs: $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml logs -f"
echo "  🛑 Stop services: $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml down"
echo "  🔄 Restart: $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml restart"
echo "  🔍 Service status: $DOCKER_COMPOSE_CMD -f docker-compose.wsl.yml ps"
