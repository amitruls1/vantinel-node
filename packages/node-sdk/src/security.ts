import * as crypto from 'crypto';

/**
 * Generate HMAC-SHA256 signature for request authentication.
 * Covers timestamp + body to prevent replay attacks and tampering.
 */
export function hmacSign(apiKey: string, timestamp: number, body: string): string {
  const message = `${timestamp}.${body}`;
  return crypto.createHmac('sha256', apiKey).update(message).digest('hex');
}

/**
 * Validate that collector URL uses HTTPS for non-local endpoints.
 */
export function validateCollectorUrl(url: string): string {
  if (url.startsWith('https://')) return url;

  const allowedInsecure = [
    'http://localhost', 'http://127.0.0.1', 'http://0.0.0.0',
    'http://[::1]', 'http://10.', 'http://192.168.',
  ];
  // Include 172.16-31 range
  for (let i = 16; i <= 31; i++) {
    allowedInsecure.push(`http://172.${i}.`);
  }

  for (const prefix of allowedInsecure) {
    if (url.startsWith(prefix)) return url;
  }

  throw new Error(
    `Collector URL must use HTTPS for non-local endpoints. Got: ${url}`
  );
}

/**
 * Generate a cryptographically random nonce (16 bytes, hex-encoded).
 */
export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Redact an API key for safe logging.
 */
export function redactApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return '****';
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
}
