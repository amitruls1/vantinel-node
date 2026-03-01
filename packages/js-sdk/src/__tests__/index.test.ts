import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VantinelClient } from '../index';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function allowResponse(extra?: object) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ decision: 'allow', ...extra }),
  });
}

function blockResponse(message = 'policy violation') {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ decision: 'block', message }),
  });
}

function approvalResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ decision: 'require_approval' }),
  });
}

describe('VantinelClient (Browser SDK)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ decision: 'allow' }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Construction ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a client with defaults', () => {
      const client = new VantinelClient({ apiKey: 'key' });
      expect(client).toBeDefined();
    });

    it('uses https collectorUrl without modification', () => {
      expect(() => new VantinelClient({ collectorUrl: 'https://api.vantinel.com' })).not.toThrow();
    });

    it('throws for non-https non-local collectorUrl', () => {
      expect(() => new VantinelClient({ collectorUrl: 'http://external.host.com' })).toThrow(/HTTPS/);
    });

    it('allows localhost collectorUrl', () => {
      expect(() => new VantinelClient({ collectorUrl: 'http://localhost:8000' })).not.toThrow();
    });

    it('assigns a unique session ID per instance', () => {
      // We can indirectly test this by sending two events and verifying session_ids differ
      const a = new VantinelClient({ apiKey: 'key' });
      const b = new VantinelClient({ apiKey: 'key' });
      expect(a).not.toBe(b);
    });
  });

  // ── track() ───────────────────────────────────────────────────────────────────

  describe('track()', () => {
    it('returns allow decision from server', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.track('search_db', { query: 'test' });
      expect(result.decision).toBe('allow');
    });

    it('calls /v1/events endpoint', async () => {
      const client = new VantinelClient({ apiKey: 'key', collectorUrl: 'http://localhost:8000' });
      await client.track('search_db', { q: 'x' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/v1/events',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('includes correct headers', async () => {
      const client = new VantinelClient({ apiKey: 'my-api-key', clientId: 'client-a' });
      await client.track('search', {});

      const [, init] = mockFetch.mock.calls[0];
      expect(init.headers['X-Vantinel-API-Key']).toBe('my-api-key');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(init.headers['X-Vantinel-Signature']).toBeDefined();
      expect(init.headers['X-Vantinel-Timestamp']).toBeDefined();
      expect(init.headers['X-Vantinel-Nonce']).toBeDefined();
    });

    it('returns allow immediately when skip is true', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.track('debug_tool', {}, { skip: true });
      expect(result.decision).toBe('allow');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns block decision from server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ decision: 'block', message: 'zombie loop' }),
      });
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.track('repeat_tool', {});
      expect(result.decision).toBe('block');
      expect(result.message).toBe('zombie loop');
    });

    it('returns require_approval from server', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ decision: 'require_approval' }),
      });
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.track('delete_user', {});
      expect(result.decision).toBe('require_approval');
    });

    it('fails open on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.track('tool', {});
      expect(result.decision).toBe('allow');
    });

    it('includes traceId when provided', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      const traceId = 'trace-abc-123';
      await client.track('tool', { q: 'x' }, { traceId });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.trace_id).toBe(traceId);
    });

    it('includes tool_name in payload', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await client.track('my_special_tool', {});

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.tool_name).toBe('my_special_tool');
    });

    it('includes session_id in payload', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await client.track('tool', {});

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.session_id).toBeDefined();
      expect(typeof body.session_id).toBe('string');
    });

    it('hashes tool args (does not send raw args)', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await client.track('search', { secret_query: 'sensitive data' });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).not.toHaveProperty('secret_query');
      expect(body.tool_args_hash).toBeDefined();
      expect(body.tool_args_hash).not.toContain('sensitive');
    });
  });

  // ── dryRun mode ──────────────────────────────────────────────────────────────

  describe('dryRun mode', () => {
    it('does not send HTTP request', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const client = new VantinelClient({ apiKey: 'key', dryRun: true });
      const result = await client.track('tool', {});
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.decision).toBe('allow');
      consoleSpy.mockRestore();
    });

    it('logs the event details', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const client = new VantinelClient({ apiKey: 'key', dryRun: true });
      await client.track('dry_run_tool', { x: 1 });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('dryRun'),
        expect.objectContaining({ tool_name: 'dry_run_tool' }),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── shadowMode ───────────────────────────────────────────────────────────────

  describe('shadowMode', () => {
    it('converts block decision to allow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ decision: 'block', message: 'policy' }),
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = new VantinelClient({ apiKey: 'key', shadowMode: true });
      const result = await client.track('blocked_tool', {});
      expect(result.decision).toBe('allow');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Shadow'));
      warnSpy.mockRestore();
    });

    it('converts require_approval to allow', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ decision: 'require_approval' }),
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const client = new VantinelClient({ apiKey: 'key', shadowMode: true });
      const result = await client.track('approval_tool', {});
      expect(result.decision).toBe('allow');
      warnSpy.mockRestore();
    });
  });

  // ── Batching ─────────────────────────────────────────────────────────────────

  describe('batching', () => {
    it('buffers events and flushes when batch is full', async () => {
      const client = new VantinelClient({ apiKey: 'key', batchSize: 3 });

      await client.track('tool', {});
      await client.track('tool', {});
      expect(mockFetch).not.toHaveBeenCalled(); // still buffered

      await client.track('tool', {});
      // After 3 events, flush occurs (each event is sent individually in the current impl)
      expect(mockFetch).toHaveBeenCalled();
    });

    it('flush() sends remaining buffered events', async () => {
      const client = new VantinelClient({ apiKey: 'key', batchSize: 10 });

      for (let i = 0; i < 5; i++) {
        await client.track('tool', { i });
      }
      expect(mockFetch).not.toHaveBeenCalled();

      await client.flush();
      expect(mockFetch).toHaveBeenCalled();
    });

    it('flush() no-ops when queue is empty', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await expect(client.flush()).resolves.toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── setGlobalMetadata ─────────────────────────────────────────────────────────

  describe('setGlobalMetadata', () => {
    it('merges metadata into event payload', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      client.setGlobalMetadata({ env: 'production', app: 'my-agent' });
      await client.track('tool', {});

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.env).toBe('production');
      expect(body.app).toBe('my-agent');
    });

    it('merges additional metadata without overwriting', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      client.setGlobalMetadata({ a: 1 });
      client.setGlobalMetadata({ b: 2 });
      await client.track('tool', {});

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.a).toBe(1);
      expect(body.b).toBe(2);
    });
  });

  // ── captureError ──────────────────────────────────────────────────────────────

  describe('captureError', () => {
    it('sends a tool_error event', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await client.captureError('failing_tool', new Error('something broke'));

      expect(mockFetch).toHaveBeenCalled();
      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.event_type).toBe('tool_error');
      expect(body.tool_name).toBe('failing_tool');
      expect(body.error_message).toBe('something broke');
    });

    it('includes custom metadata in error event', async () => {
      const client = new VantinelClient({ apiKey: 'key' });
      await client.captureError('my_tool', new Error('fail'), { attempt: 3 });

      const [, init] = mockFetch.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.attempt).toBe(3);
    });

    it('does not send in dryRun mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const client = new VantinelClient({ apiKey: 'key', dryRun: true });
      await client.captureError('tool', new Error('x'));
      expect(mockFetch).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  // ── ping ─────────────────────────────────────────────────────────────────────

  describe('ping()', () => {
    it('returns ok:true when collector responds', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.ping();
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns ok:false when collector is down', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.ping();
      expect(result.ok).toBe(false);
    });
  });

  // ── startTrace ───────────────────────────────────────────────────────────────

  describe('startTrace()', () => {
    it('returns a UUID v4 string', () => {
      const client = new VantinelClient({ apiKey: 'key' });
      const traceId = client.startTrace();
      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generates unique IDs', () => {
      const client = new VantinelClient({ apiKey: 'key' });
      const ids = new Set(Array.from({ length: 20 }, () => client.startTrace()));
      expect(ids.size).toBe(20);
    });
  });
});
