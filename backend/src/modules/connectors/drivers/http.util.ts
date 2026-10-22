export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let response = await fetch(url, init);
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') || '2');
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 60) * 1000));
    response = await fetch(url, init);
  }
  const text = await response.text();
  let body: unknown = undefined;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
  if (!response.ok) {
    const message = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`${response.status} ${response.statusText}: ${message.slice(0, 1200)}`);
  }
  return body as T;
}

export function requiredString(config: Record<string, unknown>, key: string, fallbackEnv?: string): string {
  const value = typeof config[key] === 'string' ? String(config[key]).trim() : '';
  const env = fallbackEnv ? String(process.env[fallbackEnv] || '').trim() : '';
  if (!value && !env) throw new Error(`Missing connector setting: ${key}${fallbackEnv ? ` or ${fallbackEnv}` : ''}`);
  return value || env;
}

export function optionalBoolean(config: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = config[key];
  return typeof v === 'boolean' ? v : fallback;
}

export function optionalNumber(config: Record<string, unknown>, key: string, fallback: number, min = 1, max = 1000): number {
  const v = Number(config[key]);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

export function isoDate(value: string | number | undefined | null): Date | undefined {
  if (value === undefined || value === null) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function textFromAdf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromAdf).join(' ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === 'string') return obj.text;
    return textFromAdf(obj.content);
  }
  return '';
}
