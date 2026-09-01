import { describe, expect, test } from '@jest/globals';
import { mapVoiceWebhookToSubmitInput } from '../../src/services/voiceAgentService.js';
import { toIndianE164 } from '../../src/services/voiceApiClient.js';

describe('voice integration helpers', () => {
  test('toIndianE164 formats 10-digit mobile', () => {
    expect(toIndianE164('9396792409')).toBe('+919396792409');
  });

  test('mapVoiceWebhookToSubmitInput maps connected survey fields', () => {
    const input = mapVoiceWebhookToSubmitInput({
      call_status: 'Connected',
      call_duration_seconds: 120,
      did_attend: 'Yes, I attended',
      did_recall: 'true',
      sentiment: 'Positive',
      farmer_comments: 'Happy with product',
    });

    expect(input.callStatus).toBe('Connected');
    expect(input.callDurationSeconds).toBe(120);
    expect(input.didAttend).toBe('Yes, I attended');
    expect(input.didRecall).toBe(true);
    expect(input.sentiment).toBe('Positive');
    expect(input.farmerComments).toBe('Happy with product');
  });

  test('mapVoiceWebhookToSubmitInput maps no-answer telephony status', () => {
    const input = mapVoiceWebhookToSubmitInput({
      telephony_status: 'no-answer',
    });
    expect(input.callStatus).toBe('No Answer');
  });
});
