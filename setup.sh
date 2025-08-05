#!/bin/bash

# Organic Fresh Coffee Game Server Setup Script
# This script installs all dependencies and sets up the development environment

set -e  # Exit on error

echo "🎮 Setting up Organic Fresh Coffee Game Server..."
echo "=================================================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    echo "Visit: https://nodejs.org/"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -e "process.exit(require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION') ? 0 : 1)" 2>/dev/null; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please install v$REQUIRED_VERSION or higher."
    exit 1
fi

echo "✅ Node.js version: v$NODE_VERSION"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop."
    echo "Visit: https://www.docker.com/get-started"
    exit 1
fi

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

echo "✅ Docker and Docker Compose are available"

# Check if Google Cloud CLI is installed
if ! command -v gcloud &> /dev/null; then
    echo "⚠️  Google Cloud CLI is not installed."
    echo "For Firebase authentication, please install gcloud CLI:"
    echo "Visit: https://cloud.google.com/sdk/docs/install"
    echo ""
    echo "You can continue without it for local development, but you'll need it for production."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ Google Cloud CLI is installed"
fi

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration before starting the server."
    echo "   Required variables:"
    echo "   - GOOGLE_CLOUD_PROJECT"
    echo "   - GOOGLE_APPLICATION_CREDENTIALS"
    echo ""
fi

# Check if service account key exists
if [ ! -f "service-account-key.json" ]; then
    echo "⚠️  Service account key file not found: service-account-key.json"
    echo "   Please follow the setup instructions in README.md to:"
    echo "   1. Set up Google Cloud Project"
    echo "   2. Create service account"
    echo "   3. Download service account key"
    echo "   4. Store Firebase secrets in Secret Manager"
    echo ""
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Set up development database (optional)
echo "🗃️  Setting up development database..."
echo "Starting MongoDB container for development..."
docker compose up -d mongodb

# Wait for MongoDB to be ready
echo "⏳ Waiting for MongoDB to be ready..."
sleep 10

# Check if MongoDB is running
if docker compose ps mongodb | grep -q "Up"; then
    echo "✅ MongoDB is running"
else
    echo "❌ Failed to start MongoDB"
    exit 1
fi

echo ""
echo "🎉 Setup completed successfully!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your configuration"
echo "2. Set up Google Cloud Project and Firebase (see README.md)"
echo "3. Run './start.sh' to start the server"
echo ""
echo "For development:"
echo "  npm run dev    # Start development server with hot reload"
echo ""
echo "For production:"
echo "  ./start.sh     # Start with Docker Compose"
echo ""
echo "Database management:"
echo "  MongoDB Express: http://localhost:8081 (admin/password)"
echo "  MongoDB Direct: mongodb://admin:password@localhost:27017/gamedb"
echo ""
