// espeak-ng (Piper's phonemizer) treats '.' between digits as a decimal point
// regardless of voice language, so "1.000.000" is read digit by digit.
// Languages listed here use '.' as the thousands separator; stripping it lets
// espeak-ng read the plain integer naturally ("un millón").
const DOT_GROUPING_LANGUAGES = new Set(['es', 'de', 'it', 'pt', 'nl', 'da', 'id', 'tr']);

// Only exact 3-digit groups, so versions ("1.2.3") and times ("10.30") are untouched.
const DOT_GROUPED_NUMBER = /\b\d{1,3}(?:\.\d{3})+\b/g;

/** Extracts the primary subtag from a language tag: "es-ES" → "es". */
function primaryLanguage(language: string): string {
  return language.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

export function normalizeForSpeech(text: string, language: string): string {
  if (!DOT_GROUPING_LANGUAGES.has(primaryLanguage(language))) return text;
  return text.replace(DOT_GROUPED_NUMBER, (match) => match.replaceAll('.', ''));
}
