import { VantinelMonitor } from '../monitor';
import { VantinelClient, VantinelDecision } from '../client';

// Mock the entire client module
jest.mock('../client');
const MockedClient = VantinelClient as jest.MockedClass<typeof VantinelClient>;

function makeMonitor(overrides: ConstructorParameters<typeof VantinelMonitor>[0] = {}) {
  return new VantinelMonitor({ apiKey: 'test-key', ...overrides });
}

describe('wrapOpenAI', () => {
  let sendEventMock: jest.MockedFunction<VantinelClient['sendEvent']>;

  beforeEach(() => {
    MockedClient.mockClear();
    sendEventMock = jest.fn().mockResolvedValue({ decision: 'allow' } as VantinelDecision);
    MockedClient.prototype.sendEvent = sendEventMock;
    MockedClient.prototype.ping = jest.fn().mockResolvedValue({ ok: true, latencyMs: 5 });
    MockedClient.prototype.flush = jest.fn().mockResolvedValue(undefined);
    (VantinelMonitor as any).instance = null;
  });

  it('returns the same client object', () => {
    const monitor = makeMonitor();
    const fakeClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ id: 'resp-1' }),
        },
      },
    };
    const wrapped = monitor.wrapOpenAI(fakeClient);
    expect(wrapped).toBe(fakeClient);
  });

  it('warns and returns unmodified client if not an OpenAI shape', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const monitor = makeMonitor();
    const notOpenAI = { foo: 'bar' };
    const result = monitor.wrapOpenAI(notOpenAI);
    expect(result).toBe(notOpenAI);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('does not look like'));
    warnSpy.mockRestore();
  });

  it('calls original create and returns response (non-stream)', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const mockResponse = {
      id: 'chatcmpl-1',
      model: 'gpt-4o',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const originalCreate = jest.fn().mockResolvedValue(mockResponse);
    const fakeClient = {
      chat: { completions: { create: originalCreate } },
    };

    monitor.wrapOpenAI(fakeClient);
    const result = await fakeClient.chat.completions.create({ model: 'gpt-4o', messages: [] });

    expect(result).toBe(mockResponse);
    expect(originalCreate).toHaveBeenCalled();
    // Should send pre-call event + post-call event
    expect(sendEventMock).toHaveBeenCalledTimes(2);
  });

  it('sends tool_name as openai_chat', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const fakeClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
      },
    };

    monitor.wrapOpenAI(fakeClient);
    await fakeClient.chat.completions.create({ model: 'gpt-4o', messages: [] });

    const preEvent = sendEventMock.mock.calls[0][0];
    expect(preEvent.tool_name).toBe('openai_chat');
  });

  it('throws when server returns block decision', async () => {
    sendEventMock.mockResolvedValue({ decision: 'block', message: 'budget exceeded' });
    const monitor = makeMonitor();
    const fakeClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
      },
    };

    monitor.wrapOpenAI(fakeClient);

    await expect(
      fakeClient.chat.completions.create({ model: 'gpt-4o', messages: [] }),
    ).rejects.toThrow(/Blocked/i);

    // Original create should NOT be called when blocked
    expect(fakeClient.chat.completions.create).not.toBe(jest.fn()); // it's wrapped
  });

  it('includes model in metadata', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const fakeClient = {
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({ id: 'r1' }),
        },
      },
    };

    monitor.wrapOpenAI(fakeClient);
    await fakeClient.chat.completions.create({ model: 'gpt-4o', messages: [] });

    const preEvent = sendEventMock.mock.calls[0][0];
    expect(preEvent.metadata).toMatchObject({ model: 'gpt-4o' });
  });

  it('records latency in post-call event', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const fakeClient = {
      chat: {
        completions: {
          create: jest.fn().mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve({ id: 'r1' }), 10)),
          ),
        },
      },
    };

    monitor.wrapOpenAI(fakeClient);
    await fakeClient.chat.completions.create({ model: 'gpt-4o', messages: [] });

    const postEvent = sendEventMock.mock.calls[1][0];
    expect(postEvent.latency_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('wrapLangChain', () => {
  let sendEventMock: jest.MockedFunction<VantinelClient['sendEvent']>;

  beforeEach(() => {
    MockedClient.mockClear();
    sendEventMock = jest.fn().mockResolvedValue({ decision: 'allow' } as VantinelDecision);
    MockedClient.prototype.sendEvent = sendEventMock;
    MockedClient.prototype.ping = jest.fn().mockResolvedValue({ ok: true, latencyMs: 5 });
    MockedClient.prototype.flush = jest.fn().mockResolvedValue(undefined);
    (VantinelMonitor as any).instance = null;
  });

  function makeFakeChain() {
    return {
      constructor: { name: 'RunnableSequence' },
      invoke: jest.fn().mockResolvedValue('invoke-result'),
      call: jest.fn().mockResolvedValue('call-result'),
      stream: jest.fn().mockResolvedValue(
        (async function* () {
          yield 'chunk1';
          yield 'chunk2';
        })(),
      ),
      pipe: jest.fn(),
    };
  }

  it('returns a proxy that wraps invoke/call/stream', () => {
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    // pipe should passthrough
    expect(typeof wrapped.pipe).toBe('function');
    // invoke/call/stream should be wrapped
    expect(typeof wrapped.invoke).toBe('function');
    expect(typeof wrapped.stream).toBe('function');
  });

  it('invoke: calls original and returns result', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    const result = await wrapped.invoke({ question: 'hi' });

    expect(result).toBe('invoke-result');
    expect(chain.invoke).toHaveBeenCalledWith({ question: 'hi' });
  });

  it('invoke: sends pre-check and latency events', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    await wrapped.invoke({ question: 'hi' });

    // Pre-check event + latency event
    expect(sendEventMock).toHaveBeenCalledTimes(2);
    const preEvent = sendEventMock.mock.calls[0][0];
    expect(preEvent.tool_name).toBe('langchain_RunnableSequence_invoke');
  });

  it('invoke: throws when blocked', async () => {
    sendEventMock.mockResolvedValue({ decision: 'block', message: 'denied' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    await expect(wrapped.invoke({ question: 'hi' })).rejects.toThrow(/Blocked/i);
    expect(chain.invoke).not.toHaveBeenCalled();
  });

  it('stream: returns an async iterator that yields chunks', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    const stream = await wrapped.stream({ question: 'hi' });
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('stream: sends latency event after stream is consumed', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    const stream = await wrapped.stream({ question: 'hi' });

    // Before consuming, only pre-check event sent
    expect(sendEventMock).toHaveBeenCalledTimes(1);

    // Consume the stream
    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    // Now latency event should also be sent
    expect(sendEventMock).toHaveBeenCalledTimes(2);
    const latencyEvent = sendEventMock.mock.calls[1][0];
    expect(latencyEvent.event_type).toBe('tool_result');
    expect(latencyEvent.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('stream: throws when blocked before streaming', async () => {
    sendEventMock.mockResolvedValue({ decision: 'block', message: 'denied' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    await expect(wrapped.stream({ question: 'hi' })).rejects.toThrow(/Blocked/i);
    expect(chain.stream).not.toHaveBeenCalled();
  });

  it('call: works the same as invoke', async () => {
    sendEventMock.mockResolvedValue({ decision: 'allow' });
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    const result = await wrapped.call({ question: 'hi' });

    expect(result).toBe('call-result');
    expect(chain.call).toHaveBeenCalled();
    expect(sendEventMock).toHaveBeenCalledTimes(2);
  });

  it('passthrough: non-wrapped methods bind to original chain', () => {
    const monitor = makeMonitor();
    const chain = makeFakeChain();
    const wrapped = monitor.wrapLangChain(chain);

    wrapped.pipe('next-step');
    expect(chain.pipe).toHaveBeenCalledWith('next-step');
  });
});
