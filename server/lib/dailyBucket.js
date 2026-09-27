/* A tiny in-memory counter keyed by UTC day, so it resets itself at midnight
   UTC with no cron job. Shared by the rate limiter (counts per IP) and the
   spend cap (one running total). Old days are pruned lazily on write so the
   map can't grow forever.
   ponytail: in-memory only, per process. On Render's free tier the process
   can restart (deploy, sleep/wake), which resets counts early — acceptable
   for a soft daily cap, not a hard security boundary. Upgrade to Redis or a
   tiny SQLite file if you need counts to survive restarts. */
'use strict';

function utcDay(now) {
  return new Date(now).toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

class DailyBucket {
  constructor() {
    this.day = null;
    this.values = new Map();
  }

  /** Clears everything from a previous day before reading/writing today's values. */
  _rollIfNeeded(now) {
    const today = utcDay(now);
    if (this.day !== today) {
      this.day = today;
      this.values = new Map();
    }
  }

  get(key, now = Date.now()) {
    this._rollIfNeeded(now);
    return this.values.get(key) || 0;
  }

  add(key, amount, now = Date.now()) {
    this._rollIfNeeded(now);
    const next = (this.values.get(key) || 0) + amount;
    this.values.set(key, next);
    return next;
  }
}

module.exports = { DailyBucket, utcDay };
