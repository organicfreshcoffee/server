#!/bin/sh

# Wait for MongoDB to be ready by attempting to run migration status
echo "Waiting for MongoDB to be ready..."

# Simple retry loop for migrations
max_attempts=30
attempt=1

while [ $attempt -le $max_attempts ]; do
  echo "Attempt $attempt: Checking if MongoDB is ready..."
  
  if npm run migrate:status > /dev/null 2>&1; then
    echo "MongoDB is ready!"
    break
  fi
  
  if [ $attempt -eq $max_attempts ]; then
    echo "❌ Failed to connect to MongoDB after $max_attempts attempts"
    exit 1
  fi
  
  echo "MongoDB not ready yet, waiting 2 seconds..."
  sleep 2
  attempt=$((attempt + 1))
done

echo "Running migrations..."

# Run database migrations with error handling
if ! npm run migrate:up; then
  echo "❌ Migration failed - stopping application startup"
  exit 1
fi

echo "✅ Migrations completed successfully. Starting application..."

# Start the application
exec "$@"
