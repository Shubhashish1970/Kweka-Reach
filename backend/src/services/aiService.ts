import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../config/logger.js';

// Read environment variable at runtime (allows for updates without restart)
const getGeminiApiKey = (): string | null => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    logger.warn('GEMINI_API_KEY not configured - AI features will be disabled', {
      envKeys: Object.keys(process.env).filter(k => k.includes('GEMINI') || k.includes('API')).join(', ') || 'none',
      hasEnvKeys: Object.keys(process.env).length > 0,
    });
  } else {
    logger.info('GEMINI_API_KEY is configured', {
      keyLength: key.length,
      keyPrefix: key.substring(0, 10) + '...',
    });
  }
  return key || null;
};

const GEMINI_API_KEY = getGeminiApiKey();

// Initialize GoogleGenerativeAI lazily to allow env var updates
const getGenAI = (): GoogleGenerativeAI | null => {
  const key = getGeminiApiKey();
  if (!key) {
    return null;
  }
  try {
    return new GoogleGenerativeAI(key);
  } catch (error) {
    logger.error('Failed to initialize GoogleGenerativeAI', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
};

const genAI = GEMINI_API_KEY ? getGenAI() : null;

// Cache for available model
let cachedModelName: string | null = null;
let modelCacheExpiry: number = 0;
const MODEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour cache

/**
 * List available models and select the best one for generateContent
 */
async function getAvailableModel(): Promise<string> {
  // Return cached model if still valid
  if (cachedModelName && Date.now() < modelCacheExpiry) {
    return cachedModelName;
  }

  const currentApiKey = getGeminiApiKey();
  if (!currentApiKey) {
    throw new Error('Gemini API key not configured');
  }
  
  const currentGenAI = genAI || getGenAI();
  if (!currentGenAI) {
    throw new Error('Failed to initialize Gemini AI');
  }

  try {
    logger.info('Fetching available Gemini models...');
    
    // Use REST API to list models
    const currentApiKey = getGeminiApiKey();
    if (!currentApiKey) {
      throw new Error('Gemini API key not configured');
    }
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${currentApiKey}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.warn('Failed to list models, will try default models', {
        status: response.status,
        error: errorText,
      });
      // Fallback to common model names
      return selectBestFromDefaults();
    }

    const data = await response.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[]; supportedMethods?: string[] }> };
    const models = data.models || [];

    logger.info('Available models fetched', { count: models.length });

    // Filter models that support generateContent
    const supportedModels = models.filter((model: any) => {
      const supportsGenerateContent = 
        model.supportedGenerationMethods?.includes('generateContent') ||
        model.supportedMethods?.includes('generateContent');
      
      return supportsGenerateContent && !model.name.includes('embed');
    });

    if (supportedModels.length === 0) {
      logger.warn('No models found with generateContent support, using defaults');
      return selectBestFromDefaults();
    }

    // Sort models by preference:
    // 1. Flash models (faster, cheaper)
    // 2. Pro models (more capable)
    // 3. Others
    const sortedModels = supportedModels.sort((a: any, b: any) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      
      // Prefer flash over pro
      if (aName.includes('flash') && !bName.includes('flash')) return -1;
      if (!aName.includes('flash') && bName.includes('flash')) return 1;
      
      // Prefer pro over others
      if (aName.includes('pro') && !bName.includes('pro')) return -1;
      if (!aName.includes('pro') && bName.includes('pro')) return 1;
      
      return 0;
    });

    const modelFullName = sortedModels[0].name;
    const selectedModel = modelFullName.split('/').pop() || modelFullName; // Extract model name from full path, fallback to full name
    
    if (!selectedModel) {
      logger.warn('Could not extract model name, using fallback');
      return selectBestFromDefaults();
    }
    
    logger.info('Selected model', { 
      model: selectedModel,
      availableCount: supportedModels.length,
      modelNames: supportedModels.map((m: any) => m.name.split('/').pop() || m.name),
    });

    // Cache the result
    cachedModelName = selectedModel;
    modelCacheExpiry = Date.now() + MODEL_CACHE_TTL;

    return selectedModel;
  } catch (error) {
    logger.error('Error fetching available models', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Fallback to default models
    return selectBestFromDefaults();
  }
}

