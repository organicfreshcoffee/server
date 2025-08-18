#!/bin/bash

# Custom Domain Setup Script for Cloud Run
# This script helps set up a custom domain for your Cloud Run service
# Usage: ./setup-domain.sh [staging|production]

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
    DOMAIN="staging-server.organicfreshcoffee.com"
else
    SERVICE_NAME="organicfreshcoffee-game-server"
    DOMAIN="server.organicfreshcoffee.com"
fi

print_header() {
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  Custom Domain Setup for Cloud Run${NC}"
    echo -e "${BLUE}  Environment: ${ENVIRONMENT}${NC}"
    echo -e "${BLUE}  Domain: ${DOMAIN}${NC}"
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
    CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")
    if [ -n "$CURRENT_PROJECT" ]; then
        PROJECT_ID=$CURRENT_PROJECT
        print_info "Using project: $PROJECT_ID"
    else
        read -p "Enter your GCP Project ID: " PROJECT_ID
        gcloud config set project $PROJECT_ID
    fi
}

verify_service_exists() {
    print_step "Verifying Cloud Run service exists..."
    
    if gcloud run services describe $SERVICE_NAME --region=$REGION &>/dev/null; then
        print_info "Cloud Run service '$SERVICE_NAME' found in region '$REGION'"
        
        # Get the current service URL
        SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region=$REGION --format='value(status.url)')
        print_info "Current service URL: $SERVICE_URL"
    else
        print_error "Cloud Run service '$SERVICE_NAME' not found in region '$REGION'"
        print_error "Please deploy your service first using the GitHub Actions workflow"
        exit 1
    fi
}

verify_domain_ownership() {
    print_step "Checking domain ownership..."
    
    print_info "Make sure you own the domain '$DOMAIN'"
    print_info "You should have purchased 'organicfreshcoffee.com' through Google Domains or another registrar"
    
    read -p "Do you own the domain 'organicfreshcoffee.com'? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "You must own the domain to continue"
        exit 1
    fi
}

create_domain_mapping() {
    print_step "Creating domain mapping for Cloud Run..."
    
    # Check if domain mapping already exists
    if gcloud beta run domain-mappings describe $DOMAIN --region=$REGION &>/dev/null; then
        print_warning "Domain mapping for '$DOMAIN' already exists"
        print_info "Current mapping:"
        gcloud beta run domain-mappings describe $DOMAIN --region=$REGION --format="table(spec.routePolicy.traffic)"
    else
        print_info "Creating domain mapping for '$DOMAIN'..."
        gcloud beta run domain-mappings create \
            --service=$SERVICE_NAME \
            --domain=$DOMAIN \
            --region=$REGION
        
        print_info "Domain mapping created successfully!"
    fi
}

get_dns_records() {
    print_step "Getting DNS records to configure..."
    
    print_info "Fetching required DNS records..."
    
    # Get the domain mapping details
    DNS_RECORDS=$(gcloud beta run domain-mappings describe $DOMAIN --region=$REGION --format="value(status.resourceRecords[].name,status.resourceRecords[].rrdata)" 2>/dev/null || echo "")
    
    if [ -n "$DNS_RECORDS" ]; then
        print_info "DNS records retrieved successfully!"
        echo ""
        echo -e "${YELLOW}DNS Records to configure:${NC}"
        echo "========================="
        
        # Parse and display DNS records
        echo "$DNS_RECORDS" | while IFS=$'\t' read -r name rrdata; do
            if [ -n "$name" ] && [ -n "$rrdata" ]; then
                echo "Name: $name"
                echo "Type: CNAME"
                echo "Value: $rrdata"
                echo "TTL: 300"
                echo "---"
            fi
        done
    else
        print_warning "Could not retrieve DNS records automatically"
        print_info "You can get them manually with:"
        echo "gcloud beta run domain-mappings describe $DOMAIN --region=$REGION"
    fi
}

configure_google_domains() {
    print_step "Instructions for configuring Google Domains..."
    
    echo ""
    echo -e "${YELLOW}To configure DNS in Google Domains:${NC}"
    echo "===================================="
    echo "1. Go to https://domains.google.com"
    echo "2. Find your domain 'organicfreshcoffee.com'"
    echo "3. Click on it and go to 'DNS' tab"
    echo "4. Scroll down to 'Custom records'"
    echo "5. Add a new CNAME record:"
    
    # Extract subdomain from full domain
    SUBDOMAIN=$(echo "$DOMAIN" | sed 's/\.organicfreshcoffee\.com$//')
    
    echo "   - Host name: $SUBDOMAIN"
    echo "   - Type: CNAME"
    echo "   - TTL: 300"
    echo "   - Data: [The CNAME value shown above]"
    echo "6. Save the changes"
    echo ""
    echo -e "${BLUE}Note:${NC} DNS propagation can take up to 48 hours, but usually takes 5-10 minutes"
}

test_domain_setup() {
    print_step "Testing domain setup..."
    
    echo ""
    print_info "Once DNS propagation is complete, test your setup:"
    echo "1. Health check: https://$DOMAIN/health"
    echo "2. WebSocket: wss://$DOMAIN/game"
    echo "3. Main endpoint: https://$DOMAIN/"
    echo ""
    print_info "You can check DNS propagation with:"
    echo "nslookup $DOMAIN"
    echo "dig $DOMAIN"
}

update_cors_configuration() {
    print_step "Updating CORS configuration..."
    
    print_warning "Remember to update your application's CORS configuration"
    print_info "Add 'https://$DOMAIN' to your allowed origins"
    print_info "Update your CLIENT_URL environment variable if needed"
}

print_next_steps() {
    print_step "Next steps and summary..."
    
    echo ""
    echo -e "${GREEN}Summary:${NC}"
    echo "========"
    echo "✅ Domain mapping created for: $DOMAIN"
    echo "✅ DNS records retrieved"
    echo "✅ Configuration instructions provided"
    echo ""
    echo -e "${YELLOW}What you need to do next:${NC}"
    echo "========================="
    echo "1. Configure DNS records in Google Domains (instructions above)"
    echo "2. Wait for DNS propagation (5-10 minutes usually)"
    echo "3. Test the domain: https://$DOMAIN/health"
    echo "4. Update your GitHub secrets if needed:"
    echo "   - Update CLIENT_URL to use your new domain"
    echo "   - Update any hardcoded URLs in your application"
    echo "5. Redeploy if you made configuration changes"
    echo ""
    echo -e "${BLUE}Useful commands:${NC}"
    echo "================"
    echo "# Check domain mapping status"
    echo "gcloud beta run domain-mappings describe $DOMAIN --region=$REGION"
    echo ""
    echo "# Check DNS resolution"
    echo "nslookup $DOMAIN"
    echo ""
    echo "# Test SSL certificate (after DNS propagation)"
    echo "curl -I https://$DOMAIN/health"
    echo ""
    echo -e "${GREEN}🎉 Your service will be available at: https://$DOMAIN${NC}"
}

# Main execution
main() {
    print_header
    check_prerequisites
    get_project_id
    verify_service_exists
    verify_domain_ownership
    create_domain_mapping
    get_dns_records
    configure_google_domains
    test_domain_setup
    update_cors_configuration
    print_next_steps
}

# Run main function
main "$@"
