#!/bin/bash

# GCP Deployment Setup Script
# This script helps set up the necessary GCP resources for deploying the game server
# Usage: ./setup-gcp.sh [staging|production]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get environment argument
ENVIRONMENT=${1:-production}

# Validate environment
if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    echo -e "${RED}Error: Environment must be 'staging' or 'production'${NC}"
    echo "Usage: $0 [staging|production]"
    exit 1
fi

# Configuration
PROJECT_ID=""
REGION="us-central1"

# Environment-specific configuration
if [ "$ENVIRONMENT" = "staging" ]; then
    SERVICE_NAME="organicfreshcoffee-game-server-staging"
    SERVICE_ACCOUNT_NAME="github-actions-sa-staging"
    REPOSITORY_NAME="game-server-staging"
else
    SERVICE_NAME="organicfreshcoffee-game-server"
    SERVICE_ACCOUNT_NAME="github-actions-sa"
    REPOSITORY_NAME="game-server"
fi

print_header() {
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  GCP Deployment Setup for Game Server${NC}"
    echo -e "${BLUE}  Environment: ${ENVIRONMENT}${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_prerequisites() {
    print_step "Checking prerequisites..."
    
    # Check if gcloud is installed
    if ! command -v gcloud &> /dev/null; then
        print_error "gcloud CLI is not installed. Please install it from: https://cloud.google.com/sdk/docs/install"
        exit 1
    fi
    
    # Check if user is authenticated
    if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
        print_error "You are not authenticated with gcloud. Please run: gcloud auth login"
        exit 1
    fi
    
    print_info "Prerequisites check passed!"
}

get_project_id() {
    if [ -z "$PROJECT_ID" ]; then
        CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
        if [ -n "$CURRENT_PROJECT" ]; then
            echo -e "Current project: ${GREEN}$CURRENT_PROJECT${NC}"
            read -p "Use this project? (y/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                PROJECT_ID=$CURRENT_PROJECT
            fi
        fi
        
        if [ -z "$PROJECT_ID" ]; then
            read -p "Enter your GCP Project ID: " PROJECT_ID
        fi
    fi
    
    # Set the project
    gcloud config set project $PROJECT_ID
    print_info "Using project: $PROJECT_ID"
}

enable_apis() {
    print_step "Enabling required APIs..."
    
    gcloud services enable run.googleapis.com
    gcloud services enable artifactregistry.googleapis.com
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable iam.googleapis.com
    gcloud services enable cloudresourcemanager.googleapis.com
    
    print_info "APIs enabled successfully!"
}

create_artifact_registry() {
    print_step "Creating Artifact Registry repository..."
    
    # Check if repository already exists
    if gcloud artifacts repositories describe $REPOSITORY_NAME --location=$REGION &>/dev/null; then
        print_warning "Repository $REPOSITORY_NAME already exists in $REGION"
    else
        gcloud artifacts repositories create $REPOSITORY_NAME \
            --repository-format=docker \
            --location=$REGION \
            --description="Game server container images for $ENVIRONMENT"
        print_info "Artifact Registry repository created!"
    fi
}

create_service_account() {
    print_step "Creating service account for GitHub Actions..."
    
    # Check if service account already exists
    if gcloud iam service-accounts describe "${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" &>/dev/null; then
        print_warning "Service account $SERVICE_ACCOUNT_NAME already exists"
    else
        gcloud iam service-accounts create $SERVICE_ACCOUNT_NAME \
            --display-name="GitHub Actions Service Account ($ENVIRONMENT)"
        print_info "Service account created!"
    fi
    
    # Grant necessary permissions
    print_info "Granting permissions to service account..."
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/run.admin"
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/artifactregistry.writer"
    
    gcloud projects add-iam-policy-binding $PROJECT_ID \
        --member="serviceAccount:${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/iam.serviceAccountUser"
}

