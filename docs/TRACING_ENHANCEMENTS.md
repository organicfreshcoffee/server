# GCP Tracing Enhancements

## Overview

The Google Cloud Platform (GCP) tracing system has been significantly enhanced to provide better visibility into database queries, REST routes, and application performance. This document outlines the improvements made to ensure comprehensive tracing across the entire application.

## Key Enhancements

### 1. App Hub Application Configuration ✅

**Problem**: The "App Hub application" field was not being set properly in GCP tracing console.

**Solution**: Enhanced the `initializeTracing()` function to properly set the service name based on environment:
- **Production**: `"game server production"`
- **Staging**: `"game server staging"`  
- **Development**: `"organic-fresh-coffee-game-server"`

**Location**: `src/config/tracing.ts`

### 2. Database Query Tracing ✅

**Problem**: Database queries, especially `find()` operations, were not being properly traced because they return cursors.

**Solution**: Created comprehensive database tracing wrappers:
- `TracedFindCursor` - Wraps MongoDB find cursors with tracing
- `TracedAggregateCursor` - Wraps MongoDB aggregate cursors with tracing
- Enhanced all database operations (findOne, insertOne, updateOne, etc.) with detailed tracing attributes

**Features Added**:
- Traces cursor consumption (toArray, next, forEach)
- Captures result counts and data sizes
- Adds MongoDB operation metadata
- Handles both find and aggregate operations

**Location**: `src/config/database.ts`

### 3. REST Route Tracing ✅

**Problem**: Not all REST endpoints were appearing in the tracing console UI, and async operations weren't being traced properly.

**Solution**: Enhanced the tracing middleware with:
- Better async operation handling
- More descriptive operation names
- Enhanced request/response payload tracking
- Error state tracking
- Route parameter and query parameter capture

**Features Added**:
- Captures HTTP status codes and response classes (2xx, 4xx, 5xx)
- Tracks request/response sizes
- Adds error categorization (client_error, server_error, response_error)
- Captures user agent, host, and other HTTP metadata
- Handles connection close events

**Location**: `src/middleware/tracing.ts`

### 4. Enhanced Service Layer Tracing ✅

**Problem**: Some service methods were not being traced consistently.

**Solution**: Added comprehensive tracing to service operations:
- Enhanced `PlayerService` with detailed tracing attributes
- Added user context and operation success/failure tracking
- Created helper functions for common tracing patterns

**Features Added**:
- `traceRouteHandler()` - For wrapping route handlers
- `traceServiceOperation()` - For service method tracing
- `traceExternalApiCall()` - For external API calls
- Enhanced user context tracking

**Location**: `src/services/playerService.ts`, `src/config/tracing.ts`

### 5. Middleware Ordering Optimization ✅

**Problem**: Tracing middleware wasn't properly capturing request bodies.

**Solution**: Reordered middleware stack to ensure:
1. Security (Helmet)
2. CORS
3. Body parsing (Express JSON/URL-encoded)
4. Tracing middleware
5. User context tracing
6. Route handlers

**Location**: `src/index.ts`

## Configuration

### Environment Variables

The tracing system automatically detects the environment and configures the service name:

```bash
# Production Environment
NODE_ENV=production
GCP_PROJECT_ID=your-production-project-id

# Staging Environment  
NODE_ENV=staging
GCP_PROJECT_ID_STAGING=your-staging-project-id

# Optional: Adjust sampling rate (default: 1.0 = 100%)
TRACE_SAMPLING_RATE=1.0
```

### GCP Console Verification

After deploying with these enhancements, you should see:

1. **App Hub Application**: "game server production" or "game server staging"
2. **Database Operations**: All MongoDB queries, inserts, updates, deletes
3. **REST Endpoints**: All API routes with detailed timing and metadata
4. **Error Tracking**: Failed requests with proper error categorization
5. **User Context**: User IDs and authentication status in traces

## Tracing Attributes Reference

### HTTP Requests
- `http.method` - HTTP method (GET, POST, etc.)
- `http.url` - Full request URL
- `http.route` - Route pattern
- `http.status_code` - HTTP response status
- `http.status_class` - Status class (2xx, 4xx, 5xx)
- `http.duration_ms` - Request duration in milliseconds
- `http.success` - Boolean success indicator

### Database Operations
- `db.operation` - Operation type (findOne, insertOne, etc.)
- `db.collection` - MongoDB collection name
- `db.system` - Database system (mongodb)
- `db.mongodb.filter` - Query filter
- `db.mongodb.result_count` - Number of results returned
- `db.mongodb.result_size` - Size of results in bytes

### User Context
- `user.id` - User ID
- `user.email` - User email (if available)
- `auth.authenticated` - Authentication status
- `auth.type` - Authentication type (bearer_token, etc.)

### Game-Specific
- `player.operation` - Player service operation type
- `player.found` - Whether player was found
- `player.is_online` - Player online status
- `player.current_floor` - Current dungeon floor

## Testing the Enhancements

### 1. Verify App Hub Application
1. Deploy to staging/production
2. Check GCP Trace console
3. Confirm service name appears as "game server production" or "game server staging"

### 2. Verify Database Tracing
1. Make API calls that query the database
2. Check GCP Trace console for `db.*` operations
3. Verify operations like `db.findOne.players` and `db.find.toArray.itemInstances` appear

### 3. Verify Route Tracing
1. Test various API endpoints
2. Check for traces with names like `GET /api/dungeon/current-status`
3. Verify all endpoints appear in the console

## Performance Considerations

- **Sampling Rate**: Default is 100% (1.0). Reduce for high-traffic production environments
- **Payload Logging**: Only payloads < 1KB are logged in full to prevent excessive data
- **Buffer Settings**: Traces are buffered and sent every 30 seconds
- **Ignored URLs**: `/health` and `/favicon.ico` are ignored to reduce noise

## Best Practices

### Adding Tracing to New Routes
```typescript
import { traceRouteHandler } from '../config/tracing';

router.get('/new-endpoint', async (req: AuthenticatedRequest, res) => {
  try {
    await traceRouteHandler('new-endpoint', async () => {
      // Route logic here
      const result = await someService.doSomething();
      res.json({ success: true, data: result });
    }, req);
  } catch (error) {
    // Error handling
  }
});
```

### Adding Tracing to Services
```typescript
import { traceServiceOperation } from '../config/tracing';

async myServiceMethod(param: string): Promise<Result> {
  return traceServiceOperation('MyService', 'myMethod', async () => {
    // Service logic here
    return await doSomething(param);
  }, {
    'custom.attribute': param,
  });
}
```

## Troubleshooting

### Traces Not Appearing
1. Verify `GCP_PROJECT_ID` or `GCP_PROJECT_ID_STAGING` is set
2. Check Cloud Run service has proper IAM permissions for Cloud Trace
3. Verify environment variables in deployment

### Incomplete Database Traces
1. Ensure all database operations go through the `getDatabase()` function
2. Check that cursors are being consumed (`.toArray()`, `.next()`, etc.)
3. Verify tracing is enabled (GCP project ID is set)

### Missing Route Traces
1. Verify middleware ordering in `src/index.ts`
2. Check that routes are using the enhanced tracing patterns
3. Ensure authentication middleware is not preventing trace creation

## Migration Checklist

- [x] Enhanced tracing configuration with environment-based service names
- [x] Added comprehensive database cursor tracing
- [x] Improved REST route tracing middleware
- [x] Enhanced service layer tracing
- [x] Optimized middleware ordering
- [x] Added new tracing helper functions
- [x] Documented configuration and usage

The GCP tracing system is now significantly more comprehensive and should provide complete visibility into your application's performance and behavior.
