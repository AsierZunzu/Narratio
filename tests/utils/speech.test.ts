import { describe, it, expect } from 'vitest';
import { normalizeForSpeech } from '../../src/utils/speech.js';

describe('normalizeForSpeech', () => {
  it('strips dot thousands separators in Spanish', () => {
    expect(normalizeForSpeech('Costó 1.000.000 de euros', 'es')).toBe('Costó 1000000 de euros');
  });

  it('handles a single group', () => {
    expect(normalizeForSpeech('Hay 2.500 personas', 'es')).toBe('Hay 2500 personas');
  });

  it('accepts region-qualified language tags', () => {
    expect(normalizeForSpeech('1.000', 'es-ES')).toBe('1000');
    expect(normalizeForSpeech('1.000', 'pt_BR')).toBe('1000');
  });

  it('leaves version numbers and times untouched', () => {
    expect(normalizeForSpeech('versión 1.2.3 a las 10.30', 'es')).toBe('versión 1.2.3 a las 10.30');
  });

  it('leaves groups that are not exactly three digits untouched', () => {
    expect(normalizeForSpeech('1.0000 y 1234.000', 'es')).toBe('1.0000 y 1234.000');
  });

  it('does not touch decimal commas', () => {
    expect(normalizeForSpeech('3,5 %', 'es')).toBe('3,5 %');
  });

  it('leaves English text unchanged', () => {
    expect(normalizeForSpeech('Version 1.000 released', 'en')).toBe('Version 1.000 released');
  });
});
