import { describe, expect, test, afterEach, jest } from '@jest/globals';
import { buildVoiceTriggerUrl } from '../../src/services/voiceApiClient.js';
import {
  mapVoiceWebhookToSubmitInput,
  ingestVoiceWebhookCallResult,
  hasStructuredCallResult,
} from '../../src/services/voiceAgentService.js';
import { flattenTranscriptArtifact } from '../../src/services/voiceTranscriptFallback.js';
import { toIndianE164 } from '../../src/services/voiceApiClient.js';

describe('voice integration helpers', () => {
  const originalBase = process.env.VOICE_API_BASE_URL;
  const originalTest = process.env.VOICE_USE_TEST_ENDPOINT;

  afterEach(() => {
    if (originalBase === undefined) delete process.env.VOICE_API_BASE_URL;
    else process.env.VOICE_API_BASE_URL = originalBase;
    if (originalTest === undefined) delete process.env.VOICE_USE_TEST_ENDPOINT;
    else process.env.VOICE_USE_TEST_ENDPOINT = originalTest;
  });

  test('toIndianE164 formats 10-digit mobile', () => {
    expect(toIndianE164('9396792409')).toBe('+919396792409');
  });

  test('buildVoiceTriggerUrl uses test path by default', () => {
    process.env.VOICE_API_BASE_URL = 'https://voice.example.com';
    delete process.env.VOICE_USE_TEST_ENDPOINT;
    expect(buildVoiceTriggerUrl('uuid-1')).toBe('https://voice.example.com/api/v1/public/agent/test/uuid-1');
  });

  test('buildVoiceTriggerUrl uses workflow path when configured', () => {
    process.env.VOICE_API_BASE_URL = 'https://voice.example.com';
    expect(buildVoiceTriggerUrl('uuid-1', { triggerRouteType: 'workflow' })).toBe(
      'https://voice.example.com/api/v1/public/agent/workflow/uuid-1'
    );
  });

  test('buildVoiceTriggerUrl respects useTestEndpoint from options', () => {
    process.env.VOICE_API_BASE_URL = 'https://voice.example.com';
    expect(buildVoiceTriggerUrl('uuid-1', { useTestEndpoint: false })).toBe(
      'https://voice.example.com/api/v1/public/agent/uuid-1'
    );
  });

  test('mapVoiceWebhookToSubmitInput maps connected survey fields', () => {
    const input = mapVoiceWebhookToSubmitInput({
      call_status: 'Connected',
      call_duration_seconds: 120,
      did_attend: 'Yes, I attended',
      did_recall: 'true',
      crops_discussed: ['Paddy'],
      sentiment: 'Positive',
      farmer_comments: 'Happy with product',
      recording_url: 'https://cdn.example.com/rec.mp3',
      transcript_url: 'https://cdn.example.com/tr.txt',
    });

    expect(input.callStatus).toBe('Connected');
    expect(input.callDurationSeconds).toBe(120);
    expect(input.didAttend).toBe('Yes, I attended');
    expect(input.didRecall).toBe(true);
    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.sentiment).toBe('Positive');
    expect(input.farmerComments).toBe('Happy with product');
    expect(input.recordingUrl).toBe('https://cdn.example.com/rec.mp3');
    expect(input.transcriptUrl).toBe('https://cdn.example.com/tr.txt');
  });

  test('unresolved Dograh templates are treated as empty', () => {
    const input = mapVoiceWebhookToSubmitInput({
      call_status: '{{gathered_context.call_status}}',
      call_duration_seconds: '{{cost_info.call_duration_seconds}}',
      did_attend: '{{gathered_context.did_attend}}',
      crops_discussed: '{{gathered_context.crops_discussed}}',
      voice_recording_url: '{{recording_url}}',
      transcript_url: '{{transcript_url}}',
    });
    expect(input.callStatus).toBe('No Answer');
    expect(input.callDurationSeconds).toBe(0);
    expect(input.didAttend).toBeNull();
    expect(input.cropsDiscussed).toEqual([]);
    expect(input.recordingUrl).toBeUndefined();
    expect(input.transcriptUrl).toBeUndefined();
  });

  test('mapVoiceWebhookToSubmitInput accepts voice_recording_url', () => {
    const input = mapVoiceWebhookToSubmitInput({
      call_status: 'No Answer',
      voice_recording_url: 'https://voice.example.com/runs/438/recording.wav',
      transcript_url: 'https://voice.example.com/runs/438/transcript.json',
    });
    expect(input.recordingUrl).toBe('https://voice.example.com/runs/438/recording.wav');
    expect(input.transcriptUrl).toBe('https://voice.example.com/runs/438/transcript.json');
  });

  test('mapVoiceWebhookToSubmitInput maps no-answer telephony status', () => {
    const input = mapVoiceWebhookToSubmitInput({
      telephony_status: 'no-answer',
    });
    expect(input.callStatus).toBe('No Answer');
  });

  const masters = {
    crops: ['Paddy', 'Cotton'],
    products: ['Eraze Strong', 'Oscar'],
    nonPurchaseReasons: ['Price', 'No requirement', 'Availability'],
    sentiments: ['Positive', 'Negative', 'Neutral', 'N/A'],
  };

  test('common JSON: No Answer drops survey fields even if Dograh sent them', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        task_id: 'abc',
        attempt_id: 'att-1',
        call_status: 'No Answer',
        call_duration_seconds: 12,
        did_attend: 'Yes, I attended',
        did_recall: true,
        crops_discussed: ['Paddy'],
        products_discussed: ['Oscar'],
        has_purchased: true,
        purchased_products: [{ product: 'Oscar', quantity: '1', unit: 'kg' }],
        farmer_comments: 'should be ignored',
        sentiment: 'Positive',
        recording_url: 'https://cdn.example.com/rec.mp3',
      },
      masters
    );

    expect(input).toMatchObject({
      callStatus: 'No Answer',
      callDurationSeconds: 12,
      didAttend: null,
      didRecall: null,
      cropsDiscussed: [],
      productsDiscussed: [],
      hasPurchased: null,
      purchasedProducts: [],
      farmerComments: '',
      sentiment: 'N/A',
      recordingUrl: 'https://cdn.example.com/rec.mp3',
    });
  });

  test('common JSON: ingestion matches masters and purchased products', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        call_status: 'Connected',
        call_duration_seconds: 62,
        did_attend: 'Yes, I attended',
        did_recall: true,
        crops_discussed: ['paddy', 'Soyabean'],
        products_discussed: ['ERAZE STRONG'],
        activity_quality: 4,
        has_purchased: true,
        purchased_products: [{ product: 'eraze strong', quantity: '1', unit: 'Kg' }],
        willing_to_purchase: true,
        likely_purchase_date: '2026-10-01',
        non_purchase_reason: 'Price',
        farmer_comments: 'Confirmed purchase',
        sentiment: 'positive',
      },
      masters
    );

    expect(input.callStatus).toBe('Connected');
    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.productsDiscussed).toEqual(['Eraze Strong']);
    expect(input.purchasedProducts).toEqual([{ product: 'Eraze Strong', quantity: '1', unit: 'kg' }]);
    expect(input.hasPurchased).toBe(true);
    expect(input.willingToPurchase).toBeNull();
    expect(input.likelyPurchaseDate).toBe('');
    expect(input.nonPurchaseReason).toBe('');
    expect(input.activityQuality).toBe(4);
    expect(input.sentiment).toBe('Positive');
  });

  test('common JSON: nested call_result is accepted', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        task_id: 'abc',
        call_result: {
          call_status: 'Invalid',
          did_attend: 'Yes, I attended',
          crops_discussed: ['Paddy'],
        },
      },
      masters
    );
    expect(input.callStatus).toBe('Invalid');
    expect(input.didAttend).toBeNull();
    expect(input.cropsDiscussed).toEqual([]);
  });

  test('common JSON: no-purchase path keeps master reason', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
        did_recall: true,
        crops_discussed: ['Cotton'],
        has_purchased: false,
        willing_to_purchase: false,
        non_purchase_reason: 'no requirement',
        purchased_products: [{ product: 'Oscar', quantity: '2', unit: 'kg' }],
      },
      masters
    );
    expect(input.hasPurchased).toBe(false);
    expect(input.purchasedProducts).toEqual([]);
    expect(input.nonPurchaseReason).toBe('No requirement');
    expect(input.cropsDiscussed).toEqual(['Cotton']);
  });

  test('Riya transcript: infers recall, relative date, and unmatched product note', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        call_status: 'Connected',
        call_duration_seconds: 86,
        did_attend: 'Yes, I attended',
        products_discussed: ['BELLOW'],
        activity_quality: 4,
        willing_to_purchase: true,
        likely_purchase_date: 'कल',
        farmer_comments: 'Helps to grow the crop.',
        sentiment: 'Positive',
        call_ended_at: '2026-09-05T11:16:27.000Z',
      },
      masters
    );

    expect(input.didRecall).toBe(true);
    expect(input.hasPurchased).toBe(false);
    expect(input.willingToPurchase).toBe(true);
    expect(input.likelyPurchaseDate).toBe('2026-09-06');
    expect(input.activityQuality).toBe(4);
    expect(input.productsDiscussed).toEqual([]);
    expect(input.farmerComments).toContain('Helps to grow the crop.');
    expect(input.farmerComments).toContain('Also mentioned: BELLOW');
    expect(input.sentiment).toBe('Positive');
  });

  test('activity product on our data is stored, not dumped into comments', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
        products_discussed: ['bellow'],
        farmer_comments: 'Helps to grow the crop.',
      },
      masters,
      { activityProducts: ['BELLOW'] }
    );
    expect(input.productsDiscussed).toEqual(['BELLOW']);
    expect(input.farmerComments).toBe('Helps to grow the crop.');
  });

  test('canonicalizes spoken crop and product names onto masters', () => {
    const input = mapVoiceWebhookToSubmitInput(
      {
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
        crops_discussed: ['dhan', 'paddy'],
        products_discussed: ['erae strong'],
        has_purchased: true,
        purchased_products: [{ product: 'ERAZE STRONG', quantity: '1', unit: 'Kg' }],
      },
      masters,
      { farmerName: 'Amit Kumar', activityCrops: ['Paddy'], activityProducts: ['Eraze Strong'] }
    );

    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.productsDiscussed).toEqual(['Eraze Strong']);
    expect(input.purchasedProducts).toEqual([{ product: 'Eraze Strong', quantity: '1', unit: 'kg' }]);
  });

  test('hasStructuredCallResult is false for telephony-only / template payloads', () => {
    expect(
      hasStructuredCallResult({
        call_status: 'Connected',
        transcript_url: 'https://cdn.example.com/tr.txt',
      })
    ).toBe(false);
    expect(
      hasStructuredCallResult({
        did_attend: '{{gathered_context.did_attend}}',
        crops_discussed: '{{gathered_context.crops_discussed}}',
      })
    ).toBe(false);
    expect(
      hasStructuredCallResult({
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
      })
    ).toBe(true);
  });

  test('flattenTranscriptArtifact turns Dograh turns into dialogue text', () => {
    expect(
      flattenTranscriptArtifact([
        { role: 'assistant', content: 'Namaste' },
        { role: 'user', text: 'Haan, meeting gaye the' },
      ])
    ).toBe('assistant: Namaste\nuser: Haan, meeting gaye the');
  });

  test('transcript fallback fills survey JSON from transcript_url', async () => {
    const fetchText = jest.fn<(url: string) => Promise<string>>(
      async () => 'assistant: hello\nuser: yes I attended the meeting'
    );
    const extractFromTranscript = jest.fn(async () => ({
      call_status: 'Connected',
      did_attend: 'Yes, I attended',
      crops_discussed: ['Paddy'],
      activity_quality: 4,
      has_purchased: false,
      willing_to_purchase: true,
      likely_purchase_date: 'कल',
    }));

    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'Connected',
        call_duration_seconds: 86,
        transcript_url: 'https://cdn.example.com/tr.txt',
        voice_recording_url: 'https://cdn.example.com/rec.wav',
        call_ended_at: '2026-09-05T11:16:27.000Z',
      },
      { masters, fetchText, extractFromTranscript }
    );

    expect(fetchText).toHaveBeenCalledWith('https://cdn.example.com/tr.txt');
    expect(extractFromTranscript).toHaveBeenCalled();
    expect(input.callStatus).toBe('Connected');
    expect(input.didAttend).toBe('Yes, I attended');
    expect(input.didRecall).toBe(true);
    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.activityQuality).toBe(4);
    expect(input.hasPurchased).toBe(false);
    expect(input.willingToPurchase).toBe(true);
    expect(input.likelyPurchaseDate).toBe('2026-09-06');
    expect(input.transcriptUrl).toBe('https://cdn.example.com/tr.txt');
    expect(input.recordingUrl).toBe('https://cdn.example.com/rec.wav');
  });

  test('webhook JSON is combined with transcript extract', async () => {
    const fetchText = jest.fn<(url: string) => Promise<string>>(
      async () => 'assistant: hello\nuser: yes I attended, cotton and eraze also'
    );
    const extractFromTranscript = jest.fn(async () => ({
      products_discussed: ['eraze strong'],
      farmer_comments: 'Will buy next week',
      sentiment: 'Positive',
    }));

    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
        crops_discussed: ['paddy'],
        farmer_comments: 'Attended the meeting',
        sentiment: 'N/A',
        transcript_url: 'https://cdn.example.com/tr.txt',
      },
      { masters, fetchText, extractFromTranscript }
    );

    expect(fetchText).toHaveBeenCalledWith('https://cdn.example.com/tr.txt');
    expect(extractFromTranscript).toHaveBeenCalled();
    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.productsDiscussed).toEqual(['Eraze Strong']);
    expect(input.farmerComments).toContain('Attended the meeting');
    expect(input.farmerComments).toContain('Will buy next week');
    expect(input.sentiment).toBe('Positive');
  });

  test('picks the best of transcript JSON and webhook JSON against our call data', async () => {
    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'Connected',
        did_attend: 'Yes, I attended',
        crops_discussed: ['paddy'],
        products_discussed: ['unknown spray'],
        farmer_comments: 'Webhook note',
        transcript_url: 'https://cdn.example.com/tr.txt',
      },
      {
        masters,
        callContext: { activityCrops: ['Paddy', 'Cotton'], activityProducts: ['BELLOW'] },
        fetchText: async () => 'assistant: crops\nuser: cotton and bellow',
        extractFromTranscript: async () => ({
          did_attend: "Don't recall",
          crops_discussed: ['cotton'],
          products_discussed: ['bellow'],
          farmer_comments: 'Talked about the meeting',
        }),
      }
    );

    expect(input.didAttend).toBe("Don't recall");
    expect(input.cropsDiscussed).toEqual(['Cotton', 'Paddy']);
    expect(input.productsDiscussed).toEqual(['BELLOW']);
    expect(input.farmerComments).toContain('Talked about the meeting');
    expect(input.farmerComments).toContain('Webhook note');
    expect(input.farmerComments).toContain('Also mentioned: unknown spray');
  });

  test('No Answer webhook keeps telephony status and skips extract', async () => {
    const extractFromTranscript = jest.fn(async () => ({
      call_status: 'Connected',
      did_attend: 'Yes, I attended',
    }));

    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'No Answer',
        transcript_url: 'https://cdn.example.com/tr.txt',
      },
      { masters, extractFromTranscript }
    );

    expect(extractFromTranscript).not.toHaveBeenCalled();
    expect(input.callStatus).toBe('No Answer');
    expect(input.didAttend).toBeNull();
    expect(input.transcriptUrl).toBe('https://cdn.example.com/tr.txt');
  });

  test('transcript fetch failure still saves telephony result', async () => {
    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'Connected',
        call_duration_seconds: 40,
        transcript_url: 'https://cdn.example.com/tr.txt',
      },
      {
        masters,
        fetchText: async () => {
          throw new Error('network down');
        },
      }
    );

    expect(input.callStatus).toBe('Connected');
    expect(input.didAttend).toBeNull();
    expect(input.transcriptUrl).toBe('https://cdn.example.com/tr.txt');
  });

  test('inline transcript is extracted without fetching a URL', async () => {
    const fetchText = jest.fn(async () => {
      throw new Error('should not fetch');
    });
    const input = await ingestVoiceWebhookCallResult(
      {
        call_status: 'Connected',
        transcript: [
          { role: 'assistant', content: 'Kya aap meeting gaye the?' },
          { role: 'user', content: 'Haan, Paddy pe Eraze Strong bataya' },
        ],
      },
      {
        masters,
        fetchText,
        extractFromTranscript: async () => ({
          did_attend: 'Yes, I attended',
          crops_discussed: ['Paddy'],
          products_discussed: ['Eraze Strong'],
        }),
      }
    );

    expect(fetchText).not.toHaveBeenCalled();
    expect(input.didAttend).toBe('Yes, I attended');
    expect(input.cropsDiscussed).toEqual(['Paddy']);
    expect(input.productsDiscussed).toEqual(['Eraze Strong']);
  });
});
