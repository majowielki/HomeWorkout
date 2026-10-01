const encoder = new TextEncoder();

/**
 * Compares two strings without stopping at the first difference, so the
 * time taken says nothing about how many leading characters were right.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i += 1) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * The app proves it is the app by sending the shared secret. A Worker
 * deployed without a secret refuses everyone: "no secret configured" must
 * never read as "no secret required".
 */
export function isAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = request.headers.get('x-app-secret');
  return given !== null && constantTimeEqual(given, secret);
}
