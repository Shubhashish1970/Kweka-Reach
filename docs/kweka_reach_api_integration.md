# Kweka Reach — Outbound Voice Agent API Integration Guide

This guide provides the necessary details to integrate the Outbound AI Voice Agent trigger into the Kweka Reach platform. 

You can provide this document directly to your development team or to an AI editor like Cursor to automatically generate the integration code.

---

## 1. Overview
This API triggers an automated outbound voice call to a specified phone number. When the call connects, the AI agent uses the data provided in the `initial_context` object to personalize the conversation (e.g., greeting the user by name and mentioning specific event details).

## 2. API Endpoint Details

- **HTTP Method:** `POST`
- **URL:** `https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc`
- **Headers:**
  - `Content-Type: application/json`

## 3. Request Payload Schema

The API expects a JSON body with two main properties:
1. `phone_number`: The destination phone number in E.164 format (e.g., `+91...`).
2. `initial_context`: An object containing the dynamic variables that the AI agent will use during the call.

**Valid JSON Payload Example:**
```json
{
  "phone_number": "+919396792409",
  "initial_context": {
    "farmer_name": "Deepak",
    "agent_name": "riya",
    "village_name": "Banswada",
    "mdo_name": "raviteja",
    "event_date": "04-08-2026 19:34 PM",
    "product_name": "Atonik-growth regulator"
  }
}
```
*(Note: Ensure valid JSON formatting. A missing comma after `village_name` in early drafts has been corrected here).*

---

## 4. Instructions for Cursor / Developer

*Prompt for Cursor/Copilot: "Create a function to make a POST request to this API endpoint using the provided JSON payload structure. Handle success and error states appropriately."*

### Example 1: cURL (For Terminal Testing)
```bash
curl -X POST https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc \
-H "Content-Type: application/json" \
-d '{
  "phone_number": "+919396792409",
  "initial_context": {
    "farmer_name": "Deepak",
    "agent_name": "riya",
    "village_name": "Banswada",
    "mdo_name": "raviteja",
    "event_date": "04-08-2026 19:34 PM",
    "product_name": "Atonik-growth regulator"
  }
}'
```

### Example 2: Node.js (fetch)
```javascript
async function triggerVoiceAgent(phoneNumber, contextData) {
  const url = "https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc";
  
  const payload = {
    phone_number: phoneNumber,
    initial_context: contextData
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Voice agent triggered successfully:", data);
    return data;
  } catch (error) {
    console.error("Failed to trigger voice agent:", error);
    throw error;
  }
}

// Usage:
// triggerVoiceAgent("+919396792409", { farmer_name: "Deepak", ... });
```

### Example 3: Python (requests)
```python
import requests

def trigger_voice_agent(phone_number, context_data):
    url = "https://35.234.218.115.sslip.io/api/v1/public/agent/test/e5a72e34-d77d-46f3-8645-5bdff1e560dc"
    
    payload = {
        "phone_number": phone_number,
        "initial_context": context_data
    }
    
    headers = {
        "Content-Type": "application/json"
    }

    try:
        response = requests.post(url, json=payload, headers=headers)
        response.raise_for_status()
        print("Voice agent triggered successfully!")
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Failed to trigger voice agent: {e}")
        raise

# Usage:
# trigger_voice_agent("+919396792409", { "farmer_name": "Deepak", ... })
```

## 5. Expected Behavior
Upon a successful request (HTTP 200/202), the Kweka Reach platform should expect the voice agent system to immediately queue and initiate an outbound phone call to the provided `phone_number`. The agent will utilize the `initial_context` variables to dynamically populate its script.
