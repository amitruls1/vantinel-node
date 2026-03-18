import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface OpenclawJsonConfig {
  models?: {
    providers?: Record<string, unknown>;
  };
  'diagnostics-otel'?: {
    enabled: boolean;
    endpoint: string;
    protocol: string;
    headers?: Record<string, string>;
  };
  [key: string]: unknown;
}

/**
 * Returns the default path to ~/.openclaw/openclaw.json
 */
export function getOpenclawConfigPath(): string {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

/**
 * Read existing openclaw.json if it exists, return empty object otherwise.
 */
export function readOpenclawConfig(configPath?: string): OpenclawJsonConfig {
  const filePath = configPath ?? getOpenclawConfigPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw) as OpenclawJsonConfig;
    }
  } catch {
    // Ignore parse errors — start fresh
  }
  return {};
}

/**
 * Deep-merge a patch into the existing openclaw.json and write it back.
 * Returns the path written to.
 */
export function writeOpenclawConfig(
  patch: OpenclawJsonConfig,
  configPath?: string
): string {
  const filePath = configPath ?? getOpenclawConfigPath();
  const dir = path.dirname(filePath);

  // Ensure directory exists
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const existing = readOpenclawConfig(filePath);
  const merged = deepMerge(existing, patch);
  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf-8');
  return filePath;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Build the Vantinel config fragment for openclaw.json
 */
export function buildVantinelConfigFragment(
  apiKey: string,
  gatewayUrl: string
): OpenclawJsonConfig {
  const baseUrl = gatewayUrl.replace(/\/$/, '');
  return {
    models: {
      providers: {
        vantinel: {
          baseUrl: `${baseUrl}/v1`,
          apiKey,
          type: 'openai',
        },
      },
    },
    'diagnostics-otel': {
      enabled: true,
      endpoint: `${baseUrl}/v1/traces`,
      protocol: 'http/json',
      headers: {
        'X-Vantinel-API-Key': apiKey,
      },
    },
  };
}
