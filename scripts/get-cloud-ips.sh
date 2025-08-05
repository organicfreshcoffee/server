#!/bin/bash

# Script to get Google Cloud IP ranges for MongoDB Atlas whitelist
# This helps you configure MongoDB Atlas network access for Cloud Run

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

REGION="us-central1"

print_header() {
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}  Google Cloud IP Ranges for MongoDB${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

get_region_ips() {
    print_step "Getting IP ranges for region: $REGION"
    echo ""
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Using basic parsing..."
        curl -s https://www.gstatic.com/ipranges/cloud.json | grep -A2 -B2 "$REGION" | grep "ipv4Prefix" | cut -d'"' -f4 | sort -u
    else
        echo -e "${YELLOW}IP ranges for $REGION:${NC}"
        curl -s https://www.gstatic.com/ipranges/cloud.json | jq -r ".prefixes[] | select(.scope==\"$REGION\") | .ipv4Prefix" | sort -u
    fi
}

get_all_google_ips() {
    print_step "Getting all Google Cloud IP ranges..."
    echo ""
    print_warning "This is a large list! Consider using region-specific ranges instead."
    echo ""
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Using basic parsing..."
        curl -s https://www.gstatic.com/ipranges/cloud.json | grep "ipv4Prefix" | cut -d'"' -f4 | sort -u
    else
        echo -e "${YELLOW}All Google Cloud IP ranges:${NC}"
        curl -s https://www.gstatic.com/ipranges/cloud.json | jq -r '.prefixes[].ipv4Prefix' | sort -u
    fi
}

test_current_ip() {
    print_step "Checking your static IP configuration..."
    echo ""
    
    # Check if VPC setup was done (look for static IP)
    if command -v gcloud &> /dev/null; then
        STATIC_IP=$(gcloud compute addresses describe game-static-ip --region=$REGION --format='value(address)' 2>/dev/null || echo "")
        
        if [ -n "$STATIC_IP" ]; then
            echo -e "${GREEN}✅ VPC Static IP found:${NC} $STATIC_IP"
            echo -e "${YELLOW}Use this IP for MongoDB Atlas:${NC} $STATIC_IP/32"
            echo ""
            
            # Check if VPC connector exists
            if gcloud compute networks vpc-access connectors describe game-connector --region=$REGION &>/dev/null; then
                echo -e "${GREEN}✅ VPC Connector found:${NC} game-connector"
            else
                echo -e "${RED}❌ VPC Connector not found${NC}"
                echo "Run: ./scripts/setup-vpc.sh to create it"
            fi
            
            # Check if Cloud Run service is using VPC
            SERVICE_VPC=$(gcloud run services describe organicfreshcoffee-game-server --region=$REGION --format='value(spec.template.metadata.annotations."run.googleapis.com/vpc-access-connector")' 2>/dev/null || echo "")
            if [ -n "$SERVICE_VPC" ]; then
                echo -e "${GREEN}✅ Cloud Run service using VPC:${NC} $SERVICE_VPC"
            else
                echo -e "${YELLOW}⚠️  Cloud Run service not using VPC yet${NC}"
                echo "Deploy your service to apply VPC configuration"
            fi
        else
            echo -e "${YELLOW}⚠️  No static IP found${NC}"
            echo "Run: ./scripts/setup-vpc.sh to create VPC with static IP"
            echo ""
            
            # Fall back to showing service URL
            SERVICE_URL=$(gcloud run services describe organicfreshcoffee-game-server --region=$REGION --format='value(status.url)' 2>/dev/null || echo "")
            if [ -n "$SERVICE_URL" ]; then
                echo -e "${YELLOW}Your service URL:${NC} $SERVICE_URL"
                echo ""
                echo "Currently using dynamic Google Cloud IPs (see ranges above)"
            fi
        fi
    else
        print_warning "gcloud CLI not found. Cannot check static IP status."
    fi
}

print_mongodb_instructions() {
    print_step "MongoDB Atlas Configuration Instructions"
    echo ""
    
    # Check if static IP exists
    STATIC_IP=$(gcloud compute addresses describe game-static-ip --region=$REGION --format='value(address)' 2>/dev/null || echo "")
    
    if [ -n "$STATIC_IP" ]; then
        echo -e "${GREEN}🎯 You have a static IP! Use this for MongoDB Atlas:${NC}"
        echo "=================================================="
        echo -e "${YELLOW}IP Address to whitelist: $STATIC_IP/32${NC}"
        echo ""
        echo "Steps:"
        echo "1. Go to https://cloud.mongodb.com/"
        echo "2. Select your cluster"
        echo "3. Go to 'Network Access'"
        echo "4. Click 'Add IP Address'"
        echo "5. Enter: $STATIC_IP/32"
        echo "6. Comment: Cloud Run static IP"
        echo ""
        echo -e "${GREEN}✅ This is the most secure option!${NC}"
    else
        echo -e "${YELLOW}To configure MongoDB Atlas (no static IP detected):${NC}"
        echo "=================================================="
        echo "1. Go to https://cloud.mongodb.com/"
        echo "2. Select your cluster"
        echo "3. Go to 'Network Access' in the left sidebar"
        echo "4. Click 'Add IP Address'"
        echo "5. Choose one of these options:"
        echo ""
        echo -e "${GREEN}Option 1 (Simplest):${NC}"
        echo "   - IP Address: 0.0.0.0/0"
        echo "   - Comment: Allow access from anywhere"
        echo ""
        echo -e "${GREEN}Option 2 (More Secure):${NC}"
        echo "   - Add each IP range from the list above"
        echo "   - Comment: Google Cloud us-central1 ranges"
        echo ""
        echo -e "${GREEN}Option 3 (Most Secure):${NC}"
        echo "   - Run: ./scripts/setup-vpc.sh first"
        echo "   - Then use the static IP it creates"
        echo ""
        echo -e "${BLUE}Recommendation:${NC} Run ./scripts/setup-vpc.sh for maximum security"
    fi
}

install_jq_instructions() {
    print_step "Installing jq for better JSON parsing"
    echo ""
    echo "To install jq:"
    echo "- macOS: brew install jq"
    echo "- Ubuntu/Debian: sudo apt-get install jq"
    echo "- CentOS/RHEL: sudo yum install jq"
    echo "- Or download from: https://stedolan.github.io/jq/download/"
}

# Main execution
main() {
    print_header
    
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        install_jq_instructions
        echo ""
    fi
    
    get_region_ips
    echo ""
    
    read -p "Do you want to see ALL Google Cloud IP ranges? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        get_all_google_ips
        echo ""
    fi
    
    test_current_ip
    echo ""
    
    print_mongodb_instructions
}

# Run main function
main "$@"
