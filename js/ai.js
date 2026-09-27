/* Vibe Check — optional AI (bring your own Claude API key).
   The key never leaves the browser except to go straight to api.anthropic.com.
   Everything in the app must still work when VC.ai.enabled() is false. */
(function () {
  'use strict';
  const VC = window.VC;

  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.128.0/+esm';
  const KEY_NAME = 'vibecheck.aiKey';

  const MODELS = [
    { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Best quality (recommended)', fallbacks: true, effort: true },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Faster and cheaper', fallbacks: false, effort: true },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest and cheapest', fallbacks: false, effort: false },
  ];

  let sdkPromise = null;
  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).then((m) => m.default || m.Anthropic).catch((e) => {
        sdkPromise = null;
        throw new Error('Could not load the Claude library. Check your internet connection and try again.');
      });
    }
    return sdkPromise;
  }

  /** Remove anything that looks like a secret before text is sent to the AI. */
  const REDACT_PATTERNS = [
    /sk-ant-[A-Za-z0-9_\-]{20,}/g,
    /sk-(?:proj-|live_|test_)?[A-Za-z0-9_\-]{20,}/g,
    /rk_(?:live|test)_[A-Za-z0-9]{10,}/g,
    /whsec_[A-Za-z0-9]{10,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /AIza[0-9A-Za-z_\-]{35}/g,
    /gh[pousr]_[A-Za-z0-9]{30,}/g,
    /github_pat_[A-Za-z0-9_]{30,}/g,
    /xox[abpr]-[A-Za-z0-9\-]{10,}/g,
    /eyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /((?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*["']?)([^\s"'`]{8,})/gi,
    /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi,
  ];
  function redact(text) {
    let out = String(text == null ? '' : text);
    REDACT_PATTERNS.forEach((re) => {
      out = out.replace(re, (m, p1) => (typeof p1 === 'string' && /[=:]/.test(p1) ? p1 + '[REDACTED]' : '[REDACTED]'));
    });
    return out;
  }

  /** Structured outputs need additionalProperties:false and every property required. */
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

  function friendlyError(err, Anthropic) {
    if (Anthropic) {
      if (err instanceof Anthropic.AuthenticationError) return new Error('That API key didn\'t work. Check it in Settings — it should start with "sk-ant-".');
      if (err instanceof Anthropic.PermissionDeniedError) return new Error('This API key isn\'t allowed to use that model. Try another model in Settings.');
      if (err instanceof Anthropic.NotFoundError) return new Error('That model isn\'t available on your account. Pick another model in Settings.');
      if (err instanceof Anthropic.RateLimitError) return new Error('Claude is rate-limiting you (or your account is out of credits). Wait a minute and try again.');
      if (err instanceof Anthropic.APIConnectionError) return new Error('Couldn\'t reach Claude. Check your internet connection.');
      if (err instanceof Anthropic.APIError && err.status >= 500) return new Error('Claude is having trouble right now. Try again in a moment.');
      if (err instanceof Anthropic.BadRequestError) return new Error('Claude rejected the request: ' + (err.message || 'bad request'));
    }
    return err instanceof Error ? err : new Error(String(err));
  }

  function modelInfo(id) { return MODELS.find((m) => m.id === id) || MODELS[0]; }

  async function call({ system, prompt, schema, maxTokens, effort }) {
    const key = VC.ai.getKey();
    if (!key) throw new Error('Add your Claude API key in Settings to use AI features.');
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const model = modelInfo(VC.store.settings().aiModel);

    const params = {
      model: model.id,
      max_tokens: maxTokens || 16000,
      messages: [{ role: 'user', content: redact(prompt) }],
    };
    if (system) params.system = system;
    const outputConfig = {};
    if (model.effort) outputConfig.effort = effort || 'medium';
    if (schema) outputConfig.format = { type: 'json_schema', schema: strictSchema(schema) };
    if (Object.keys(outputConfig).length) params.output_config = outputConfig;

    let response;
    try {
      if (model.fallbacks) {
        response = await client.beta.messages.create(Object.assign({}, params, {
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        }));
      } else {
        response = await client.messages.create(params);
      }
    } catch (err) {
      throw friendlyError(err, Anthropic);
    }

    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request. Try rephrasing your idea.');
    if (response.stop_reason === 'max_tokens') throw new Error('Claude\'s answer was cut off. Try a shorter request.');
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return text;
  }

  VC.ai = {
    models: MODELS,
    redact,

    getKey() {
      return VC.storage.get(KEY_NAME, null) || VC.storage.sessionGet(KEY_NAME, null) || null;
    },
    /** remember=true → localStorage (survives restarts); false → this browser tab session only. */
    setKey(key, remember) {
      key = String(key || '').trim();
      VC.storage.remove(KEY_NAME);
      VC.storage.sessionRemove(KEY_NAME);
      if (!key) return;
      if (remember) VC.storage.set(KEY_NAME, key);
      else VC.storage.sessionSet(KEY_NAME, key);
      VC.emit('ai:change', true);
    },
    clearKey() {
      VC.storage.remove(KEY_NAME);
      VC.storage.sessionRemove(KEY_NAME);
      VC.emit('ai:change', false);
    },
    enabled() { return !!VC.ai.getKey(); },
    looksLikeKey(k) { return /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(String(k || '').trim()); },
    currentModel() { return modelInfo(VC.store.settings().aiModel); },

    /** Plain-text completion. Throws friendly Error messages. */
    async text({ system, prompt, maxTokens, effort }) {
      return call({ system, prompt, maxTokens, effort });
    },

    /**
     * JSON completion that matches `schema` (JSON Schema; objects are made strict automatically).
     * Returns the parsed object.
     */
    async json({ system, prompt, schema, maxTokens, effort }) {
      const text = await call({ system, prompt, schema, maxTokens, effort });
      try {
        return JSON.parse(text);
      } catch (e) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { return JSON.parse(m[0]); } catch (e2) { /* fall through */ } }
        throw new Error('Claude returned something unexpected. Please try again.');
      }
    },

    /** Quick check that the saved key works. */
    async test() {
      const out = await call({ prompt: 'Reply with exactly: OK', maxTokens: 1000, effort: 'low' });
      return /ok/i.test(out);
    },
  };
})();
