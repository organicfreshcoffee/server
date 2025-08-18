# Staging Environment Setup Guide

This guide helps you set up and configure the staging environment for the Organic Fresh Coffee game server.

## Overview

The project now supports both staging and production environments:

- **Production**: `server.organicfreshcoffee.com`
- **Staging**: `staging-server.organicfreshcoffee.com`

## Prerequisites

1. **DNS Records**: Ensure you have DNS records configured for `staging-server.organicfreshcoffee.com`
2. **GCP Project**: Access to the Google Cloud Platform project
3. **GitHub Repository**: Admin access to configure secrets and environments

## Setup Steps

### 1. Configure GCP Resources for Staging

Run the setup script for staging:

```bash
./scripts/setup-gcp.sh staging
```

This will create:
- Staging-specific service account
- Staging artifact registry
- Staging workload identity federation

### 2. Configure Custom Domain for Staging

Run the domain setup script for staging:

```bash
./scripts/setup-domain.sh staging
```

This will:
- Create domain mapping for `staging-server.organicfreshcoffee.com`
- Provide DNS configuration instructions

### 3. Configure GitHub Secrets

Add the following secrets to your GitHub repository:

#### Staging Secrets
- `GCP_PROJECT_ID_STAGING`: Your GCP project ID (usually same as production)
- `SERVICE_ACCOUNT_EMAIL_STAGING`: Service account email from step 1
- `WORKLOAD_IDENTITY_PROVIDER_STAGING`: Workload identity provider from step 1
- `MONGODB_URI_STAGING`: MongoDB connection string for staging
- `AUTH_SERVER_URL_STAGING`: Auth server URL for staging
- `CLIENT_URL_STAGING`: Client app URL for staging (e.g., `https://staging.organicfreshcoffee.com`)

#### Existing Production Secrets (should already exist)
- `GCP_PROJECT_ID`: Your GCP project ID
- `SERVICE_ACCOUNT_EMAIL`: Production service account email
- `WORKLOAD_IDENTITY_PROVIDER`: Production workload identity provider
- `MONGODB_URI`: Production MongoDB connection string
- `AUTH_SERVER_URL`: Production auth server URL
- `CLIENT_URL`: Production client app URL

### 4. Configure GitHub Environments

1. Go to your repository settings
2. Click on "Environments"
3. Create two environments:
   - `staging`
   - `production`
4. Optionally add protection rules (e.g., required reviewers for production)

## Deployment Workflows

### Main Branch Deployment

When you push to the `main` branch:
1. Tests run
2. Deploy to staging
3. If staging succeeds, deploy to production

### PR Branch Deployment

To deploy a PR branch to staging:
1. Add the `deploy` label to your pull request
2. The PR will be automatically deployed to staging
3. A comment will be added to the PR with deployment details

## CORS Configuration

The server now accepts requests from:
- `https://organicfreshcoffee.com`
- `https://www.organicfreshcoffee.com`
- `https://server.organicfreshcoffee.com`
- `https://staging.organicfreshcoffee.com`
- `https://staging-api.organicfreshcoffee.com`
- `https://staging-server.organicfreshcoffee.com`

## Testing

### Staging Endpoints
- Health Check: `https://staging-server.organicfreshcoffee.com/health`
- WebSocket: `wss://staging-server.organicfreshcoffee.com/game`
- API: `https://staging-server.organicfreshcoffee.com/api/`

### Production Endpoints
- Health Check: `https://server.organicfreshcoffee.com/health`
- WebSocket: `wss://server.organicfreshcoffee.com/game`
- API: `https://server.organicfreshcoffee.com/api/`

## Troubleshooting

### DNS Issues
- Verify DNS records are correctly configured in Google Domains
- Check DNS propagation: `nslookup staging-server.organicfreshcoffee.com`
- DNS changes can take up to 48 hours to propagate

### Deployment Issues
- Check GitHub Actions logs for detailed error messages
- Verify all required secrets are configured
- Ensure service accounts have proper permissions

### CORS Issues
- Verify the CLIENT_URL environment variables match your frontend domains
- Check browser developer tools for CORS error details

## Scripts Reference

### GCP Setup
```bash
# Setup production (default)
./scripts/setup-gcp.sh

# Setup staging
./scripts/setup-gcp.sh staging
```

### Domain Setup
```bash
# Setup production domain (default)
./scripts/setup-domain.sh

# Setup staging domain
./scripts/setup-domain.sh staging
```

## Environment Variables

### Staging
- `NODE_ENV=staging`
- `AUTH_SERVER_URL`: Staging auth server
- `MONGODB_URI`: Staging database
- `CLIENT_URL`: Staging frontend URL

### Production
- `NODE_ENV=production`
- `AUTH_SERVER_URL`: Production auth server
- `MONGODB_URI`: Production database
- `CLIENT_URL`: Production frontend URL
