import { VantinelMonitor } from '../monitor';
import { VantinelClient, VantinelDecision } from '../client';

// Mock the entire client module
jest.mock('../client');
const MockedClient = VantinelClient as jest.MockedClass<typeof VantinelClient>;

function makeMonitor(overrides: ConstructorParameters<typeof VantinelMonitor>[0] = {}) {
  return new VantinelMonitor({ apiKey: 'test-key', ...overrides });
}

describe('VantinelMonitor', () => {
  let sendEventMock: jest.MockedFunction<VantinelClient['sendEvent']>;

  beforeEach(() => {
    MockedClient.mockClear();
    sendEventMock = jest.fn().mockResolvedValue({ decision: 'allow' } as VantinelDecision);
    MockedClient.prototype.sendEvent = sendEventMock;
    MockedClient.prototype.ping = jest.fn().mockResolvedValue({ ok: true, latencyMs: 5 });
    MockedClient.prototype.flush = jest.fn().mockResolvedValue(undefined);
    // Reset singleton so each test gets a fresh instance
    (VantinelMonitor as any).instance = null;
  });

  // ── Construction ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates an instance with a session ID', () => {
      const monitor = makeMonitor();
      // session ID is private but VantinelClient is called with config
      expect(monitor).toBeDefined();
      expect(MockedClient).toHaveBeenCalledTimes(1);
    });

    it('warns when no API key is provided', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      new VantinelMonitor({});
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No API Key'));
      warnSpy.mockRestore();
    });

    it('does not warn when API key is provided', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      makeMonitor({ apiKey: 'valid-key' });
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('reads API key from environment variable', () => {
      process.env.VANTINEL_API_KEY = 'env-api-key';
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      new VantinelMonitor({});
      expect(warnSpy).not.toHaveBeenCalled();
      delete process.env.VANTINEL_API_KEY;
      warnSpy.mockRestore();
    });
  });

  // ── getSingleton ──────────────────────────────────────────────────────────────

  describe('getSingleton', () => {
    it('returns the same instance on repeated calls', () => {
      const a = VantinelMonitor.getSingleton({ apiKey: 'key' });
      const b = VantinelMonitor.getSingleton({ apiKey: 'key' });
      expect(a).toBe(b);
    });

    it('ignores config on second call (uses first config)', () => {
      const a = VantinelMonitor.getSingleton({ apiKey: 'first-key' });
      const b = VantinelMonitor.getSingleton({ apiKey: 'different-key' });
      expect(a).toBe(b);
    });
  });

  // ── setGlobalMetadata ─────────────────────────────────────────────────────────

  describe('setGlobalMetadata', () => {
    it('merges metadata', async () => {
      const monitor = makeMonitor();
      monitor.setGlobalMetadata({ env: 'prod' });
      monitor.setGlobalMetadata({ version: '2.0' });

      const fn = jest.fn().mockResolvedValue('result');
      const wrapped = monitor.monitor('my_tool', fn);
      await wrapped('arg');

      const callEvent = sendEventMock.mock.calls[0][0];
      expect(callEvent.metadata).toMatchObject({ env: 'prod', version: '2.0' });
    });
  });

  // ── monitor() ────────────────────────────────────────────────────────────────

  describe('monitor()', () => {
    it('returns a wrapped async function', () => {
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue(42);
      const wrapped = monitor.monitor('add', fn);
      expect(typeof wrapped).toBe('function');
    });

    it('executes the original function and returns its value', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue('hello');
      const wrapped = monitor.monitor('greet', fn);

      const result = await wrapped('world');
      expect(result).toBe('hello');
      expect(fn).toHaveBeenCalledWith('world');
    });

    it('sends a pre-call event before executing', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue(null);
      const wrapped = monitor.monitor('search', fn);
      await wrapped('query');

      expect(sendEventMock).toHaveBeenCalledTimes(2);
      const preEvent = sendEventMock.mock.calls[0][0];
      expect(preEvent.tool_name).toBe('search');
      expect(preEvent.session_id).toBeDefined();
      expect(preEvent.tool_args_hash).toBeDefined();
    });

    it('sends a follow-up latency event after execution', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue('ok');
      const wrapped = monitor.monitor('search', fn);
      await wrapped();

      expect(sendEventMock).toHaveBeenCalledTimes(2);
      const postEvent = sendEventMock.mock.calls[1][0];
      expect(postEvent.event_type).toBe('tool_result');
      expect(postEvent.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('throws when server returns block decision', async () => {
      sendEventMock.mockResolvedValue({
        decision: 'block',
        message: 'zombie loop detected',
      });
      const monitor = makeMonitor();
      const fn = jest.fn();
      const wrapped = monitor.monitor('repeat_tool', fn);

      await expect(wrapped()).rejects.toThrow(/blocked/i);
      expect(fn).not.toHaveBeenCalled();
    });

    it('allows execution when decision is require_approval', async () => {
      sendEventMock.mockResolvedValue({ decision: 'require_approval' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue('ok');
      const wrapped = monitor.monitor('delete_user', fn);

      const result = await wrapped();
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalled();
    });

    it('skips monitoring when options.skip is true', async () => {
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue('skipped');
      const wrapped = monitor.monitor('debug_tool', fn, { skip: true });

      const result = await wrapped('arg');
      expect(result).toBe('skipped');
      expect(sendEventMock).not.toHaveBeenCalled();
    });

    it('attaches traceId when provided', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue(null);
      const traceId = 'trace-xyz-789';
      const wrapped = monitor.monitor('traced_tool', fn, { traceId });
      await wrapped();

      const preEvent = sendEventMock.mock.calls[0][0];
      expect(preEvent.trace_id).toBe(traceId);
    });

    it('uses costCalculator to compute estimated_cost', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue({ tokens: 100 });
      const wrapped = monitor.monitor('llm_call', fn, {
        costCalculator: (_result) => ({ estimated_cost: 0.02, metadata: { tokens: 100 } }),
      });
      await wrapped();

      const postEvent = sendEventMock.mock.calls[1][0];
      expect(postEvent.estimated_cost).toBe(0.02);
      expect(postEvent.metadata).toMatchObject({ tokens: 100 });
    });

    it('produces consistent hash for same args', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue(null);
      const wrapped = monitor.monitor('hash_tool', fn);

      await wrapped('same-arg');
      await wrapped('same-arg');

      const hash1 = sendEventMock.mock.calls[0][0].tool_args_hash;
      const hash2 = sendEventMock.mock.calls[2][0].tool_args_hash;
      expect(hash1).toBe(hash2);
    });

    it('produces different hashes for different args', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const fn = jest.fn().mockResolvedValue(null);
      const wrapped = monitor.monitor('hash_tool', fn);

      await wrapped('arg-a');
      await wrapped('arg-b');

      const hash1 = sendEventMock.mock.calls[0][0].tool_args_hash;
      const hash2 = sendEventMock.mock.calls[2][0].tool_args_hash;
      expect(hash1).not.toBe(hash2);
    });
  });

  // ── shadowMode ───────────────────────────────────────────────────────────────

  describe('shadowMode', () => {
    it('allows blocked tools in shadow mode', async () => {
      sendEventMock.mockResolvedValue({ decision: 'block', message: 'policy' });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const monitor = makeMonitor({ shadowMode: true });
      const fn = jest.fn().mockResolvedValue('executed');
      const wrapped = monitor.monitor('blocked_in_shadow', fn);

      const result = await wrapped();
      expect(result).toBe('executed');
      expect(fn).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Shadow'));
      warnSpy.mockRestore();
    });

    it('allows require_approval tools in shadow mode', async () => {
      sendEventMock.mockResolvedValue({ decision: 'require_approval' });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const monitor = makeMonitor({ shadowMode: true });
      const fn = jest.fn().mockResolvedValue('ok');
      const wrapped = monitor.monitor('approval_tool', fn);

      const result = await wrapped();
      expect(result).toBe('ok');
      warnSpy.mockRestore();
    });
  });

  // ── captureError ──────────────────────────────────────────────────────────────

  describe('captureError', () => {
    it('sends a tool_error event', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      const error = new Error('something went wrong');
      await monitor.captureError('failing_tool', error);

      expect(sendEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          tool_name: 'failing_tool',
          event_type: 'tool_error',
          metadata: expect.objectContaining({ error_message: 'something went wrong' }),
        }),
      );
    });

    it('includes custom metadata in error event', async () => {
      sendEventMock.mockResolvedValue({ decision: 'allow' });
      const monitor = makeMonitor();
      await monitor.captureError('my_tool', new Error('fail'), { retry_count: 3 });

      const call = sendEventMock.mock.calls[0][0];
      expect(call.metadata).toMatchObject({ retry_count: 3 });
    });
  });

  // ── ping ──────────────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('delegates to client.ping()', async () => {
      const monitor = makeMonitor();
      const result = await monitor.ping();
      expect(result).toEqual({ ok: true, latencyMs: 5 });
    });
  });

  // ── startTrace ───────────────────────────────────────────────────────────────

  describe('startTrace', () => {
    it('returns a UUID string', () => {
      const monitor = makeMonitor();
      const traceId = monitor.startTrace();
      expect(traceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generates unique trace IDs', () => {
      const monitor = makeMonitor();
      const ids = new Set(Array.from({ length: 50 }, () => monitor.startTrace()));
      expect(ids.size).toBe(50);
    });
  });

  // ── flush ─────────────────────────────────────────────────────────────────────

  describe('flush', () => {
    it('delegates to client.flush()', async () => {
      const monitor = makeMonitor();
      await monitor.flush();
      expect(MockedClient.prototype.flush).toHaveBeenCalled();
    });
  });
});
