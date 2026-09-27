/* Per-IP daily request limit. */
'use strict';
const { DailyBucket } = require('./dailyBucket');

function createRateLimiter(limitPerDay) {
  const bucket = new DailyBucket();
  return {
    /** Counts one request against this IP's daily quota and reports whether it was allowed. */
    consume(ip, now = Date.now()) {
      const used = bucket.get(ip, now);
      if (used >= limitPerDay) return { allowed: false, remaining: 0, limit: limitPerDay };
      const next = bucket.add(ip, 1, now);
      return { allowed: true, remaining: Math.max(0, limitPerDay - next), limit: limitPerDay };
    },
  };
}

module.exports = { createRateLimiter };
