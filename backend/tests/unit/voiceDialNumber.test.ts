import { describe, expect, test } from '@jest/globals';
import { resolveVoiceDialNumber, isAgentDialOverrideActive } from '../../src/utils/voiceDialNumber.js';

describe('voiceDialNumber', () => {
  test('uses farmer number when override disabled', () => {
    const res = resolveVoiceDialNumber('9396792409');
    expect(res.overridden).toBe(false);
    expect(res.dialNumber).toBe('+919396792409');
  });

  test('overrides to per-agent team number when enabled', () => {
    const res = resolveVoiceDialNumber('9396792409', {
      taskId: 'abc',
      agentDialOverride: {
        voiceDialOverrideEnabled: true,
        voiceDialOverrideNumber: '+919876543210',
      },
    });
    expect(res.overridden).toBe(true);
    expect(res.dialNumber).toBe('+919876543210');
    expect(res.originalNumber).toBe('9396792409');
  });

  test('uses farmer number when override enabled but number missing', () => {
    const res = resolveVoiceDialNumber('9396792409', {
      agentDialOverride: { voiceDialOverrideEnabled: true, voiceDialOverrideNumber: null },
    });
    expect(res.overridden).toBe(false);
    expect(res.dialNumber).toBe('+919396792409');
  });

  test('isAgentDialOverrideActive requires enabled flag and number', () => {
    expect(isAgentDialOverrideActive({ voiceDialOverrideEnabled: false, voiceDialOverrideNumber: '+919876543210' })).toBe(false);
    expect(isAgentDialOverrideActive({ voiceDialOverrideEnabled: true, voiceDialOverrideNumber: '' })).toBe(false);
    expect(isAgentDialOverrideActive({ voiceDialOverrideEnabled: true, voiceDialOverrideNumber: '+919876543210' })).toBe(true);
  });
});
