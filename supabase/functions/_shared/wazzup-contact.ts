export const WAZZUP_FALLBACK_CONTACT_NAME = 'Контакт Wazzup';

function compactContactName(value: unknown) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function digitsOnly(value: unknown) {
  return String(value ?? '').replace(/\D/g, '');
}

export function isPhoneLikeContactName(value: unknown, identifiers: unknown[] = []) {
  const name = compactContactName(value);
  if (!name) return true;

  const digits = digitsOnly(name);
  if (digits.length < 7) return false;

  const identifierDigits = new Set(
    identifiers
      .map(digitsOnly)
      .filter(identifier => identifier.length >= 7),
  );

  if (identifierDigits.has(digits)) return true;
  return /^[+\d\s().-]+$/.test(name);
}

export function cleanWazzupContactName(candidates: unknown[], identifiers: unknown[] = []) {
  for (const candidate of candidates) {
    const name = compactContactName(candidate);
    if (!name || isPhoneLikeContactName(name, identifiers)) continue;
    return name;
  }
  return null;
}