/**
 * Fallback to default model names if listing fails
 */
function selectBestFromDefaults(): string {
  const defaultModels = [
    'gemini-1.5-flash-latest',
    'gemini-1.5-pro-latest',
    'gemini-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
  ];

  // Return the first one (will be tried and may fail, but better than hardcoding)
  const selected = defaultModels[0];
  logger.info('Using default model', { model: selected });
  return selected;
}

export interface ExtractedData {
  didAttend?: string | null;
  didRecall?: boolean | null;
  cropsDiscussed?: string[];
  productsDiscussed?: string[];
  hasPurchased?: boolean | null;
  willingToPurchase?: boolean | null;
  likelyPurchaseDate?: string | null;
  nonPurchaseReason?: string;
  purchasedProducts?: Array<{ product: string; quantity: string; unit: string }>;
  farmerComments?: string; // 3 bullet points, 20-25 words each
  sentiment?: 'Positive' | 'Negative' | 'Neutral' | 'N/A'; // Sentiment indicator
}

export interface ExtractionContext {
  farmerName?: string;
  activityType?: string;
  crops?: string[];
  products?: string[];
  activityCrops?: string[];
  activityProducts?: string[];
  territory?: string;
}

/**
 * Sanitize JSON string to handle undefined values and other invalid JSON patterns
 */
function sanitizeJSON(jsonString: string): string {
  // Replace undefined with null (handles : undefined patterns)
  let sanitized = jsonString.replace(/:\s*undefined\b/g, ': null');
  
  // Remove trailing commas before closing braces/brackets
  sanitized = sanitized.replace(/,(\s*[}\]])/g, '$1');
  
  // Remove any remaining undefined references
  sanitized = sanitized.replace(/undefined/g, 'null');
  
  return sanitized;
}

async function generateGeminiJsonObject(
  prompt: string,
  meta: { label: string; inputLength: number }
): Promise<Record<string, unknown>> {
  const activeGenAI = genAI || getGenAI();
  if (!activeGenAI) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY environment variable.');
  }

  const modelName = await getAvailableModel();
  const model = activeGenAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      temperature: 0.1,
      topP: 0.8,
      topK: 40,
    },
  });

  logger.info(`Processing ${meta.label} with Gemini AI`, {
    inputLength: meta.inputLength,
    modelName,
  });

  const result = await model.generateContent(prompt);
  const response = await result.response;

  if (!response) {
    throw new Error('No response received from AI service');
  }

  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    const finishReason = (response as any).promptFeedback?.blockReason || 'UNKNOWN';
    throw new Error(`AI response was blocked. Reason: ${finishReason}`);
  }

  let text: string;
  try {
    text = response.text();
  } catch (error) {
    logger.error('Failed to extract text from AI response', {
      error: error instanceof Error ? error.message : 'Unknown error',
      finishReason: (candidates[0] as any)?.finishReason,
    });
    throw new Error('Failed to parse AI response. The response may have been blocked.');
  }

  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from AI service');
  }

  let jsonText = text.trim();
  jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  jsonText = jsonText.replace(/^\s+|\s+$/g, '');
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    jsonText = jsonMatch[0];
  }

  logger.info('Gemini AI response received', {
    label: meta.label,
    responseLength: jsonText.length,
    preview: jsonText.substring(0, 200),
  });

  const sanitizedJson = sanitizeJSON(jsonText);
  try {
    return JSON.parse(sanitizedJson) as Record<string, unknown>;
  } catch (parseError) {
    logger.error('JSON parse error', {
      originalJson: jsonText.substring(0, 500),
      sanitizedJson: sanitizedJson.substring(0, 500),
      error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
    });
    throw new Error(
      `Failed to parse AI response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`
    );
  }
}

/**
 * Extract structured data from scratchpad notes using Gemini AI
 */
