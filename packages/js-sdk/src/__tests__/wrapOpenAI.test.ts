import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VantinelClient } from '../index';

// Mock the global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function allowResponse() {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ decision: 'allow' }),
  });
}

function blockResponse(message = 'policy violation') {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ decision: 'block', message }),
  });
}

describe('VantinelClient.wrapOpenAI (Browser SDK)', () => {
  let client: VantinelClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(() => allowResponse());
    client = new VantinelClient({
      apiKey: 'test-api-key',
      clientId: 'test-client',
      collectorUrl: 'http://localhost:8000',
    });
  });

  function makeFakeOpenAI(createImpl?: (...args: any[]) => any) {
    return {
      chat: {
        completions: {
          create: createImpl ?? vi.fn().mockResolvedValue({
            id: 'chatcmpl-abc',
            model: 'gpt-4o',
            usage: { prompt_tokens: 50, completion_tokens: 20 },
          }),
        },
      },
    };
  }

  it('returns the same client object', () => {
    const openai = makeFakeOpenAI();
    const result = client.wrapOpenAI(openai);
    expect(result).toBe(openai);
  });

  it('warns and returns unmodified client if not OpenAI-shaped', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const notOpenAI = { someOtherApi: true };
    const result = client.wrapOpenAI(notOpenAI);
    expect(result).toBe(notOpenAI);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('wrapOpenAI failed'));
    warnSpy.mockRestore();
  });

  it('calls original create and returns response (non-stream)', async () => {
    const mockResponse = {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      usage: { prompt_tokens: 50, completion_tokens: 20 },
    };
    const originalCreate = vi.fn().mockResolvedValue(mockResponse);
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);
    const result = await openai.chat.completions.create({ model: 'gpt-4o', messages: [] });

    expect(result).toBe(mockResponse);
    expect(originalCreate).toHaveBeenCalled();
  });

  it('sends pre-check and post-call events', async () => {
    const openai = makeFakeOpenAI();
    client.wrapOpenAI(openai);
    await openai.chat.completions.create({ model: 'gpt-4o', messages: [] });

    // mockFetch is called for pre-check + post-call track events
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws on block decision', async () => {
    mockFetch.mockImplementation(() => blockResponse('budget exceeded'));
    const originalCreate = vi.fn().mockResolvedValue({ id: 'r1' });
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);

    await expect(
      openai.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    ).rejects.toThrow(/blocked/i);

    // Original create should NOT be called
    expect(originalCreate).not.toHaveBeenCalled();
  });

  it('does not mutate the original body object', async () => {
    const originalCreate = vi.fn().mockResolvedValue({ id: 'r1' });
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);

    const body = { model: 'gpt-4o', messages: [], stream: true };
    const bodyClone = { ...body };

    // Mock the stream response
    const asyncIter = (async function* () {
      yield { choices: [{ delta: { content: 'hello' } }] };
    })();
    originalCreate.mockResolvedValue(asyncIter);

    await openai.chat.completions.create(body);

    // The original body should NOT have stream_options added
    expect(body).toEqual(bodyClone);
  });

  it('adds stream_options when streaming without them', async () => {
    const originalCreate = vi.fn().mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
      })(),
    );
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);
    await openai.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true });

    // The body passed to originalCreate should have stream_options
    const passedBody = originalCreate.mock.calls[0][0];
    expect(passedBody.stream_options).toEqual({ include_usage: true });
  });

  it('does not add stream_options if already present', async () => {
    const originalCreate = vi.fn().mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
      })(),
    );
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);
    await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [],
      stream: true,
      stream_options: { include_usage: false },
    });

    const passedBody = originalCreate.mock.calls[0][0];
    expect(passedBody.stream_options).toEqual({ include_usage: false });
  });

  it('streaming: yields all chunks', async () => {
    const originalCreate = vi.fn().mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' world' } }] };
        yield { choices: [{ delta: { content: '!' } }], usage: { prompt_tokens: 10, completion_tokens: 3 }, model: 'gpt-4o' };
      })(),
    );
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);
    const stream = await openai.chat.completions.create({ model: 'gpt-4o', messages: [], stream: true });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.content).toBe('Hello');
  });

  it('captures error and re-throws', async () => {
    const originalCreate = vi.fn().mockRejectedValue(new Error('API error'));
    const openai = makeFakeOpenAI(originalCreate);

    client.wrapOpenAI(openai);

    await expect(
      openai.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    ).rejects.toThrow('API error');
  });
});
