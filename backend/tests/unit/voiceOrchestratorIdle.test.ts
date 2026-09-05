import { describe, expect, test } from '@jest/globals';
import { apiFailBackoffMs, isVirtualAgentLive } from '../../src/services/voiceAgentAdminService.js';

describe('isVirtualAgentLive', () => {
  test('running and active is live', () => {
    expect(
      isVirtualAgentLive({
        isActive: true,
        voiceAgentConfig: { voiceStatus: 'running' } as any,
      } as any)
    ).toBe(true);
  });

  test('paused, stopped, or inactive is not live', () => {
    expect(
      isVirtualAgentLive({
        isActive: true,
        voiceAgentConfig: { voiceStatus: 'paused' } as any,
      } as any)
    ).toBe(false);
    expect(
      isVirtualAgentLive({
        isActive: true,
        voiceAgentConfig: { voiceStatus: 'stopped' } as any,
      } as any)
    ).toBe(false);
    expect(
      isVirtualAgentLive({
        isActive: false,
        voiceAgentConfig: { voiceStatus: 'running' } as any,
      } as any)
    ).toBe(false);
    expect(isVirtualAgentLive({ isActive: true } as any)).toBe(false);
  });
});

describe('apiFailBackoffMs', () => {
  test('backs off 2 then 4 minutes, capped at 10', () => {
    expect(apiFailBackoffMs(0)).toBe(0);
    expect(apiFailBackoffMs(1)).toBe(2 * 60 * 1000);
    expect(apiFailBackoffMs(2)).toBe(4 * 60 * 1000);
    expect(apiFailBackoffMs(3)).toBe(8 * 60 * 1000);
    expect(apiFailBackoffMs(4)).toBe(10 * 60 * 1000);
    expect(apiFailBackoffMs(8)).toBe(10 * 60 * 1000);
  });
});
