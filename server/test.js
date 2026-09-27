/* Self-check for the backend's pure logic — no network, no real API key
   needed. Run with `node test.js` (or `npm test`). */
'use strict';
const assert = require('assert');
const { DailyBucket, utcDay } = require('./lib/dailyBucket');
const { createRateLimiter } = require('./lib/rateLimiter');
const { createSpendCap } = require('./lib/spendCap');
const { ratesFromEnv, estimateCost, DEFAULT_RATES } = require('./lib/pricing');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok — ${name}`);
}

// --- DailyBucket ---
test('DailyBucket adds within a day and rolls over on a new UTC day', () => {
  const b = new DailyBucket();
  const day1 = Date.parse('2026-01-01T12:00:00Z');
  const day2 = Date.parse('2026-01-02T00:00:01Z');
  assert.strictEqual(b.get('x', day1), 0);
  assert.strictEqual(b.add('x', 3, day1), 3);
  assert.strictEqual(b.add('x', 2, day1), 5);
  assert.strictEqual(b.get('x', day1), 5);
  assert.strictEqual(b.get('x', day2), 0, 'a new UTC day must reset the bucket');
});

test('utcDay formats as YYYY-MM-DD', () => {
  assert.strictEqual(utcDay(Date.parse('2026-03-05T23:59:59Z')), '2026-03-05');
});

// --- rateLimiter ---
test('rateLimiter allows up to the limit, then blocks, per IP', () => {
  const rl = createRateLimiter(3);
  const now = Date.now();
  assert.strictEqual(rl.consume('1.2.3.4', now).allowed, true);
  assert.strictEqual(rl.consume('1.2.3.4', now).allowed, true);
  const third = rl.consume('1.2.3.4', now);
  assert.strictEqual(third.allowed, true);
  assert.strictEqual(third.remaining, 0);
  const fourth = rl.consume('1.2.3.4', now);
  assert.strictEqual(fourth.allowed, false, 'a 4th request over a limit of 3 must be blocked');
});

test('rateLimiter tracks each IP independently', () => {
  const rl = createRateLimiter(1);
  const now = Date.now();
  assert.strictEqual(rl.consume('1.1.1.1', now).allowed, true);
  assert.strictEqual(rl.consume('1.1.1.1', now).allowed, false);
  assert.strictEqual(rl.consume('2.2.2.2', now).allowed, true, 'a different IP must have its own quota');
});

// --- spendCap ---
test('spendCap trips once recorded spend reaches the cap', () => {
  const cap = createSpendCap(1.0);
  const now = Date.now();
  assert.strictEqual(cap.isCapped(now), false);
  cap.record(0.6, now);
  assert.strictEqual(cap.isCapped(now), false);
  cap.record(0.5, now);
  assert.strictEqual(cap.isCapped(now), true, 'spend at/above the cap must disable the endpoint');
});

test('spendCap of 0 or less means "no cap"', () => {
  const cap = createSpendCap(0);
  cap.record(1000, Date.now());
  assert.strictEqual(cap.isCapped(), false);
});

test('spendCap resets on a new UTC day', () => {
  const cap = createSpendCap(1.0);
  const day1 = Date.parse('2026-01-01T12:00:00Z');
  const day2 = Date.parse('2026-01-02T00:00:01Z');
  cap.record(1.0, day1);
  assert.strictEqual(cap.isCapped(day1), true);
  assert.strictEqual(cap.isCapped(day2), false);
});

// --- pricing ---
test('estimateCost matches a hand-computed dollar amount', () => {
  const rates = ratesFromEnv({});
  const usd = estimateCost(rates, 'claude-sonnet-5', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.strictEqual(usd, DEFAULT_RATES['claude-sonnet-5'].in + DEFAULT_RATES['claude-sonnet-5'].out);
});

test('ratesFromEnv applies PRICE_* overrides and falls back to defaults for the rest', () => {
  const rates = ratesFromEnv({ PRICE_CLAUDE_SONNET_5_IN: '1', PRICE_CLAUDE_SONNET_5_OUT: '2' });
  assert.strictEqual(rates['claude-sonnet-5'].in, 1);
  assert.strictEqual(rates['claude-sonnet-5'].out, 2);
  assert.strictEqual(rates['claude-opus-5'].in, DEFAULT_RATES['claude-opus-5'].in, 'unset models keep their default rate');
});

test('estimateCost falls back to sonnet pricing for an unknown model id', () => {
  const rates = ratesFromEnv({});
  const usd = estimateCost(rates, 'not-a-real-model', { input_tokens: 1_000_000, output_tokens: 0 });
  assert.strictEqual(usd, DEFAULT_RATES['claude-sonnet-5'].in);
});

// --- server.js exports (pure helpers only; importing doesn't start listening) ---
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-placeholder-not-real';
const { MODELS, strictSchema, friendlyError, clientIp } = require('./server');
const Anthropic = require('@anthropic-ai/sdk');

test('MODELS whitelist matches js/ai.js\'s model ids', () => {
  assert.deepStrictEqual(Object.keys(MODELS).sort(), ['claude-haiku-4-5', 'claude-opus-5', 'claude-sonnet-5']);
});

test('strictSchema makes every object property required with additionalProperties:false', () => {
  const out = strictSchema({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } });
  assert.deepStrictEqual(out.required, ['a', 'b']);
  assert.strictEqual(out.additionalProperties, false);
});

test('strictSchema recurses into array items', () => {
  const out = strictSchema({ type: 'array', items: { type: 'object', properties: { a: { type: 'string' } } } });
  assert.strictEqual(out.items.additionalProperties, false);
});

test('friendlyError maps a rate-limit error to a retryable 503', () => {
  const err = Object.create(Anthropic.RateLimitError.prototype);
  const { status } = friendlyError(err);
  assert.strictEqual(status, 503);
});

test('friendlyError maps an unrecognized error to a generic 500 without leaking details', () => {
  const { status, message } = friendlyError(new Error('some internal detail'));
  assert.strictEqual(status, 500);
  assert.ok(!message.includes('some internal detail'), 'raw error text must not leak to the client');
});

test('clientIp prefers X-Forwarded-For (Render sits behind a proxy), falls back to the socket', () => {
  assert.strictEqual(clientIp({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: {} }), '9.9.9.9');
  assert.strictEqual(clientIp({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
});

console.log(`\n${passed} checks passed.`);
