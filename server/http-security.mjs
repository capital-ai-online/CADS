import { createHash } from 'node:crypto';

// Bounded, process-local limiter. Never trusts client-supplied forwarding headers.
export function createLimiter(limit, windowMs = 60_000, maxKeys = 1024, now = Date.now) {
  const buckets = new Map();
  return (key = 'global') => {
    const time = now();
    for (const [id, value] of buckets) if (value.until <= time) buckets.delete(id);
    const id = createHash('sha256').update(key).digest('hex');
    let value = buckets.get(id);
    if (!value) {
      if (buckets.size >= maxKeys) return false;
      value = { count: 0, until: time + windowMs }; buckets.set(id, value);
    }
    return ++value.count <= limit;
  };
}

export function secureUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('invalid_config_url');
  return url;
}

export async function boundedJson(response, maxBytes = 65536) {
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('upstream_unavailable'); }
  const reader = response.body.getReader();
  let size = 0; const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > maxBytes) throw new Error('upstream_too_large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel(); }
}

export function readJson(req, maxBytes = 16384) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') return Promise.reject(new Error('invalid_json'));
  return new Promise((resolve, reject) => {
    let bytes = 0, content = '', done = false;
    const finish = (error, result) => {
      if (done) return; done = true; clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', errorHandler);
      req.removeListener('aborted', aborted);
      if (error) { req.resume(); reject(error); } else resolve(result);
    };
    const data = chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) return finish(new Error('body_too_large'));
      content += chunk;
    };
    const end = () => { try { finish(null, JSON.parse(content)); } catch { finish(new Error('invalid_json')); } };
    const errorHandler = () => finish(new Error('invalid_json'));
    const aborted = () => finish(new Error('invalid_json'));
    const timer = setTimeout(() => finish(new Error('body_timeout')), 5000).unref();
    req.on('data', data); req.once('end', end); req.once('error', errorHandler); req.once('aborted', aborted);
  });
}
