import { describe, expect, test } from '@jest/globals';
import { isVirtualAgentLive } from '../../src/services/voiceAgentAdminService.js';

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
