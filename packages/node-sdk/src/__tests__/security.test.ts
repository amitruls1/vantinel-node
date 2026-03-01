import { hmacSign, validateCollectorUrl, generateNonce, redactApiKey } from '../security';

describe('hmacSign', () => {
  it('returns a hex string', () => {
    const sig = hmacSign('my-api-key', 1700000000000, '{"test":true}');
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for same inputs', () => {
    const sig1 = hmacSign('key', 12345, 'body');
    const sig2 = hmacSign('key', 12345, 'body');
    expect(sig1).toBe(sig2);
  });

  it('differs when API key changes', () => {
    const sig1 = hmacSign('key-a', 12345, 'body');
    const sig2 = hmacSign('key-b', 12345, 'body');
    expect(sig1).not.toBe(sig2);
  });

  it('differs when timestamp changes', () => {
    const sig1 = hmacSign('key', 1000, 'body');
    const sig2 = hmacSign('key', 2000, 'body');
    expect(sig1).not.toBe(sig2);
  });

  it('differs when body changes', () => {
    const sig1 = hmacSign('key', 12345, 'body-a');
    const sig2 = hmacSign('key', 12345, 'body-b');
    expect(sig1).not.toBe(sig2);
  });

  it('handles empty key gracefully', () => {
    expect(() => hmacSign('', 12345, 'body')).not.toThrow();
  });

  it('handles empty body', () => {
    const sig = hmacSign('key', 12345, '');
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });
});

describe('validateCollectorUrl', () => {
  it('allows https URLs', () => {
    expect(validateCollectorUrl('https://api.vantinel.com')).toBe('https://api.vantinel.com');
    expect(validateCollectorUrl('https://collector.example.com/v1')).toBe('https://collector.example.com/v1');
  });

  it('allows localhost http', () => {
    expect(validateCollectorUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(validateCollectorUrl('http://localhost')).toBe('http://localhost');
  });

  it('allows 127.0.0.1', () => {
    expect(validateCollectorUrl('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000');
  });

  it('allows 0.0.0.0', () => {
    expect(validateCollectorUrl('http://0.0.0.0:8000')).toBe('http://0.0.0.0:8000');
  });

  it('allows private 10.x.x.x', () => {
    expect(validateCollectorUrl('http://10.0.0.1:8000')).toBe('http://10.0.0.1:8000');
  });

  it('allows private 192.168.x.x', () => {
    expect(validateCollectorUrl('http://192.168.1.50:8000')).toBe('http://192.168.1.50:8000');
  });

  it('throws for plain http non-local URL', () => {
    expect(() => validateCollectorUrl('http://api.vantinel.com')).toThrow(/HTTPS/);
    expect(() => validateCollectorUrl('http://34.100.200.1:8000')).toThrow(/HTTPS/);
  });

  it('returns the URL unchanged when valid', () => {
    const url = 'https://collector.vantinel.io';
    expect(validateCollectorUrl(url)).toBe(url);
  });
});

describe('generateNonce', () => {
  it('returns a hex string of expected length', () => {
    const nonce = generateNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique values each call', () => {
    const nonces = new Set(Array.from({ length: 100 }, () => generateNonce()));
    expect(nonces.size).toBe(100);
  });
});

describe('redactApiKey', () => {
  it('redacts a normal key', () => {
    const redacted = redactApiKey('vantinel_abc123xyz789');
    expect(redacted).toBe('vant****z789');
    expect(redacted).not.toContain('abc123');
  });

  it('fully redacts short keys', () => {
    expect(redactApiKey('short')).toBe('****');
    expect(redactApiKey('12345678')).toBe('****');
  });

  it('handles keys of exactly 9 characters', () => {
    const result = redactApiKey('123456789');
    expect(result).toBe('1234****6789');
  });

  it('preserves first 4 and last 4 chars for long keys', () => {
    const key = 'ABCD_middle_EFGH';
    const redacted = redactApiKey(key);
    expect(redacted.startsWith('ABCD')).toBe(true);
    expect(redacted.endsWith('EFGH')).toBe(true);
    expect(redacted).toContain('****');
  });
});