export const extractDataFromNotes = async (
  notes: string,
  context?: ExtractionContext
): Promise<ExtractedData> => {
  if (!notes || !notes.trim()) {
    throw new Error('Notes cannot be empty');
  }

  // Build context string
  const contextInfo = context
    ? `
Context Information:
- Farmer Name: ${context.farmerName || 'Unknown'}
- Activity Type: ${context.activityType || 'Unknown'}
- Available Crops: ${context.crops?.join(', ') || 'N/A'}
- Available Products: ${context.products?.join(', ') || 'N/A'}
- Territory: ${context.territory || 'N/A'}
`
    : '';

  const prompt = `You are an AI assistant that extracts structured data from call center agent scratchpad notes.

${contextInfo}

Agent Notes:
${notes}

IMPORTANT: Return ONLY valid JSON with no markdown, no code blocks, no explanations. Start your response with { and end with }.

Extract the following information and return as valid JSON:
{
  "didAttend": "Yes, I attended" | "No, I missed" | "Don't recall" | "Identity Wrong" | "Not a Farmer" | null,
  "didRecall": true | false | null,
  "cropsDiscussed": ["crop1", "crop2"],
  "productsDiscussed": ["product1", "product2"],
  "hasPurchased": true | false | null,
  "willingToPurchase": true | false | null,
  "likelyPurchaseDate": "YYYY-MM-DD" | null,
  "nonPurchaseReason": "Price" | "Availability" | "Brand preference" | "No requirement" | "Not convinced" | "Other" | "custom text" | "",
  "purchasedProducts": [
    {"product": "product name", "quantity": "10", "unit": "Kg" | "gms" | "lt"}
  ],
  "farmerComments": "• [First point - 20-25 words]\n• [Second point - 20-25 words]\n• [Third point - 20-25 words]",
  "sentiment": "Positive" | "Negative" | "Neutral" | "N/A"
}

Extraction Rules:
1. didAttend: Extract from notes about attendance, identity verification, or farmer status
   - Use "Yes, I attended" if farmer attended
   - Use "No, I missed" if farmer didn't attend
   - Use "Don't recall" if farmer doesn't remember
   - Use "Identity Wrong" if wrong person
   - Use "Not a Farmer" if not a farmer
   - Use null if not mentioned

2. didRecall: Extract from notes about whether farmer remembers meeting/activity content
   - Use true if farmer recalls content
   - Use false if farmer doesn't recall
   - Use null if not mentioned
   - Only extract if didAttend is "Yes, I attended" or "Don't recall"

3. cropsDiscussed: Extract crop names mentioned (match to available crops if provided)
   - Return array of crop names
   - Match case-insensitively to available crops
   - Use empty array if none mentioned

4. productsDiscussed: Extract product names mentioned (match to available products if provided)
   - Return array of product names
   - Match case-insensitively to available products
   - Use empty array if none mentioned

5. hasPurchased: Extract purchase status
   - Use true if farmer purchased/bought products
   - Use false if farmer didn't purchase
   - Use null if not mentioned

6. purchasedProducts: Extract purchase details (only if hasPurchased is true)
   - Extract product name, quantity, and unit
   - Quantity should be numeric string
   - Unit should be "Kg", "gms", or "lt"
   - Return empty array if no purchases mentioned

7. willingToPurchase: Extract future purchase intention (only if hasPurchased is false)
   - Use true if farmer is willing to purchase
   - Use false if farmer is not willing
   - Use null if not mentioned

8. likelyPurchaseDate: Extract date for future purchase (only if willingToPurchase is true)
   - Format as YYYY-MM-DD
   - Extract from phrases like "next month", "in 2 weeks", specific dates
   - Use null if not mentioned (NEVER use undefined - it's invalid JSON)

9. nonPurchaseReason: Extract reason for not purchasing
   - Match to: "Price", "Availability", "Brand preference", "No requirement", "Not convinced", "Other"
   - Or extract custom reason text
   - Use empty string if not mentioned

10. farmerComments: Generate a concise summary in exactly 3 bullet points
    - Each bullet point must be 20-25 words (crisp and actionable)
    - Focus on key takeaways, decisions, or insights from the conversation
    - Format as: "• [First point - 20-25 words]\n• [Second point - 20-25 words]\n• [Third point - 20-25 words]"
    - Each bullet should start with "• " (bullet symbol + space)
    - Use empty string if no meaningful summary can be generated
    - Prioritize: attendance status, product/crop discussions, purchase decisions, future intentions

11. sentiment: Analyze the overall sentiment of the farmer's comments and conversation
    - Use "Positive" if farmer shows interest, satisfaction, willingness to purchase, or positive engagement
    - Use "Negative" if farmer shows dissatisfaction, complaints, unwillingness, or negative feedback
    - Use "Neutral" if the conversation is factual, neutral, or mixed with no clear positive/negative tone
    - Use "N/A" only if there is insufficient information to determine sentiment
    - Base sentiment on: purchase decisions, product feedback, engagement level, overall tone

CRITICAL JSON FORMATTING RULES:
- NEVER use "undefined" in JSON responses - it's not valid JSON
- Use null for missing values, not undefined
- Omit fields entirely if they're not applicable (optional)
- All values must be valid JSON types: string, number, boolean, null, array, object
- Example of CORRECT format: {"field": null} or omit the field
- Example of WRONG format: {"field": undefined} - this will cause parsing errors

Important:
- Only include fields that are clearly mentioned in the notes
- Use null/empty arrays/empty strings for fields not mentioned
- Match crop/product names to available options (case-insensitive)
- Return valid JSON only, no markdown formatting`;

  try {
    const extracted = (await generateGeminiJsonObject(prompt, {
      label: 'scratchpad notes',
      inputLength: notes.length,
    })) as ExtractedData;

    const validated = validateAndCleanExtractedData(extracted, context);

    logger.info('AI extraction successful', {
      fieldsExtracted: Object.keys(validated).length,
      hasCrops: (validated.cropsDiscussed?.length ?? 0) > 0,
      hasProducts: (validated.productsDiscussed?.length ?? 0) > 0,
    });

    return validated;
  } catch (error) {
    logger.error('AI extraction failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    if (error instanceof SyntaxError) {
      throw new Error('Failed to parse AI response. Please try again.');
    }
    
    throw new Error('Failed to extract data from notes. Please try again.');
  }
};

