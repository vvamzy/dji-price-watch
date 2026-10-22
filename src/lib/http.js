const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL as text with a hard timeout and bounded retries.
 * Throws an Error with a short, log-safe message on failure.
 */
export async function fetchText(url, { timeoutMs = 20000, retries = 2, headers = {} } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'en-IN,en;q=0.9',
          'cache-control': 'no-cache',
          ...headers,
        },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${new URL(url).hostname}`);
      }

      const body = await res.text();
      if (!body || body.length < 200) {
        throw new Error(`short response (${body.length} bytes) from ${new URL(url).hostname}`);
      }
      return body;
    } catch (err) {
      lastError = err.name === 'AbortError'
        ? new Error(`timeout after ${timeoutMs}ms for ${new URL(url).hostname}`)
        : err;
      if (attempt < retries) await SLEEP(1200 * (attempt + 1) + Math.random() * 800);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

export function normalise(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
