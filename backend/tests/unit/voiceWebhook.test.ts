import { describe, expect, test, afterEach } from '@jest/globals';
import { buildVoiceTriggerUrl } from '../../src/services/voiceApiClient.js';
import { mapVoiceWebhookToSubmitInput } from '../../src/services/voiceAgentService.js';
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
      sentiment: 'Positive',
      farmer_comments: 'Happy with product',
      recording_url: 'https://cdn.example.com/rec.mp3',
      transcript_url: 'https://cdn.example.com/tr.txt',
    });

    expect(input.callStatus).toBe('Connected');
    expect(input.callDurationSeconds).toBe(120);
    expect(input.didAttend).toBe('Yes, I attended');
    expect(input.didRecall).toBe(true);
    expect(input.sentiment).toBe('Positive');
    expect(input.farmerComments).toBe('Happy with product');
    expect(input.recordingUrl).toBe('https://cdn.example.com/rec.mp3');
    expect(input.transcriptUrl).toBe('https://cdn.example.com/tr.txt');
  });

  test('mapVoiceWebhookToSubmitInput maps no-answer telephony status', () => {
    const input = mapVoiceWebhookToSubmitInput({
      telephony_status: 'no-answer',
    });
    expect(input.callStatus).toBe('No Answer');
  });
});
