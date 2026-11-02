const buckets = new Map();

export function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes; intenta de nuevo más tarde.' } });
    }
    // Bound memory use if many unique client addresses hit the instance.
    if (buckets.size > 10000) {
      for (const [address, item] of buckets) if (item.resetAt <= now) buckets.delete(address);
    }
    next();
  };
}