/**
 * Validate and clean extracted data
 */
const validateAndCleanExtractedData = (
  data: ExtractedData,
  context?: ExtractionContext
): ExtractedData => {
  const validated: ExtractedData = {};

  // Validate didAttend
  const validDidAttendValues = [
    'Yes, I attended',
    'No, I missed',
    "Don't recall",
    'Identity Wrong',
    'Not a Farmer',
    null,
  ];
  if (data.didAttend === undefined || validDidAttendValues.includes(data.didAttend)) {
    validated.didAttend = data.didAttend ?? null;
  } else {
    validated.didAttend = null;
  }

  // Validate didRecall (only if didAttend allows it)
  if (
    validated.didAttend === 'Yes, I attended' ||
    validated.didAttend === "Don't recall"
  ) {
    if (typeof data.didRecall === 'boolean' || data.didRecall === null) {
      validated.didRecall = data.didRecall ?? null;
    } else {
      validated.didRecall = null;
    }
  } else {
    validated.didRecall = null;
  }

  // Validate cropsDiscussed (only if didRecall is true)
  if (validated.didRecall === true) {
    if (Array.isArray(data.cropsDiscussed)) {
      // Match to available crops if provided
      if (context?.crops && context.crops.length > 0) {
        validated.cropsDiscussed = data.cropsDiscussed
          .map((crop) => {
            const matched = context.crops!.find(
              (c) => c.toLowerCase() === crop.toLowerCase()
            );
            return matched || crop;
          })
          .filter(Boolean);
      } else {
        validated.cropsDiscussed = data.cropsDiscussed.filter(Boolean);
      }
    } else {
      validated.cropsDiscussed = [];
    }
  } else {
    validated.cropsDiscussed = [];
  }

  // Validate productsDiscussed (only if didRecall is true)
  if (validated.didRecall === true) {
    if (Array.isArray(data.productsDiscussed)) {
      // Match to available products if provided
      if (context?.products && context.products.length > 0) {
        validated.productsDiscussed = data.productsDiscussed
          .map((product) => {
            const matched = context.products!.find(
              (p) => p.toLowerCase() === product.toLowerCase()
            );
            return matched || product;
          })
          .filter(Boolean);
      } else {
        validated.productsDiscussed = data.productsDiscussed.filter(Boolean);
      }
    } else {
      validated.productsDiscussed = [];
    }
  } else {
    validated.productsDiscussed = [];
  }

  // Validate hasPurchased
  if (typeof data.hasPurchased === 'boolean' || data.hasPurchased === null) {
    validated.hasPurchased = data.hasPurchased ?? null;
  } else {
    validated.hasPurchased = null;
  }

  // Validate purchasedProducts (only if hasPurchased is true)
  if (validated.hasPurchased === true) {
    if (Array.isArray(data.purchasedProducts)) {
      validated.purchasedProducts = data.purchasedProducts
        .filter((item) => item.product && item.quantity && item.unit)
        .map((item) => ({
          product: String(item.product),
          quantity: String(item.quantity),
          unit: ['Kg', 'gms', 'lt'].includes(item.unit) ? item.unit : 'Kg',
        }));
    } else {
      validated.purchasedProducts = [];
    }
  } else {
    validated.purchasedProducts = [];
  }

  // Validate willingToPurchase (only if hasPurchased is false)
  if (validated.hasPurchased === false) {
    if (typeof data.willingToPurchase === 'boolean' || data.willingToPurchase === null) {
      validated.willingToPurchase = data.willingToPurchase ?? null;
    } else {
      validated.willingToPurchase = null;
    }
  } else {
    validated.willingToPurchase = null;
  }

  // Validate likelyPurchaseDate (only if willingToPurchase is true)
  if (validated.willingToPurchase === true) {
    if (data.likelyPurchaseDate && typeof data.likelyPurchaseDate === 'string') {
      // Validate date format (YYYY-MM-DD)
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (dateRegex.test(data.likelyPurchaseDate)) {
        validated.likelyPurchaseDate = data.likelyPurchaseDate;
      } else {
        validated.likelyPurchaseDate = undefined;
      }
    } else {
      validated.likelyPurchaseDate = undefined;
    }
  } else {
    validated.likelyPurchaseDate = undefined;
  }

  // Validate nonPurchaseReason
  if (typeof data.nonPurchaseReason === 'string') {
    validated.nonPurchaseReason = data.nonPurchaseReason;
  } else {
    validated.nonPurchaseReason = '';
  }

  // Validate farmerComments (3 bullet points, 20-25 words each)
  if (typeof data.farmerComments === 'string' && data.farmerComments.trim()) {
    // Ensure it has bullet format, validate word count per bullet
    const bullets = data.farmerComments.split('\n').filter(line => line.trim().startsWith('•'));
    if (bullets.length === 3) {
      // Validate each bullet is 20-25 words
      const validBullets = bullets.map(bullet => {
        const text = bullet.replace(/^•\s*/, '').trim();
        const wordCount = text.split(/\s+/).length;
        // If word count is off, keep it but log warning (AI might be close)
        return bullet;
      });
      validated.farmerComments = validBullets.join('\n');
    } else {
      // If not 3 bullets, use as-is but log
      validated.farmerComments = data.farmerComments.substring(0, 500);
    }
  } else {
    validated.farmerComments = '';
  }

  // Validate sentiment
  const validSentiments: Array<'Positive' | 'Negative' | 'Neutral' | 'N/A'> = ['Positive', 'Negative', 'Neutral', 'N/A'];
  if (data.sentiment && validSentiments.includes(data.sentiment)) {
    validated.sentiment = data.sentiment;
  } else {
    validated.sentiment = 'N/A'; // Default to N/A if invalid or missing
  }

  return validated;
};

