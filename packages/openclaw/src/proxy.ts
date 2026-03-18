import { spawn, ChildProcess } from 'child_process';

let proxyProcess: ChildProcess | null = null;

export interface ProxyOptions {
  mode?: 'openclaw' | 'nemoclaw' | 'generic';
  collectorUrl?: string;
  apiKey?: string;
  clientId?: string;
}

/**
 * Start the Vantinel MCP proxy wrapper.
 * Spawns `npx vantinel-mcp-proxy --mode <mode>` in the background.
 * Returns true if started successfully, false if already running or failed.
 */
export async function startMcpProxy(
  targetCommand: string,
  targetArgs: string[],
  options: ProxyOptions = {}
): Promise<boolean> {
  if (proxyProcess && !proxyProcess.killed) {
    return false; // Already running
  }

  const mode = options.mode ?? 'openclaw';
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
  };

  if (options.collectorUrl) env['VANTINEL_COLLECTOR_URL'] = options.collectorUrl;
  if (options.apiKey) env['VANTINEL_API_KEY'] = options.apiKey;
  if (options.clientId) env['VANTINEL_CLIENT_ID'] = options.clientId;
  if (options.mode) env['VANTINEL_MODE'] = options.mode;

  const args = ['--mode', mode, '--', targetCommand, ...targetArgs];

  proxyProcess = spawn('npx', ['vantinel-mcp-proxy', ...args], {
    env,
    stdio: 'inherit',
    detached: false,
  });

  proxyProcess.on('error', (err) => {
    console.warn('[Vantinel] MCP proxy failed to start:', err.message);
    proxyProcess = null;
  });

  proxyProcess.on('exit', () => {
    proxyProcess = null;
  });

  return true;
}

/**
 * Stop the running MCP proxy process.
 */
export async function stopMcpProxy(): Promise<void> {
  if (proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill('SIGTERM');
    proxyProcess = null;
  }
}

/**
 * Returns true if the MCP proxy is currently running.
 */
export function isMcpProxyRunning(): boolean {
  return proxyProcess !== null && !proxyProcess.killed;
}
