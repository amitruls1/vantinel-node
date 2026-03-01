import { describe, it, expect } from 'vitest';
import { validateCollectorUrl, redactApiKey } from '../security';

// Note: hmacSign and generateNonce use Web Crypto API (available in jsdom via @vitest/browser or Node 18+)

describe('validateCollectorUrl', () => {
  it('allows https URLs', () => {
    expect(validateCollectorUrl('https://api.vantinel.com')).toBe('https://api.vantinel.com');
    expect(validateCollectorUrl('https://collector.example.com/v1')).toBe(
      'https://collector.example.com/v1',
    );
  });

  it('allows localhost http', () => {
    expect(validateCollectorUrl('http://localhost:8000')).toBe('http://localhost:8000');
    expect(validateCollectorUrl('http://localhost')).toBe('http://localhost');
  });

  it('allows 127.0.0.1', () => {
    expect(validateCollectorUrl('http://127.0.0.1')).toBe('http://127.0.0.1');
    expect(validateCollectorUrl('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
  });

  it('allows 0.0.0.0', () => {
    expect(validateCollectorUrl('http://0.0.0.0:8000')).toBe('http://0.0.0.0:8000');
  });

  it('allows [::1] (IPv6 loopback)', () => {
    expect(validateCollectorUrl('http://[::1]:8000')).toBe('http://[::1]:8000');
  });

  it('throws for non-https external URLs', () => {
    expect(() => validateCollectorUrl('http://api.vantinel.com')).toThrow(/HTTPS/);
    expect(() => validateCollectorUrl('http://34.100.200.1')).toThrow(/HTTPS/);
  });

  it('returns the URL unchanged for valid input', () => {
    const url = 'https://collector.vantinel.io/v2';
    expect(validateCollectorUrl(url)).toBe(url);
  });
});

describe('redactApiKey', () => {
  it('redacts the middle of a long key', () => {
    const key = 'vantinel_abc123xyz789';
    const redacted = redactApiKey(key);
    expect(redacted).toBe('vant****z789');
    expect(redacted).not.toContain('abc123');
  });

  it('returns **** for short keys (8 chars or fewer)', () => {
    expect(redactApiKey('12345678')).toBe('****');
    expect(redactApiKey('short')).toBe('****');
    expect(redactApiKey('')).toBe('****');
  });

  it('handles keys of exactly 9 characters', () => {
    expect(redactApiKey('123456789')).toBe('1234****6789');
  });

  it('preserves first 4 and last 4 chars', () => {
    const key = 'ABCDEFGHIJKLMNOP';
    const redacted = redactApiKey(key);
    expect(redacted.startsWith('ABCD')).toBe(true);
    expect(redacted.endsWith('MNOP')).toBe(true);
    expect(redacted).toContain('****');
  });
});
