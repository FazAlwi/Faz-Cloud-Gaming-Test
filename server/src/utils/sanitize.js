/**
 * Sanitizes a user nickname / ID into a safe filesystem & Docker container slug.
 * Prevents path traversal in /srv/saves/${userId} and invalid Docker container names.
 */
export function sanitizeUserId(rawUserId) {
  if (typeof rawUserId !== 'string') return '';

  const slug = rawUserId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  if (slug.length < 2) return '';
  return slug;
}
