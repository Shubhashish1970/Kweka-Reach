import logger from './logger.js';

const MIN_PASSWORD_LENGTH = 8;

const DEV_FALLBACK_RESET_PASSWORD = 'KwekaReach#Temp1';
/** Dev-only fallback when USER_VIRTUAL_AGENT_DEFAULT_PASSWORD is unset (NACL test convention). */
const DEV_FALLBACK_VIRTUAL_AGENT_PASSWORD = 'Nacl@1234';

/**
 * Plaintext password for admin "reset to default" on human users.
 * Set USER_DEFAULT_RESET_PASSWORD (min 8 chars) in production.
 */
export function resolveDefaultResetPassword(): string | null {
  const fromEnv = process.env.USER_DEFAULT_RESET_PASSWORD?.trim();
  if (fromEnv && fromEnv.length >= MIN_PASSWORD_LENGTH) return fromEnv;
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('[users] USER_DEFAULT_RESET_PASSWORD unset; using dev-only temporary default');
    return DEV_FALLBACK_RESET_PASSWORD;
  }
  return null;
}

/**
 * Default password for virtual (voice) CC agents on create and admin reset.
 * USER_VIRTUAL_AGENT_DEFAULT_PASSWORD → dev Nacl@1234 → USER_DEFAULT_RESET_PASSWORD (production).
 */
export function resolveVirtualAgentDefaultPassword(): string | null {
  const virtualSpecific = process.env.USER_VIRTUAL_AGENT_DEFAULT_PASSWORD?.trim();
  if (virtualSpecific && virtualSpecific.length >= MIN_PASSWORD_LENGTH) return virtualSpecific;

  if (process.env.NODE_ENV !== 'production') {
    logger.warn(
      '[users] USER_VIRTUAL_AGENT_DEFAULT_PASSWORD unset; using dev-only virtual agent default'
    );
    return DEV_FALLBACK_VIRTUAL_AGENT_PASSWORD;
  }

  const sharedDefault = process.env.USER_DEFAULT_RESET_PASSWORD?.trim();
  if (sharedDefault && sharedDefault.length >= MIN_PASSWORD_LENGTH) return sharedDefault;

  return null;
}