setup_workload_identity() {
    print_step "Setting up Workload Identity Federation..."
    
    # Environment-specific pool and provider names
    POOL_NAME="github-actions-pool-${ENVIRONMENT}"
    PROVIDER_NAME="github-actions-provider-${ENVIRONMENT}"
    
    # Create workload identity pool
    if gcloud iam workload-identity-pools describe "$POOL_NAME" --location="global" &>/dev/null; then
        print_warning "Workload identity pool already exists"
    else
        gcloud iam workload-identity-pools create "$POOL_NAME" \
            --location="global" \
            --display-name="GitHub Actions Pool ($ENVIRONMENT)"
        print_info "Workload identity pool created!"
    fi
    
    # Create workload identity provider
    if gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
        --location="global" \
        --workload-identity-pool="$POOL_NAME" &>/dev/null; then
        print_warning "Workload identity provider already exists"
    else
        gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
            --location="global" \
            --workload-identity-pool="$POOL_NAME" \
            --display-name="GitHub Actions Provider ($ENVIRONMENT)" \
            --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
            --attribute-condition="assertion.repository_owner == 'organicfreshcoffee'" \
            --issuer-uri="https://token.actions.githubusercontent.com"
        print_info "Workload identity provider created!"
    fi
    
    # Get project number
    PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
    
    # Allow GitHub Actions to impersonate the service account
    gcloud iam service-accounts add-iam-policy-binding \
        "${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com" \
        --role="roles/iam.workloadIdentityUser" \
        --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/organicfreshcoffee/server"
    
    print_info "Workload Identity Federation configured!"
}

print_summary() {
    print_step "Setup completed! Here's what you need to configure in GitHub:"
    echo ""
    echo -e "${YELLOW}GitHub Secrets to add for ${ENVIRONMENT}:${NC}"
    echo "=============================="
    
    # Environment-specific secret naming
    if [ "$ENVIRONMENT" = "staging" ]; then
        echo "GCP_PROJECT_ID_STAGING: $PROJECT_ID"
        echo "SERVICE_ACCOUNT_EMAIL_STAGING: ${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
        
        # Get the full workload identity provider name
        PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
        WORKLOAD_IDENTITY_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool-${ENVIRONMENT}/providers/github-actions-provider-${ENVIRONMENT}"
        echo "WORKLOAD_IDENTITY_PROVIDER_STAGING: $WORKLOAD_IDENTITY_PROVIDER"
        echo ""
        echo -e "${YELLOW}Additional secrets you need to add for staging:${NC}"
        echo "=============================================="
        echo "MONGODB_URI_STAGING: (your MongoDB connection string for staging)"
        echo "AUTH_SERVER_URL_STAGING: (your auth server URL for staging)"
        echo "CLIENT_URL_STAGING: (your client app URL for staging)"
    else
        echo "GCP_PROJECT_ID: $PROJECT_ID"
        echo "SERVICE_ACCOUNT_EMAIL: ${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
        
        # Get the full workload identity provider name
        PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
        WORKLOAD_IDENTITY_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github-actions-pool-${ENVIRONMENT}/providers/github-actions-provider-${ENVIRONMENT}"
        echo "WORKLOAD_IDENTITY_PROVIDER: $WORKLOAD_IDENTITY_PROVIDER"
        echo ""
        echo -e "${YELLOW}Additional secrets you need to add for production:${NC}"
        echo "==============================================="
        echo "MONGODB_URI: (your MongoDB connection string)"
        echo "AUTH_SERVER_URL: (your auth server URL)"
        echo "CLIENT_URL: (your client app URL)"
    fi
    
    echo ""
    echo -e "${GREEN}Your Cloud Run service will be available at:${NC}"
    echo "https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo "1. Add the secrets above to your GitHub repository"
    echo "2. Set up your MongoDB database (MongoDB Atlas recommended)"
    echo "3. Push to main branch to trigger deployment"
    echo "4. Check the Actions tab in GitHub to monitor the deployment"
}

# Main execution
main() {
    print_header
    check_prerequisites
    get_project_id
    enable_apis
    create_artifact_registry
    create_service_account
    setup_workload_identity
    print_summary
}

# Run main function
main "$@"
