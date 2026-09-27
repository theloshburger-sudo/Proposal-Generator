/* Vibe Check — core runtime.
   Classic script (no modules, no build step) so the app works by double-clicking index.html.
   Everything hangs off window.VC. See docs/ARCHITECTURE.md. */
(function () {
  'use strict';

  const VC = (window.VC = window.VC || {});
  VC.version = '1.0.0';
  VC.data = VC.data || {};
  VC.engine = VC.engine || {};

  /* ------------------------------------------------------------------ *
   * Safe HTML templating
   * html`<p>${userText}</p>` escapes every interpolation automatically.
   * Nested html`` results, arrays of them, and VC.raw() pass through unescaped.
   * ------------------------------------------------------------------ */
  class SafeHTML {
    constructor(s) { this.s = s; }
    toString() { return this.s; }
  }
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"'`]/g, (c) => ESC[c]);
  }
  function renderVal(v) {
    if (v == null || v === false || v === true) return '';
    if (v instanceof SafeHTML) return v.s;
    if (Array.isArray(v)) return v.map(renderVal).join('');
    return esc(v);
  }
  function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++) out += renderVal(vals[i]) + strings[i + 1];
    return new SafeHTML(out);
  }
  /** Trust a string as HTML. Only use with strings YOU wrote — never user/AI/file content. */
  function raw(s) { return new SafeHTML(String(s == null ? '' : s)); }

  VC.esc = esc;
  VC.html = html;
  VC.raw = raw;
  VC.SafeHTML = SafeHTML;
  /** Replace an element's content with a SafeHTML value. */
  VC.mount = function (el, safe) {
    if (!(safe instanceof SafeHTML)) throw new Error('VC.mount expects html`` output');
    el.innerHTML = safe.s;
    return el;
  };

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */
  VC.uid = function (prefix) {
    const rnd = (window.crypto && crypto.getRandomValues)
      ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, '0')).join('')
      : Math.random().toString(16).slice(2, 14);
    return (prefix ? prefix + '_' : '') + rnd;
  };
  VC.clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  VC.debounce = function (fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  };
  /** Rough token estimate (~4 chars per token for English/code). */
  VC.estimateTokens = (text) => Math.max(0, Math.ceil(String(text || '').length / 4));
  VC.formatDate = function (ts) {
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  };
  VC.slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'my-app';
  VC.titleCase = (s) => String(s || '').replace(/\b\w/g, (c) => c.toUpperCase());
  VC.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /** Yield to the browser so long loops don't freeze the UI. */
  VC.nextFrame = () => new Promise((r) => setTimeout(r, 0));

  VC.copyText = async function (text) {
    text = String(text == null ? '' : text);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  };

  VC.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  /** Event delegation: VC.delegate(root, 'click', '[data-action="x"]', (e, matchedEl) => {}) */
  VC.delegate = function (root, type, selector, handler) {
    const fn = (e) => {
      const t = e.target instanceof Element ? e.target.closest(selector) : null;
      if (t && root.contains(t)) handler(e, t);
    };
    root.addEventListener(type, fn);
    return () => root.removeEventListener(type, fn);
  };

  /* ------------------------------------------------------------------ *
   * Event bus
   * ------------------------------------------------------------------ */
  const listeners = {};
  VC.on = function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => VC.off(evt, fn); };
  VC.off = function (evt, fn) { listeners[evt] = (listeners[evt] || []).filter((f) => f !== fn); };
  VC.emit = function (evt, payload) {
    (listeners[evt] || []).slice().forEach((f) => { try { f(payload); } catch (e) { console.error(e); } });
  };

  /* ------------------------------------------------------------------ *
   * Safe storage (never throws)
   * ------------------------------------------------------------------ */
  VC.storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
    sessionGet(key, fallback) {
      try { const v = sessionStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    sessionSet(key, value) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { return false; }
    },
    sessionRemove(key) { try { sessionStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  /** IndexedDB key/value store for bigger blobs (scan results). Falls back to memory. */
  VC.db = (function () {
    const mem = new Map();
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve) => {
        try {
          const req = indexedDB.open('vibecheck', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
          req.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const db = await open();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const t = db.transaction('kv', mode);
          const store = t.objectStore('kv');
          const req = fn(store);
          t.oncomplete = () => resolve(req ? req.result : undefined);
          t.onerror = () => resolve(null);
          t.onabort = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return {
      async get(key) {
        const v = await tx('readonly', (s) => s.get(key));
        return v === null || v === undefined ? (mem.has(key) ? VC.clone(mem.get(key)) : undefined) : v;
      },
      async set(key, value) {
        mem.set(key, VC.clone(value));
        await tx('readwrite', (s) => s.put(value, key));
      },
      async del(key) {
        mem.delete(key);
        await tx('readwrite', (s) => s.delete(key));
      },
      async clear() {
        mem.clear();
        await tx('readwrite', (s) => s.clear());
      },
    };
  })();

  /* ------------------------------------------------------------------ *
   * App state: projects + settings (persisted to localStorage)
   * ------------------------------------------------------------------ */
  const STORE_KEY = 'vibecheck.v1';
  const defaultSettings = {
    theme: 'system',            // 'system' | 'light' | 'dark'
    aiModel: 'claude-opus-5',   // see VC.ai.models
    rememberKey: false,         // store API key in localStorage (true) or sessionStorage (false)
  };
  const state = VC.storage.get(STORE_KEY, null) || {};
  state.projects = Array.isArray(state.projects) ? state.projects : [];
  state.activeId = state.activeId || null;
  state.settings = Object.assign({}, defaultSettings, state.settings || {});

  function newProject(idea) {
    const now = Date.now();
    return {
      id: VC.uid('p'),
      name: '',
      idea: idea || '',
      createdAt: now,
      updatedAt: now,
      answers: {},             // quick-question answers — see ARCHITECTURE.md
      directions: [],          // Direction[]
      chosenDirection: null,   // Direction (possibly a mix)
      kit: null,               // Kit
      setup: { progress: {} }, // { [serviceId]: { steps: {[i]: true}, done: bool } } — keys are NEVER stored here
      prompts: { done: {} },   // { done: {[milestoneId]: true}, brief?: string }
      scans: [],               // ScanSummary[] (newest first)
      ship: { checked: {} },   // { checked: {[itemId]: true} }
    };
  }

  VC.store = {
    get state() { return state; },
    save() {
      VC.storage.set(STORE_KEY, state);
      VC.emit('store:change', state);
    },
    settings() { return state.settings; },
    setSetting(key, value) { state.settings[key] = value; this.save(); VC.emit('settings:change', state.settings); },
    projects() { return state.projects.slice().sort((a, b) => b.updatedAt - a.updatedAt); },
    active() { return state.projects.find((p) => p.id === state.activeId) || null; },
    setActive(id) { state.activeId = id; this.save(); VC.emit('project:change', this.active()); },
    create(idea) {
      const p = newProject(idea);
      state.projects.push(p);
      state.activeId = p.id;
      this.save();
      VC.emit('project:change', p);
      return p;
    },
    /** Mutate the active project: VC.store.update(p => { p.kit = ... }) */
    update(fn) {
      const p = this.active();
      if (!p) return null;
      fn(p);
      p.updatedAt = Date.now();
      this.save();
      VC.emit('project:change', p);
      return p;
    },
    remove(id) {
      state.projects = state.projects.filter((p) => p.id !== id);
      if (state.activeId === id) state.activeId = state.projects[0] ? state.projects[0].id : null;
      this.save();
      VC.emit('project:change', this.active());
    },
    exportAll() { return JSON.stringify({ app: 'vibe-check', version: VC.version, projects: state.projects }, null, 2); },
    importAll(json) {
      const data = JSON.parse(json);
      if (!data || !Array.isArray(data.projects)) throw new Error('Not a Vibe Check export file');
      const ids = new Set(state.projects.map((p) => p.id));
      data.projects.forEach((p) => {
        if (!p || typeof p !== 'object' || !p.id) return;
        const merged = Object.assign(newProject(), p);
        if (ids.has(merged.id)) merged.id = VC.uid('p');
        state.projects.push(merged);
      });
      this.save();
      VC.emit('project:change', this.active());
      return data.projects.length;
    },
    resetAll() {
      state.projects = [];
      state.activeId = null;
      this.save();
      VC.emit('project:change', null);
    },
  };

  /* ------------------------------------------------------------------ *
   * Icons (inline SVG, stroke = currentColor)
   * ------------------------------------------------------------------ */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    idea: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    kit: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M16 7l3 3M18 5l2 2"/>',
    prompt: '<path d="M4 5h16v11H8l-4 4z"/><path d="m8 9 2 2-2 2M12 13h4"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    map: '<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7 7.5 10.5 16M17 7.5 13.5 16M7.5 6h9"/>',
    rocket: '<path d="M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M14 4c3-1 6-1 6-1s0 3-1 6l-6 6-5-5z"/><circle cx="15" cy="9" r="1.5"/><path d="m9 10-4 1 3 3M14 15l-1 4-3-3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    check: '<path d="m5 12 5 5L20 7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    danger: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    success: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    sparkles: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.5M4 4v4h4M4 13a8 8 0 0 0 14.9 3.5M20 20v-4h-4"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M14.8 9.2l3.6-3.6M5.6 18.4l3.6-3.6"/>',
    wand: '<path d="m15 4 1.5 1.5M19 8l1 1M4 20 16 8M18 3v2M21 6h-2M13 3l.5 1M20 11l1 .5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>',
  };
  VC.icon = function (name, size) {
    const s = size || 18;
    const body = ICONS[name] || ICONS.info;
    return raw(`<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`);
  };
  VC.icons = Object.keys(ICONS);

  /* ------------------------------------------------------------------ *
   * Glossary — plain-English definitions for jargon. Use VC.ui.term().
   * ------------------------------------------------------------------ */
  VC.glossary = {
    'api': 'A way for your app to talk to another service (like Stripe or Claude) to use its features.',
    'api key': 'A secret password your app uses to prove who it is to a service. Anyone with it can use your account.',
    'env var': 'Environment variable: a setting (like an API key) stored outside your code so it never gets shared by accident.',
    '.env': 'A small text file that holds your environment variables (keys and settings). It must never be uploaded to GitHub.',
    '.gitignore': 'A list of files Git should never upload. Your .env file must be on it.',
    'frontend': 'The part of your app that runs in the visitor\'s browser. Anyone can see everything in it.',
    'backend': 'The part of your app that runs on a server, hidden from visitors. Secret keys belong here.',
    'rls': 'Row Level Security: database rules that decide who can read or change each row. Without it, anyone can read your whole database.',
    'database': 'Where your app stores information, like users, posts, or orders.',
    'auth': 'Authentication: the login system — sign up, log in, reset password.',
    'deploy': 'Putting your app on the internet so other people can use it.',
    'hosting': 'The service that keeps your app online (like Vercel or Netlify).',
    'repo': 'Repository: the folder that holds all your app\'s code and its history, usually on GitHub.',
    'git': 'A tool that saves snapshots of your code so you can undo mistakes and see what changed.',
    'commit': 'A saved snapshot of your code in Git, with a short note describing the change.',
    'webhook': 'A message another service sends to your app when something happens (like "payment succeeded").',
    'edge function': 'A small piece of backend code that runs on the service\'s servers — a safe place to use secret keys.',
    'rate limit': 'A cap on how often someone can use a feature, so one person can\'t run up a huge bill.',
    'token': 'The unit AI models count text in. Roughly 4 characters. More tokens = more cost.',
    'context window': 'How much text an AI can "see" at once. Long chats fill it up and the AI starts forgetting.',
    'publishable key': 'A key designed to be public (safe in the frontend), like Stripe\'s pk_ key or Supabase\'s anon key.',
    'secret key': 'A key that must stay on the server. If it leaks, someone can take full control of that service.',
    'service role key': 'Supabase\'s master key. It skips all security rules. Never put it in your frontend.',
    'cors': 'Rules that control which websites are allowed to call your backend.',
    'dependency': 'Someone else\'s code that your app uses (a "package" or "library").',
    'lockfile': 'A file (like package-lock.json) that records exact versions of your dependencies so builds are repeatable.',
    'framework': 'The toolkit your app is built with, like React, Next.js, or Vite.',
    'migration': 'A file that describes a change to your database structure (like adding a table).',
    'production': 'The live version of your app that real users see.',
    'sdk': 'A ready-made code library that makes it easy to use a service.',
  };

  /* ------------------------------------------------------------------ *
   * UI helpers — each returns html`` (SafeHTML)
   * ------------------------------------------------------------------ */
  let codeSeq = 0;
  VC.ui = {
    pageHead({ eyebrow, title, lead, actions }) {
      return html`<header class="page-head">
        <div class="spread">
          <div class="grow">
            ${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ''}
            <h1>${title}</h1>
          </div>
          ${actions ? html`<div class="row">${actions}</div>` : ''}
        </div>
        ${lead ? html`<p class="lead">${lead}</p>` : ''}
      </header>`;
    },

    /** Dark code/prompt block with a Copy button (and optional Download). */
    codeBlock(text, opts) {
      opts = opts || {};
      const id = 'code_' + (++codeSeq);
      return html`<div class="code ${opts.className || ''}">
        <div class="code-head">
          <span>${opts.title || opts.filename || ''}</span>
          <span class="row sm">
            ${opts.filename && opts.download !== false ? html`<button class="btn sm" data-download-target="#${id}" data-filename="${opts.filename}">${VC.icon('download', 14)} Download</button>` : ''}
            <button class="btn sm" data-copy-target="#${id}">${VC.icon('copy', 14)} ${opts.copyLabel || 'Copy'}</button>
          </span>
        </div>
        <pre id="${id}">${text}</pre>
      </div>`;
    },

    /** A standalone copy button that copies the given text. */
    copyButton(text, label, cls) {
      const id = 'copy_' + (++codeSeq);
      return html`<button class="btn ${cls || 'sm'}" data-copy-target="#${id}">${VC.icon('copy', 14)} ${label || 'Copy'}</button><template id="${id}">${text}</template>`;
    },

    callout(kind, content, icon) {
      const ic = icon || ({ info: 'info', success: 'success', warn: 'warn', danger: 'danger', accent: 'sparkles' })[kind] || 'info';
      return html`<div class="callout ${kind}">${VC.icon(ic, 20)}<div class="grow">${content}</div></div>`;
    },

    badge(text, color) { return html`<span class="badge ${color || ''}">${text}</span>`; },

    empty({ title, body, actionLabel, actionHref, icon }) {
      return html`<div class="empty">
        ${icon ? html`<div class="muted">${VC.icon(icon, 34)}</div>` : ''}
        <h3>${title}</h3>
        ${body ? html`<p>${body}</p>` : ''}
        ${actionLabel ? html`<a class="btn primary" href="${actionHref || '#/'}">${actionLabel}</a>` : ''}
      </div>`;
    },

    /** Jargon word with a hover definition from VC.glossary. */
    term(word, key) {
      const def = VC.glossary[(key || word).toLowerCase()];
      if (!def) return html`${word}`;
      return html`<span class="term" tabindex="0" data-def="${def}">${word}</span>`;
    },

    spinner(label) { return html`<div class="loading"><span class="spinner"></span>${label || 'Working…'}</div>`; },

    meter(pct, color) {
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      return html`<div class="meter ${color || ''}" role="progressbar" aria-valuenow="${p}" aria-valuemin="0" aria-valuemax="100"><span style="width:${p}%"></span></div>`;
    },

    difficultyBadge(d) {
      const map = { easy: ['Easy', 'green'], medium: ['Medium', 'yellow'], hard: ['Hard', 'red'] };
      const m = map[d] || [d || '—', 'gray'];
      return html`<span class="badge ${m[1]}">${m[0]}</span>`;
    },

    severityBadge(sev) {
      const map = { critical: ['Critical', 'red'], high: ['High', 'red'], medium: ['Medium', 'yellow'], low: ['Low', 'blue'], info: ['FYI', 'gray'] };
      const m = map[sev] || [sev, 'gray'];
      return html`<span class="badge ${m[1]}">${m[0]}</span>`;
    },

    visibilityBadge(v) {
      return v === 'secret'
        ? html`<span class="badge red">${VC.icon('lock', 12)} Secret — server only</span>`
        : html`<span class="badge green">${VC.icon('unlock', 12)} Public — safe in your app</span>`;
    },

    toast(message, kind) {
      let box = document.querySelector('.toasts');
      if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.textContent = message;
      box.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 2600);
      setTimeout(() => t.remove(), 3000);
    },

    /**
     * Open a modal. body is html``. actions: [{label, primary?, danger?, onClick?(close) -> false keeps it open}]
     * Returns { el, close }.
     */
    modal({ title, body, actions, wide }) {
      const back = document.createElement('div');
      back.className = 'modal-backdrop';
      const acts = (actions && actions.length) ? actions : [{ label: 'Close' }];
      VC.mount(back, html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title || 'Dialog'}" style="${wide ? 'max-width:820px' : ''}">
        <div class="modal-head"><h2 class="mb-0">${title || ''}</h2><button class="btn ghost sm" data-close aria-label="Close">${VC.icon('x', 16)}</button></div>
        <div class="modal-body">${body || ''}</div>
        <div class="modal-foot">${acts.map((a, i) => html`<button class="btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}" data-act="${i}">${a.label}</button>`)}</div>
      </div>`);
      const prevFocus = document.activeElement;
      function close() {
        back.remove();
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      }
      function onKey(e) { if (e.key === 'Escape') close(); }
      back.addEventListener('click', (e) => {
        if (e.target === back || e.target.closest('[data-close]')) return close();
        const b = e.target.closest('[data-act]');
        if (b) {
          const a = acts[Number(b.getAttribute('data-act'))];
          const r = a && a.onClick ? a.onClick(close, back) : undefined;
          if (r !== false) close();
        }
      });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(back);
      const first = back.querySelector('input, textarea, select, [data-act]');
      if (first) first.focus();
      return { el: back, close };
    },

    confirm(title, message, okLabel) {
      return new Promise((resolve) => {
        let answered = false;
        const m = VC.ui.modal({
          title,
          body: html`<p>${message}</p>`,
          actions: [
            { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
            { label: okLabel || 'Yes', primary: true, onClick: () => { answered = true; resolve(true); } },
          ],
        });
        const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!answered) resolve(false); } });
        obs.observe(document.body, { childList: true });
      });
    },
  };

  /* Global copy / download handlers for VC.ui.codeBlock + copyButton */
  document.addEventListener('click', async (e) => {
    const c = e.target instanceof Element ? e.target.closest('[data-copy-target]') : null;
    if (c) {
      const src = document.querySelector(c.getAttribute('data-copy-target'));
      if (!src) return;
      const text = src.tagName === 'TEMPLATE' ? src.content.textContent : src.textContent;
      const ok = await VC.copyText(text);
      if (ok) {
        c.classList.add('copied');
        const old = c.innerHTML;
        c.innerHTML = VC.icon('check', 14).s + ' Copied';
        setTimeout(() => { c.classList.remove('copied'); c.innerHTML = old; }, 1400);
      } else {
        VC.ui.toast('Could not copy — select the text and copy it manually.', 'error');
      }
      return;
    }
    const d = e.target instanceof Element ? e.target.closest('[data-download-target]') : null;
    if (d) {
      const src = document.querySelector(d.getAttribute('data-download-target'));
      if (src) VC.download(d.getAttribute('data-filename') || 'file.txt', src.textContent);
    }
  });

  /* ------------------------------------------------------------------ *
   * Views + router
   * ------------------------------------------------------------------ */
  const views = {};
  /**
   * VC.registerView({
   *   id: 'kit', title: 'Build Kit', icon: 'kit',
   *   nav: { group: 'journey', order: 2 } | { group: 'tools', order: 1 } | null,
   *   status(project) -> 'done' | 'todo',   // optional, drives sidebar checkmarks
   *   render(el, ctx)                        // ctx = { project, params, go, rerender }
   * })
   */
  VC.registerView = function (def) {
    if (!def || !def.id || typeof def.render !== 'function') throw new Error('registerView needs {id, render}');
    views[def.id] = def;
  };
  VC.views = views;

  VC.parseRoute = function () {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const params = {};
    if (query) new URLSearchParams(query).forEach((v, k) => { params[k] = v; });
    return { id: path || 'home', params };
  };
  VC.go = function (id, params) {
    const q = params ? '?' + new URLSearchParams(params).toString() : '';
    const target = '#/' + (id === 'home' ? '' : id) + q;
    if (location.hash === target) VC.render();
    else location.hash = target;
  };

  let currentViewId = null;
  VC.render = function () {
    const route = VC.parseRoute();
    const view = views[route.id] || views.home;
    const main = document.getElementById('main');
    if (!main || !view) return;
    const old = document.getElementById('view');
    const el = document.createElement('div');
    el.id = 'view';
    el.className = 'view';
    if (old) old.replaceWith(el); else main.appendChild(el);
    const changed = currentViewId !== view.id;
    currentViewId = view.id;
    const ctx = {
      project: VC.store.active(),
      params: route.params,
      go: VC.go,
      rerender: () => VC.render(),
    };
    try {
      view.render(el, ctx);
    } catch (err) {
      console.error(err);
      VC.mount(el, html`${VC.ui.callout('danger', html`<strong>Something broke on this page.</strong><br><span class="small mono break">${String(err && err.message || err)}</span>`)}`);
    }
    document.title = (view.title ? view.title + ' · ' : '') + 'Vibe Check';
    VC.renderNav();
    if (changed) window.scrollTo(0, 0);
    document.querySelector('.sidebar') && document.querySelector('.sidebar').classList.remove('open');
  };

  VC.renderNav = function () {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const route = VC.parseRoute();
    const p = VC.store.active();
    const list = Object.values(views).filter((v) => v.nav);
    const group = (g) => list.filter((v) => v.nav.group === g).sort((a, b) => (a.nav.order || 0) - (b.nav.order || 0));
    const journey = group('journey');
    const tools = group('tools');
    const item = (v, i) => {
      let status = 'todo';
      try { status = p && v.status ? v.status(p) : 'todo'; } catch (e) { /* ignore */ }
      const active = route.id === v.id || (route.id === 'home' && v.id === 'home');
      return html`<a class="nav-item ${active ? 'active' : ''} ${status === 'done' ? 'done' : ''}" href="#/${v.id === 'home' ? '' : v.id}">
        ${i != null ? html`<span class="nav-num">${status === 'done' ? VC.icon('check', 12) : i + 1}</span>` : VC.icon(v.icon || 'info')}
        <span>${v.navTitle || v.title}</span>
      </a>`;
    };
    VC.mount(nav, html`
      ${views.home ? item(views.home) : ''}
      <div class="nav-label">Your build</div>
      ${journey.map((v, i) => item(v, i))}
      ${tools.length ? html`<div class="nav-label">Tools</div>${tools.map((v) => item(v))}` : ''}
    `);
    const pill = document.getElementById('project-pill');
    if (pill) {
      VC.mount(pill, p
        ? html`<span>Current project</span><strong title="${p.name || p.idea}">${p.name || p.idea || 'Untitled'}</strong>`
        : html`<span>No project yet</span>`);
    }
  };

  VC.applyTheme = function () {
    const t = VC.store.settings().theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  };

  VC.start = function () {
    VC.applyTheme();
    window.addEventListener('hashchange', VC.render);
    const toggle = document.getElementById('menu-toggle');
    if (toggle) toggle.addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
    VC.on('project:change', () => VC.renderNav());
    VC.render();
  };
})();
