/* Per-model $ / million tokens. These are placeholder rates — check your
   actual Anthropic console pricing and override with the PRICE_* env vars
   in .env before you rely on the spend cap for real budget protection.
   Keep the model ids in sync with js/ai.js's MODELS list. */
'use strict';

const DEFAULT_RATES = {
  'claude-opus-5': { in: 15, out: 75 },
  'claude-sonnet-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 0.8, out: 4 },
};

function ratesFromEnv(env) {
  const rates = {};
  Object.keys(DEFAULT_RATES).forEach((id) => {
    const envKey = id.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    const inRate = Number(env[`PRICE_${envKey}_IN`]);
    const outRate = Number(env[`PRICE_${envKey}_OUT`]);
    rates[id] = {
      in: Number.isFinite(inRate) && inRate >= 0 ? inRate : DEFAULT_RATES[id].in,
      out: Number.isFinite(outRate) && outRate >= 0 ? outRate : DEFAULT_RATES[id].out,
    };
  });
  return rates;
}

/** usage = {input_tokens, output_tokens} as returned by the Anthropic API. Returns USD. */
function estimateCost(rates, model, usage) {
  const r = rates[model] || rates['claude-sonnet-5'];
  const inTok = Number(usage && usage.input_tokens) || 0;
  const outTok = Number(usage && usage.output_tokens) || 0;
  return (inTok / 1e6) * r.in + (outTok / 1e6) * r.out;
}

module.exports = { DEFAULT_RATES, ratesFromEnv, estimateCost };
