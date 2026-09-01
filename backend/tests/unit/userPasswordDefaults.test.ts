import { resolveVirtualAgentDefaultPassword } from '../../src/config/userPasswordDefaults.js';

describe('userPasswordDefaults', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.USER_VIRTUAL_AGENT_DEFAULT_PASSWORD;
    delete process.env.USER_DEFAULT_RESET_PASSWORD;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('resolveVirtualAgentDefaultPassword prefers USER_VIRTUAL_AGENT_DEFAULT_PASSWORD', () => {
    process.env.USER_VIRTUAL_AGENT_DEFAULT_PASSWORD = 'VirtualAgent#1';
    expect(resolveVirtualAgentDefaultPassword()).toBe('VirtualAgent#1');
  });

  test('resolveVirtualAgentDefaultPassword falls back to dev Nacl@1234 when unset', () => {
    expect(resolveVirtualAgentDefaultPassword()).toBe('Nacl@1234');
  });
});
