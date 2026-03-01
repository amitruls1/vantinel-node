import axios from 'axios';
import { VantinelClient } from '../client';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('VantinelClient', () => {
  let mockAxiosInstance: jest.Mocked<Pick<ReturnType<typeof axios.create>, 'post' | 'get'>>;

  beforeEach(() => {
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);
    jest.clearAllMocks();
  });

  // ── Construction ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a client with defaults', () => {
      const client = new VantinelClient({ apiKey: 'test-key' });
      expect(client).toBeDefined();
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'http://localhost:8000' }),
      );
    });

    it('uses provided collectorUrl', () => {
      new VantinelClient({ apiKey: 'key', collectorUrl: 'https://collector.example.com' });
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({ baseURL: 'https://collector.example.com' }),
      );
    });

    it('throws for invalid (non-https, non-local) collectorUrl', () => {
      expect(() => new VantinelClient({ collectorUrl: 'http://external.example.com' })).toThrow(/HTTPS/);
    });
  });

  // ── sendEvent ───────────────────────────────────────────────────────────────

  describe('sendEvent', () => {
    it('returns allow decision from server', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'key' });

      const decision = await client.sendEvent({
        session_id: 'sess_001',
        tool_name: 'search_db',
        tool_args_hash: 'abc123',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('allow');
    });

    it('returns block decision from server', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { decision: 'block', message: 'zombie loop detected' },
      });
      const client = new VantinelClient({ apiKey: 'key' });

      const decision = await client.sendEvent({
        session_id: 'sess_001',
        tool_name: 'search_db',
        tool_args_hash: 'abc123',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('block');
      expect(decision.message).toBe('zombie loop detected');
    });

    it('returns require_approval decision from server', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { decision: 'require_approval', message: 'dangerous tool' },
      });
      const client = new VantinelClient({ apiKey: 'key' });
      const decision = await client.sendEvent({
        session_id: 'sess_001',
        tool_name: 'delete_user',
        tool_args_hash: 'def456',
        timestamp: Date.now(),
      });
      expect(decision.decision).toBe('require_approval');
    });

    it('sends correct headers', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'test-api-key', clientId: 'client-a' });

      await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: 1000,
      });

      const callArgs = mockAxiosInstance.post.mock.calls[0];
      const headers = callArgs[2]?.headers as Record<string, string>;
      expect(headers['X-Vantinel-API-Key']).toBe('test-api-key');
      expect(headers['X-Vantinel-Client']).toBe('client-a');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['X-Vantinel-Signature']).toBeDefined();
      expect(headers['X-Vantinel-Timestamp']).toBeDefined();
      expect(headers['X-Vantinel-Nonce']).toBeDefined();
    });

    it('fails open on network error', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('network error'));
      const client = new VantinelClient({ apiKey: 'key' });

      const decision = await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('allow');
    });

    it('fails open on 5xx error', async () => {
      mockAxiosInstance.post.mockRejectedValue({ response: { status: 503 } });
      const client = new VantinelClient({ apiKey: 'key' });

      const decision = await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('allow');
    });

    it('fails open on 4xx error (non-retryable)', async () => {
      mockAxiosInstance.post.mockRejectedValue({ response: { status: 401 } });
      const client = new VantinelClient({ apiKey: 'key' });

      const decision = await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('allow');
    });
  });

  // ── dryRun mode ──────────────────────────────────────────────────────────────

  describe('dryRun mode', () => {
    it('does not call the server in dryRun mode', async () => {
      const client = new VantinelClient({ apiKey: 'key', dryRun: true });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      const decision = await client.sendEvent({
        session_id: 'sess_dry',
        tool_name: 'test_tool',
        tool_args_hash: 'hash',
        timestamp: Date.now(),
      });

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      expect(decision.decision).toBe('allow');
      consoleSpy.mockRestore();
    });

    it('logs the event in dryRun mode', async () => {
      const client = new VantinelClient({ apiKey: 'key', dryRun: true });
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await client.sendEvent({
        session_id: 'sess_dry',
        tool_name: 'search_db',
        tool_args_hash: 'hash',
        timestamp: Date.now(),
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DryRun'),
        expect.objectContaining({ tool_name: 'search_db' }),
      );
      consoleSpy.mockRestore();
    });
  });

  // ── Batching ─────────────────────────────────────────────────────────────────

  describe('batching', () => {
    it('buffers events and flushes when batch is full', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'key', batchSize: 3 });

      const event = {
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      };

      await client.sendEvent(event);
      await client.sendEvent(event);
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();

      await client.sendEvent(event); // 3rd event fills the batch
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);

      // Verify batch payload was an array
      const body = JSON.parse(mockAxiosInstance.post.mock.calls[0][1] as string);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(3);
    });

    it('flushes remaining events when flush() is called', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'key', batchSize: 10 });

      for (let i = 0; i < 5; i++) {
        await client.sendEvent({
          session_id: 's',
          tool_name: 't',
          tool_args_hash: `h${i}`,
          timestamp: Date.now(),
        });
      }

      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
      await client.flush();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('no-ops flush when queue is empty', async () => {
      const client = new VantinelClient({ apiKey: 'key', batchSize: 5 });
      await expect(client.flush()).resolves.toBeUndefined();
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  // ── Retries ──────────────────────────────────────────────────────────────────

  describe('retries', () => {
    it('retries on 5xx errors up to maxRetries', async () => {
      mockAxiosInstance.post
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockRejectedValueOnce({ response: { status: 503 } })
        .mockResolvedValueOnce({ data: { decision: 'allow' } });

      const client = new VantinelClient({ apiKey: 'key', retry: { maxRetries: 2, backoffMs: 0 } });
      const decision = await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
      expect(decision.decision).toBe('allow');
    });

    it('fails open after exhausting retries', async () => {
      mockAxiosInstance.post.mockRejectedValue({ response: { status: 500 } });

      const client = new VantinelClient({ apiKey: 'key', retry: { maxRetries: 1, backoffMs: 0 } });
      const decision = await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      expect(decision.decision).toBe('allow');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });
  });

  // ── Global metadata ──────────────────────────────────────────────────────────

  describe('setGlobalMetadata', () => {
    it('merges global metadata into events', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'key' });
      client.setGlobalMetadata({ env: 'production', version: '1.2.3' });

      await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
      });

      const body = JSON.parse(mockAxiosInstance.post.mock.calls[0][1] as string);
      expect(body.metadata).toMatchObject({ env: 'production', version: '1.2.3' });
    });

    it('event-level metadata overrides global metadata', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { decision: 'allow' } });
      const client = new VantinelClient({ apiKey: 'key' });
      client.setGlobalMetadata({ env: 'production' });

      await client.sendEvent({
        session_id: 's',
        tool_name: 't',
        tool_args_hash: 'h',
        timestamp: Date.now(),
        metadata: { env: 'staging' },
      });

      const body = JSON.parse(mockAxiosInstance.post.mock.calls[0][1] as string);
      expect(body.metadata.env).toBe('staging');
    });
  });

  // ── ping ─────────────────────────────────────────────────────────────────────

  describe('ping', () => {
    it('returns ok:true when collector is reachable', async () => {
      mockAxiosInstance.get.mockResolvedValue({ status: 200 });
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.ping();
      expect(result.ok).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns ok:false when collector is unreachable', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('ECONNREFUSED'));
      const client = new VantinelClient({ apiKey: 'key' });
      const result = await client.ping();
      expect(result.ok).toBe(false);
    });
  });
});
