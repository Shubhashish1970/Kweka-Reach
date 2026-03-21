#!/bin/bash
# Script to infer which database the deployed backend is using
# by testing login and checking error messages
# Updated: Fixed backend URL to correct Cloud Run endpoint

echo "🔍 Checking Deployed Backend Database"
echo "======================================"
echo ""

# Set to your live Cloud Run URL, e.g. from: gcloud run services describe kweka-reach-backend --format='value(status.url)'
BACKEND_URL="${BACKEND_URL:-https://YOUR-KWEKA-REACH-BACKEND.run.app}"

echo "Testing login endpoint..."
echo ""

# Test login with correct credentials
RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"shubhashish@intelliagri.in","password":"Admin@123"}' \
  -w "\n%{http_code}")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response: $BODY"
echo ""

if [ "$HTTP_CODE" = "401" ]; then
  if echo "$BODY" | grep -qi "not found\|user not found"; then
    echo "❌ Error: User not found"
    echo "   → Backend is likely connecting to 'test' or empty database"
    echo "   → GitHub secret MONGODB_URI probably points to wrong database"
  elif echo "$BODY" | grep -qi "invalid credentials\|password"; then
    echo "❌ Error: Invalid credentials"
    echo "   → Most likely: Backend is connecting to 'test' database (0 users)"
    echo "   → User 'shubhashish@intelliagri.in' doesn't exist in 'test' database"
    echo "   → GitHub secret MONGODB_URI probably points to 'test' instead of 'Kweka_Call_Centre'"
    echo ""
    echo "   ✅ Solution: Update GitHub secret MONGODB_URI to use 'Kweka_Call_Centre' database"
  else
    echo "❌ Error: Authentication failed"
    echo "   → Check backend logs for details"
  fi
elif [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Login successful!"
  echo "   → Backend is connecting to correct database (Kweka_Call_Centre)"
elif [ "$HTTP_CODE" = "404" ]; then
  echo "❌ Error: Endpoint not found"
  echo "   → Backend might not be deployed or URL is wrong"
else
  echo "⚠️  Unexpected response: $HTTP_CODE"
fi

echo ""
echo "======================================"
echo ""
echo "📝 To fix:"
echo "1. Go to: https://github.com/Shubhashish1970/CC-EMS/settings/secrets/actions"
echo "2. Check MONGODB_URI secret"
echo "3. Ensure database name is: Kweka_Call_Centre"
echo "4. Update if needed and redeploy"
