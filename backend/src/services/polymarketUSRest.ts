import { createPrivateKey, sign } from 'crypto';

/** Execution transport uses one POST only, rejects redirects, and keeps its
 * deadline active while reading the bounded response body. No automatic retry. */
export function bindPolymarketUSRest(keyId: string, secret: string) {
  if (!/^[a-f0-9-]{36}$/i.test(keyId) || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret.trim())) throw new Error('Polymarket US credential format unavailable');
  const seed = Buffer.from(secret.trim(), 'base64');
  if (![32, 64].includes(seed.length)) throw new Error('Polymarket US credential format unavailable');
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)]), format: 'der', type: 'pkcs8' });
  seed.fill(0);
  return async (method: 'GET' | 'POST', pathname: string, body?: unknown, query?: Record<string, string | number>): Promise<any> => {
    if (!/^\/v1\/[a-zA-Z0-9/_-]+$/.test(pathname)) throw new Error('Invalid Polymarket US resource path');
    const url = new URL(pathname, 'https://api.polymarket.us');
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, String(value));
    const timestamp = String(Date.now());
    const signature = sign(null, Buffer.from(timestamp + method + pathname), key).toString('base64');
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timedOut = false;
    let timeoutReject!: (reason: Error) => void;
    const timeoutPromise = new Promise<never>((_resolve, reject) => { timeoutReject = reject; });
    const deadline = setTimeout(() => {
      timedOut = true; controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
      timeoutReject(new Error('Polymarket US response deadline exceeded'));
    }, 10000);
    try {
      const response = await Promise.race([fetch(url, { method, redirect: 'error', signal: controller.signal,
        headers: { 'X-PM-Access-Key': keyId, 'X-PM-Timestamp': timestamp, 'X-PM-Signature': signature, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), timeoutPromise]);
      if (!response.ok) throw new Error(`Polymarket US request failed (${response.status})`);
      if (!response.body) throw new Error('Polymarket US response body unavailable');
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const chunk = await Promise.race([reader.read(), timeoutPromise]);
        if (timedOut) throw new Error('Polymarket US response deadline exceeded');
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 1048576) throw new Error('Polymarket US response exceeded its bound');
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('Polymarket US transport failed; submission outcome may be unknown');
    } finally {
      clearTimeout(deadline);
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
    }
  };
}
