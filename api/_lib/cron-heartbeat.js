export async function writeHeartbeat(name) {
  const url = process.env.UPSTASH_REDIS_REST_URL,
    token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Cron heartbeat storage unconfigured');
  const response = await fetch(url.replace(/\/$/, ''), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', `xbar:cron:${name}`, JSON.stringify({ completedAt: Date.now() }), 'EX', 259200]),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok || (await response.json()).result !== 'OK') throw new Error('Cron heartbeat write failed');
}
export function withCronHeartbeat(name, handler, write = writeHeartbeat) {
  return async (req, res) => {
    const end = res.end;
    let succeeded = false;
    res.end = function (body, ...args) {
      try {
        const parsed = JSON.parse(String(body));
        succeeded =
          this.statusCode === 200 &&
          parsed.ok === true &&
          (!parsed.failures || parsed.failures.length === 0) &&
          (!parsed.failed || parsed.failed === 0);
      } catch {
        succeeded = false;
      }
      return end.call(this, body, ...args);
    };
    try {
      await handler(req, res);
      if (succeeded) await write(name);
    } finally {
      res.end = end;
    }
  };
}
