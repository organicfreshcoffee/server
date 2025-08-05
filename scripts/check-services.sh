#!/bin/bash

# Quick GCP Services Check
# Simple script to show enabled services

echo "🔍 Currently enabled GCP services:"
echo "=================================="
gcloud services list --enabled --format="table(name,title)" --sort-by="name"

echo ""
echo "💰 Services that typically cost money:"
echo "====================================="
echo "❌ compute.googleapis.com (Compute Engine - VMs)"
echo "❌ container.googleapis.com (Google Kubernetes Engine)"
echo "❌ sql-component.googleapis.com (Cloud SQL)"
echo "❌ storage.googleapis.com (Cloud Storage)"
echo "❌ vpcaccess.googleapis.com (VPC Access Connector)"
echo ""

echo "✅ Free tier / minimal cost services for this project:"
echo "===================================================="
echo "✅ run.googleapis.com (Cloud Run)"
echo "✅ artifactregistry.googleapis.com (Artifact Registry)"
echo "✅ cloudbuild.googleapis.com (Cloud Build)"
echo "✅ iam.googleapis.com (IAM)"
echo "✅ logging.googleapis.com (Cloud Logging)"
echo "✅ monitoring.googleapis.com (Cloud Monitoring)"
echo ""

echo "🚀 To run full audit: ./scripts/audit-gcp-services.sh"
