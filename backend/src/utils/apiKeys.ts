/**
 * API Key validation utilities
 * Detects placeholder, unconfigured, or masked credentials
 */

export function isPlaceholderKey(key?: string | null): boolean {
  if (!key) return true;
  const k = key.trim();
  if (k.length < 8) return true;
  // All X's or PK followed by X's
  if (/^X+$/i.test(k)) return true;
  if (/^PKX+$/i.test(k)) return true;
  // Contains 4 or more X's in a row
  if (/X{4,}/i.test(k)) return true;
  // Contains placeholder phrases
  const lower = k.toLowerCase();
  if (
    lower.includes('your_') ||
    lower.includes('your-') ||
    lower.includes('placeholder') ||
    lower.includes('demo_key') ||
    lower.includes('test_key') ||
    lower.includes('replace_me') ||
    lower.includes('api_key_here')
  ) {
    return true;
  }
  return false;
}

export function isValidApiKey(key?: string | null): boolean {
  return !isPlaceholderKey(key);
}
