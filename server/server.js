/* Vibe Check — AI backend proxy.
   Holds the real Anthropic API key server-side so it never has to live in
   the browser. Rate-limits by IP and enforces a shared daily spend cap.
   See README.md for env vars and Render deploy steps. */
'use strict';

const http = require('http');
const Anthropic = require('@anthropic-ai/sdk');
const { createRateLimiter } = require('./lib/rateLimiter');
const { createSpendCap } = require('./lib/spendCap');
const { ratesFromEnv, estimateCost } = require('./lib/pricing');

const PORT = Number(process.env.PORT) || 8787;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const RATE_LIMIT_PER_DAY = Number(process.env.RATE_LIMIT_PER_DAY) || 20;
const DAILY_SPEND_CAP_USD = Number(process.env.DAILY_SPEND_CAP_USD) || 5;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_BODY_BYTES = 100 * 1024;
const MAX_TOKENS_CEILING = 16000;

if (!API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in, or set it in your host\'s environment variables.');
  process.exit(1);
}

const client = new Anthropic({ apiKey: API_KEY, maxRetries: 2 });
const rateLimiter = createRateLimiter(RATE_LIMIT_PER_DAY);
const spendCap = createSpendCap(DAILY_SPEND_CAP_USD);
const rates = ratesFromEnv(process.env);

/* Keep in sync with js/ai.js's MODELS list — this is the whitelist of
   models a client may ask for, and how each one is called. */
const MODELS = {
  'claude-opus-5': { fallbacks: true, effort: true },
  'claude-sonnet-5': { fallbacks: false, effort: true },
  'claude-haiku-4-5': { fallbacks: false, effort: false },
};
const DEFAULT_MODEL = 'claude-sonnet-5';

/** Structured outputs need additionalProperties:false and every property required (mirrors js/ai.js). */
function strictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const s = Array.isArray(schema) ? schema.map(strictSchema) : Object.assign({}, schema);
  if (!Array.isArray(s)) {
    if (s.type === 'object' && s.properties) {
      const props = {};
      Object.keys(s.properties).forEach((k) => { props[k] = strictSchema(s.properties[k]); });
      s.properties = props;
      s.required = Object.keys(props);
      s.additionalProperties = false;
    }
    if (s.items) s.items = strictSchema(s.items);
  }
  return s;
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return { status: 500, message: 'The backend\'s Claude key isn\'t working. (Server misconfiguration — check ANTHROPIC_API_KEY.)' };
  if (err instanceof Anthropic.PermissionDeniedError) return { status: 500, message: 'The backend\'s Claude key can\'t use that model. (Server misconfiguration.)' };
  if (err instanceof Anthropic.NotFoundError) return { status: 500, message: 'That model isn\'t available to the backend right now.' };
  if (err instanceof Anthropic.RateLimitError) return { status: 503, message: 'Shared Claude access is busy right now. Try again in a minute, or add your own key in Settings.' };
  if (err instanceof Anthropic.APIConnectionError) return { status: 502, message: 'The backend couldn\'t reach Claude. Try again shortly.' };
  if (err instanceof Anthropic.APIError && err.status >= 500) return { status: 502, message: 'Claude is having trouble right now. Try again in a moment.' };
  if (err instanceof Anthropic.BadRequestError) return { status: 400, message: 'That request was rejected: ' + (err.message || 'bad request') };
  return { status: 500, message: 'Something went wrong on the backend.' };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

async function handleComplete(req, res) {
  const ip = clientIp(req);

  if (spendCap.isCapped()) {
    sendJson(res, 503, { error: 'The shared daily AI budget has been reached. Try again tomorrow, or add your own key in Settings.' });
    return;
  }

  let body;
  try { body = await readJsonBody(req); }
  catch (e) { sendJson(res, e.status || 400, { error: e.message }); return; }

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) { sendJson(res, 400, { error: '"prompt" is required.' }); return; }

  const limit = rateLimiter.consume(ip);
  if (!limit.allowed) {
    sendJson(res, 429, { error: `You've used today's ${RATE_LIMIT_PER_DAY} free AI requests from this network. Try again tomorrow, or add your own key in Settings for unlimited use.` });
    return;
  }

  const system = typeof body.system === 'string' ? body.system : undefined;
  const maxTokens = Math.min(Number(body.maxTokens) || 4000, MAX_TOKENS_CEILING);
  const effort = ['low', 'medium', 'high'].includes(body.effort) ? body.effort : 'medium';
  const modelId = Object.prototype.hasOwnProperty.call(MODELS, body.model) ? body.model : DEFAULT_MODEL;
  const model = MODELS[modelId];

  const params = {
    model: modelId,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) params.system = system;
  const outputConfig = {};
  if (model.effort) outputConfig.effort = effort;
  if (body.schema) outputConfig.format = { type: 'json_schema', schema: strictSchema(body.schema) };
  if (Object.keys(outputConfig).length) params.output_config = outputConfig;

  try {
    let response;
    if (model.fallbacks) {
      response = await client.beta.messages.create(Object.assign({}, params, {
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      }));
    } else {
      response = await client.messages.create(params);
    }

    if (response.usage) spendCap.record(estimateCost(rates, modelId, response.usage));

    if (response.stop_reason === 'refusal') { sendJson(res, 200, { error: 'Claude declined this request. Try rephrasing.' }); return; }
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    sendJson(res, 200, { text });
  } catch (err) {
    const friendly = friendlyError(err);
    console.error('[backend] Claude call failed:', err && err.message);
    sendJson(res, friendly.status, { error: friendly.message });
  }
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && req.url === '/health') { sendJson(res, 200, { ok: true }); return; }
  if (req.method === 'POST' && req.url === '/v1/complete') { handleComplete(req, res).catch((e) => { console.error(e); sendJson(res, 500, { error: 'Unexpected server error.' }); }); return; }
  sendJson(res, 404, { error: 'Not found' });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Vibe Check AI backend listening on :${PORT} (rate limit ${RATE_LIMIT_PER_DAY}/day/IP, spend cap $${DAILY_SPEND_CAP_USD}/day)`);
  });
}

module.exports = { server, MODELS, strictSchema, friendlyError, clientIp };
