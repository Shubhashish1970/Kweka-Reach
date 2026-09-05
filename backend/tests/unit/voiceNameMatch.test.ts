import { describe, expect, test } from '@jest/globals';
import { canonicalName, namesLikelySame, resolveAgainstOurData } from '../../src/services/voiceNameMatch.js';
import { CROP_NAME_ALIASES } from '../../src/services/voiceNameMatch.js';

describe('voice name canonicalization', () => {
  const crops = ['Paddy', 'Cotton', 'Tomato', 'Maize'];
  const products = ['Eraze Strong', 'Oscar', 'Atonik'];

  test('maps case, aliases, and small typos onto master spellings', () => {
    expect(canonicalName('paddy', crops, { aliases: CROP_NAME_ALIASES })).toBe('Paddy');
    expect(canonicalName('dhan', crops, { aliases: CROP_NAME_ALIASES })).toBe('Paddy');
    expect(canonicalName('धान', crops, { aliases: CROP_NAME_ALIASES })).toBe('Paddy');
    expect(canonicalName('eraze strong', products)).toBe('Eraze Strong');
    expect(canonicalName('erae strong', products)).toBe('Eraze Strong');
  });

  test('does not guess when a short token matches two masters', () => {
    expect(canonicalName('Strong', ['Eraze Strong', 'Oscar Strong'])).toBeNull();
  });

  test('uses activity context to break a tie', () => {
    expect(
      canonicalName('Strong', ['Eraze Strong', 'Oscar Strong'], {
        preferred: ['Eraze Strong'],
      })
    ).toBe('Eraze Strong');
  });

  test('rejects names that are not on the master', () => {
    expect(canonicalName('BELLOW', products)).toBeNull();
  });

  test('matches activity names that are not on the master', () => {
    expect(resolveAgainstOurData('bellow', products, ['BELLOW'])).toBe('BELLOW');
    expect(resolveAgainstOurData('erae strong', products, ['BELLOW'])).toBe('Eraze Strong');
    expect(resolveAgainstOurData('Magic Spray', products, ['BELLOW'])).toBeNull();
  });

  test('farmer names match despite missing last name', () => {
    expect(namesLikelySame('Amit', 'Amit Kumar')).toBe(true);
    expect(namesLikelySame('Ramesh', 'Suresh')).toBe(false);
  });
});
