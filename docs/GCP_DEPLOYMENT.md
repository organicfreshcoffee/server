# GCP Deployment Setup Guide

This guide will help you deploy the Organic Fresh Coffee Game Server to Google Cloud Platform using Cloud Run and GitHub Actions.

## Prerequisites

1. **GCP Account**: [Create a GCP account](https://cloud.google.com/)
2. **GCP Project**: Create a new project or use an existing one
3. **MongoDB Database**: Set up MongoDB Atlas (recommended) or use Cloud SQL

## Step 1: GCP Project Setup

### 1.1 Enable Required APIs

```bash
# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable artifactregistry.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### 1.2 Create Artifact Registry Repository

```bash
# Create repository for Docker images
gcloud artifacts repositories create game-server \
    --repository-format=docker \
    --location=us-central1 \
    --description="Game server container images"
```

## Step 2: Set Up Workload Identity Federation

This is the recommended secure way to authenticate GitHub Actions with GCP without storing service account keys.

### 2.1 Create Service Account

```bash
# Create service account
gcloud iam service-accounts create github-actions-sa \
    --display-name="GitHub Actions Service Account"

# Get your project ID
export PROJECT_ID=$(gcloud config get-value project)

# Grant necessary permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/run.admin"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.serviceAccountUser"
```

### 2.2 Create Workload Identity Pool

```bash
# Create workload identity pool
gcloud iam workload-identity-pools create "github-actions-pool" \
    --location="global" \
    --display-name="GitHub Actions Pool"

# Create workload identity provider
gcloud iam workload-identity-pools providers create-oidc "github-actions-provider" \
    --location="global" \
    --workload-identity-pool="github-actions-pool" \
    --display-name="GitHub Actions Provider" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
    --issuer-uri="https://token.actions.githubusercontent.com"

# Allow GitHub Actions to impersonate the service account
gcloud iam service-accounts add-iam-policy-binding \
    "github-actions-sa@$PROJECT_ID.iam.gserviceaccount.com" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')/locations/global/workloadIdentityPools/github-actions-pool/attribute.repository/organicfreshcoffee/server"
```

### 2.3 Get Workload Identity Provider Name

```bash
# Get the full provider name (you'll need this for GitHub secrets)
gcloud iam workload-identity-pools providers describe "github-actions-provider" \
    --location="global" \
    --workload-identity-pool="github-actions-pool" \
    --format="value(name)"
```

## Step 3: Set Up MongoDB

### Option A: MongoDB Atlas (Recommended)

1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free cluster
3. Create a database user
4. **Configure Network Access**:
   - Add `0.0.0.0/0` to IP whitelist (Allow access from anywhere)
   - Comment: "Allow all IPs for Cloud Run"
5. Get your connection string

**Note**: While `0.0.0.0/0` allows access from anywhere, your MongoDB connection is still secured by:
- Username/password authentication
- TLS encryption
- MongoDB Atlas built-in security features

### Option B: Cloud SQL for MongoDB (Alternative)

```bash
# Create Cloud SQL instance with MongoDB
gcloud sql instances create game-mongodb \
    --database-version=MYSQL_8_0 \
    --tier=db-f1-micro \
    --region=us-central1
```

*Note: Cloud SQL doesn't directly support MongoDB. Consider using MongoDB Atlas or Firestore.*

## Step 4: Configure GitHub Secrets

Go to your GitHub repository → Settings → Secrets and Variables → Actions, and add these secrets:

### Required Secrets:

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `GCP_PROJECT_ID` | Your GCP Project ID | `my-project-12345` |
| `WORKLOAD_IDENTITY_PROVIDER` | Full provider name from step 2.3 | `projects/123456789/locations/global/workloadIdentityPools/github-actions-pool/providers/github-actions-provider` |
| `SERVICE_ACCOUNT_EMAIL` | Service account email | `github-actions-sa@my-project-12345.iam.gserviceaccount.com` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/gamedb` |
| `AUTH_SERVER_URL` | Your auth server URL | `https://your-auth-server.com` |
| `CLIENT_URL` | Your client app URL | `https://your-client-app.com` |

## Step 5: Deploy

1. **Push to main branch**: The GitHub Action will automatically trigger
2. **Monitor deployment**: Check the Actions tab in your GitHub repository
3. **Get service URL**: The workflow will output the Cloud Run service URL

## Step 6: Configure Domain (Optional)

### 6.1 Map Custom Domain

```bash
# Map your domain to Cloud Run
gcloud run domain-mappings create \
    --service=organicfreshcoffee-game-server \
    --domain=api.yourdomain.com \
    --region=us-central1
```

### 6.2 Update DNS

Add the provided DNS records to your domain registrar.

## Testing Your Deployment

### Health Check
```bash
curl https://your-service-url.run.app/health
```

### WebSocket Connection
```javascript
const ws = new WebSocket('wss://your-service-url.run.app/game');
ws.onopen = () => console.log('Connected!');
```

## Monitoring and Logs

### View Logs
```bash
# View Cloud Run logs
gcloud logs read --service=organicfreshcoffee-game-server --limit=50
```

### Monitor Performance
- Go to Cloud Console → Cloud Run → Your Service
- Check metrics, scaling, and resource usage

## Cost Optimization

### Cloud Run Pricing
- **CPU allocation**: Only charged when handling requests
- **Memory**: Pay for allocated memory during request processing
- **Requests**: $0.40 per million requests
- **CPU time**: $0.000024 per vCPU-second
- **Memory time**: $0.0000025 per GiB-second

### Estimated Monthly Costs (Low Traffic)
- **Cloud Run**: $5-20/month for moderate usage
- **MongoDB Atlas**: $0-9/month (free tier available)
- **Artifact Registry**: $0.10/GB/month for storage

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   - Verify Workload Identity Federation setup
   - Check service account permissions

2. **Build Failures**
   - Check Dockerfile.prod syntax
   - Verify all dependencies in package.json

3. **WebSocket Connection Issues**
   - Ensure Cloud Run timeout is set to 3600 seconds
   - Check firewall rules and CORS configuration

4. **MongoDB Connection Issues**
   - Verify connection string format
   - Check MongoDB Atlas whitelist settings
   - Test connection locally first

### Debug Commands

```bash
# Check Cloud Run service status
gcloud run services describe organicfreshcoffee-game-server --region=us-central1

# View recent logs
gcloud logs read --service=organicfreshcoffee-game-server --limit=100

# Test local Docker build
docker build -f Dockerfile.prod -t test-image .
docker run -p 3002:3002 -e NODE_ENV=production test-image
```

## Security Considerations

1. **Use Workload Identity Federation** (implemented above)
2. **Restrict service account permissions** to minimum required
3. **Use VPC connectors** for private MongoDB access if needed
4. **Enable Cloud Armor** for DDoS protection
5. **Set up monitoring alerts** for unusual activity

## Scaling Configuration

The current setup auto-scales from 0 to 10 instances. Adjust in the GitHub workflow:

```bash
--min-instances 1 \  # Keep at least 1 instance warm
--max-instances 50 \ # Scale up to 50 instances
--concurrency 100 \  # Handle 100 concurrent requests per instance
```

## Alternative: Simple VM Deployment

If you prefer a traditional VM approach (not recommended for this use case):

```bash
# Create VM instance
gcloud compute instances create game-server \
    --zone=us-central1-a \
    --machine-type=e2-small \
    --image-family=cos-stable \
    --image-project=cos-cloud
```

But Cloud Run is much better for your use case due to auto-scaling and cost efficiency.
