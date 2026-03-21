#!/bin/bash

# Script to check if admin user exists and seed it if needed
# Usage: ./scripts/check-and-seed-admin.sh <BACKEND_URL> [SEED_TOKEN]

set -e

BACKEND_URL="${1:-https://kweka-reach-backend-XXXXX.run.app}"
SEED_TOKEN="${2:-change-this-secret-token}"

echo "🔍 Checking admin user status..."
echo "Backend URL: $BACKEND_URL"
echo ""

# Check if admin exists
echo "1. Checking if admin user exists..."
CHECK_RESPONSE=$(curl -s "$BACKEND_URL/api/debug/admin-exists" || echo "{}")
echo "$CHECK_RESPONSE" | jq '.' || echo "$CHECK_RESPONSE"
echo ""

ADMIN_EXISTS=$(echo "$CHECK_RESPONSE" | jq -r '.data.adminExists // false' 2>/dev/null || echo "false")

if [ "$ADMIN_EXISTS" = "true" ]; then
    echo "✅ Admin user already exists!"
    echo "Email: admin@nacl.com"
    echo "Password: Admin@123"
    exit 0
fi

echo "❌ Admin user does not exist."
echo ""
echo "2. Seeding admin user..."
SEED_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/debug/seed-admin" \
    -H "Content-Type: application/json" \
    -H "x-seed-token: $SEED_TOKEN" || echo "{}")
echo "$SEED_RESPONSE" | jq '.' || echo "$SEED_RESPONSE"
echo ""

SUCCESS=$(echo "$SEED_RESPONSE" | jq -r '.success // false' 2>/dev/null || echo "false")

if [ "$SUCCESS" = "true" ]; then
    echo "✅ Admin user created successfully!"
    echo "Email: admin@nacl.com"
    echo "Password: Admin@123"
    echo ""
    echo "You can now log in with these credentials."
else
    echo "❌ Failed to seed admin user."
    echo "Please check:"
    echo "1. Backend is deployed and running"
    echo "2. SEED_TOKEN is correct (set ADMIN_SEED_TOKEN secret in GitHub or use default)"
    echo "3. Database connection is working"
    exit 1
fi
