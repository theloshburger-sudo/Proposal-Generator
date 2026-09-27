/* One shared daily $ budget across all callers. */
'use strict';
const { DailyBucket } = require('./dailyBucket');

const KEY = 'spend';

function createSpendCap(capUsd) {
  const bucket = new DailyBucket();
  return {
    isCapped(now = Date.now()) {
      return capUsd > 0 && bucket.get(KEY, now) >= capUsd;
    },
    spentToday(now = Date.now()) {
      return bucket.get(KEY, now);
    },
    /** Records cost actually incurred (call after a successful, billed API response). */
    record(usd, now = Date.now()) {
      return bucket.add(KEY, Math.max(0, usd), now);
    },
    cap: capUsd,
  };
}

module.exports = { createSpendCap };