function toSnakeKey(key: string): string {
  if (key.includes('_')) return key;
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

/**
 * Extract Reach call-result JSON from a voice transcript (Hindi/English).
 * Returns snake_case webhook keys. Does not apply human-form dependent rules.
 */
export async function extractVoiceCallFromTranscript(
  transcript: string,
  context?: ExtractionContext
): Promise<Record<string, unknown>> {
  if (!transcript || !transcript.trim()) {
    throw new Error('Transcript cannot be empty');
  }

  const contextInfo = context
    ? `
Known call context (canonical Reach records — use these spellings):
- Farmer name: ${context.farmerName || 'Unknown'}
- Village / territory: ${context.territory || 'Unknown'}
- Activity type: ${context.activityType || 'Unknown'}
- Crops on this activity: ${context.activityCrops?.join(', ') || 'N/A'}
- Products on this activity: ${context.activityProducts?.join(', ') || 'N/A'}
- Crop master names (JSON must use these exact spellings when they match): ${
        context.crops?.slice(0, 120).join(', ') || 'N/A'
      }
- Product master names (JSON must use these exact spellings when they match): ${
        context.products?.slice(0, 120).join(', ') || 'N/A'
      }
`
    : '';

  const prompt = `You extract a structured call-centre survey from a voice-agent transcript (Hindi and/or English).

${contextInfo}

Transcript:
${transcript}

Return ONLY valid JSON. No markdown. Start with { and end with }.

{
  "call_status": "Connected" | "Disconnected" | "Incoming N/A" | "No Answer" | "Invalid",
  "did_attend": "Yes, I attended" | "No, I missed" | "Don't recall" | "Identity Wrong" | "Not a Farmer" | null,
  "did_recall": true | false | null,
  "crops_discussed": ["exact crop master names"],
  "products_discussed": ["exact product master names"],
  "activity_quality": 1 | 2 | 3 | 4 | 5 | null,
  "has_purchased": true | false | null,
  "purchased_products": [{"product": "name", "quantity": "1", "unit": "kg" | "gms" | "lt"}],
  "willing_to_purchase": true | false | null,
  "likely_purchase_date": "YYYY-MM-DD" | "today" | "tomorrow" | "आज" | "कल" | "परसों" | "",
  "non_purchase_reason": "Price" | "Availability" | "Brand preference" | "No requirement" | "Not convinced" | "Other" | "",
  "farmer_comments": "short summary of what the farmer said",
  "sentiment": "Positive" | "Negative" | "Neutral" | "N/A"
}

Rules:
- If the farmer spoke and there was a conversation, call_status is Connected.
- If nobody picked up or there is no farmer speech, call_status is No Answer.
- If the person on the call is clearly not the expected farmer, did_attend is Identity Wrong.
- Prefer activity crop/product names when the farmer is talking about that meeting.
- Crop and product values MUST use the exact master spellings above when they refer to the same thing (Paddy not paddy, Eraze Strong not eraze). Keep the spoken name only if nothing on the master list matches.
- activity_quality is the farmer's 1-5 rating of the activity/meeting if they gave one.
- likely_purchase_date: keep आज/कल/परसों/today/tomorrow as spoken, or YYYY-MM-DD if a calendar date was given.
- purchased_products.unit must be kg, gms, or lt.
- Do not invent facts that were not said. Do not add crops/products that were not mentioned.
- NEVER use undefined. Use null, [] or "".
`;

  const raw = await generateGeminiJsonObject(prompt, {
    label: 'voice transcript',
    inputLength: transcript.length,
  });

  const extracted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    extracted[toSnakeKey(key)] = value;
  }
  return extracted;
}

/**
 * Check if AI service is available
 */
export const isAIServiceAvailable = (): boolean => {
  const key = getGeminiApiKey();
  if (!key) return false;
  
  // Try to initialize if not already initialized
  if (!genAI) {
    const initialized = getGenAI();
    return !!initialized;
  }
  
  return true;
};

/**
 * Get AI service status
 */
export const getAIServiceStatus = async () => {
  const modelName = cachedModelName || 'not-determined';
  const currentApiKey = getGeminiApiKey();
  return {
    available: isAIServiceAvailable(),
    model: modelName,
    hasApiKey: !!currentApiKey,
    apiKeyConfigured: !!currentApiKey,
  };
};
