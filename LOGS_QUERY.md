# Cloud Run Logs Query for Email Issues

## Direct Link to Logs Explorer
https://console.cloud.google.com/logs/query?project=cc-ems-dev

## Query to Use (Fixed Syntax)
```
resource.type="cloud_run_revision" 
AND resource.labels.service_name="kweka-reach-backend" 
AND (textPayload=~"email" OR textPayload=~"Resend" OR jsonPayload.message=~"email" OR jsonPayload.message=~"Resend")
```

**Note:** The emoji search might not work. Use this simpler version if needed:
```
resource.type="cloud_run_revision" 
AND resource.labels.service_name="kweka-reach-backend" 
AND (textPayload=~"email" OR textPayload=~"Resend" OR jsonPayload.message=~"email")
```

## Time Range
- Set to: **Last 2 hours**

## What to Look For

### Success Indicators:
- "📧 Attempting to send email via Resend"
- "✅ Email sent successfully via Resend"
- `id` field showing email ID

### Error Indicators:
- "❌ Resend API error"
- "❌ Resend API failed"
- Error messages with details

### Important Information to Check:
1. **Is RESEND_KEY present?**
   - Look for: `apiKeyPresent: true` or `apiKeyPresent: false`
   - If false, RESEND_KEY is not set in environment variables

2. **FROM email address:**
   - Check what email is being used as sender
   - Must be a verified domain in Resend or `onboarding@resend.dev`

3. **Error messages:**
   - Copy the full error message
   - Check if it's an API key issue, domain verification, or other error

## Common Errors

### Error: "Unauthorized" or "Invalid API key"
- **Fix**: Verify RESEND_KEY is correct in GitHub Secrets

### Error: "Domain not verified"
- **Fix**: Use `onboarding@resend.dev` as FROM email, or verify your domain in Resend

### Error: "apiKeyPresent: false"
- **Fix**: RESEND_KEY not set - add it to GitHub Secrets

## Alternative: Use This Query for Errors Only
```
resource.type="cloud_run_revision" 
AND resource.labels.service_name="kweka-reach-backend" 
AND severity>=ERROR
AND (textPayload=~"email" OR textPayload=~"Resend" OR jsonPayload.message=~"email" OR jsonPayload.message=~"Resend")
```
