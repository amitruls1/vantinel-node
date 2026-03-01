/**
 * Browser-compatible security utilities.
 * Uses Web Crypto API instead of Node.js crypto module.
 */

/**
 * Generate HMAC-SHA256 signature using Web Crypto API.
 */
export async function hmacSign(apiKey: string, timestamp: number, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const message = `${timestamp}.${body}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(apiKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate that collector URL uses HTTPS for non-local endpoints.
 */
export function validateCollectorUrl(url: string): string {
  if (url.startsWith('https://')) return url;

  const allowedInsecure = [
    'http://localhost', 'http://127.0.0.1', 'http://0.0.0.0', 'http://[::1]',
  ];

  for (const prefix of allowedInsecure) {
    if (url.startsWith(prefix)) return url;
  }

  throw new Error(
    `Collector URL must use HTTPS for non-local endpoints. Got: ${url}`
  );
}

/**
 * Generate a random nonce using Web Crypto API.
 */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Redact an API key for safe logging.
 */
export function redactApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}
