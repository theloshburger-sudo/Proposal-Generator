/* Vibe Check — Setup wizard (journey step 3).
   Walks through every account and API key the kit needs: how to get each key,
   whether it's public or secret, a live "does this look right?" check, exactly
   where it goes in THIS builder, and a generated environment file.

   Pasted keys live ONLY in the module-level `pasted` Map below. They are never
   written to localStorage, the project, or VC.db, and they vanish when the tab
   is closed or reloaded. Only step ticks and "done" flags are saved, in
   project.setup.progress. See docs/ARCHITECTURE.md. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  /* ------------------------------------------------------------------ *
   * Module state. Survives re-renders, never persisted.
   * ------------------------------------------------------------------ */
  const pasted = new Map();     // 'serviceId::keyId' -> pasted value. The ONLY place keys live.
  const revealed = new Set();   // key refs whose input currently shows plain text
  const openCards = new Set();  // unit ids whose card is expanded
  let showValues = false;       // env preview / table shows real values instead of masked ones
  let exported = false;         // env file was copied or downloaded → show the "keep it private" warning
  let owner;                    // project id the state above belongs to (reset when the project changes)
  let openedFor = null;         // which mode/project we already picked a default open card for
  let linkedFor = null;         // the #/setup?service=… link we already scrolled to (reset on navigation)
  window.addEventListener('hashchange', () => { linkedFor = null; });
  let last = null;              // context of the latest render, used by live (in-place) updates
  const localProgress = {};     // step ticks when there is no active project (not saved)

  /* Standalone mode (no kit yet): the user picks a builder and services. */
  const standalone = { builderId: null, framework: null, services: new Set() };

  const FRAMEWORKS = [
    { id: 'vite', label: 'React + Vite (most common)' },
    { id: 'next', label: 'Next.js' },
    { id: 'expo', label: 'Expo (phone app)' },
    { id: 'node', label: 'Not sure / something else' },
  ];
  const FRAMEWORK_NAMES = { vite: 'React + Vite', next: 'Next.js', expo: 'Expo', node: 'a server or unknown framework' };

  /* Placement advice when we don't know the builder. */
  const GENERIC = {
    publicKeys: ['Add them to your app\'s environment settings: a .env file, or your builder\'s settings or secrets panel.'],
    secretKeys: ['Put them only where server code runs: your builder\'s secrets panel, or a .env file that is never uploaded.'],
    deployVars: ['Your hosting service\'s "Environment Variables" page (for example Vercel → Project → Settings → Environment Variables).'],
  };

  /* A couple of visual one-offs that have no class in styles.css. */
  const NUM_STYLE = 'width:28px;height:28px;flex:0 0 28px;border-radius:50%;display:grid;place-items:center;font-size:.8rem;font-weight:700;';
  const ICON_BOX = 'width:34px;height:34px;flex:0 0 34px;border-radius:10px;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent)';

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  const arr = (v) => (Array.isArray(v) ? v : []);
  const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  const refOf = (service, key) => service.id + '::' + key.id;
  const attrSel = (name, value) => '[' + name + '="' + String(value).replace(/["\\]/g, '\\$&') + '"]';
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
  const oneLine = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  function safeUrl(u) { return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null; }
  /** "Publishable key" → "publishable key", but leave "API key" alone. */
  function softLabel(s) { s = String(s || 'key'); return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; }
  function compile(src) { try { return src ? new RegExp(src) : null; } catch (e) { return null; } }
  function matchesFormat(key, v) { const re = compile(key && key.format && key.format.regex); return re ? re.test(v) : false; }

  /* ------------------------------------------------------------------ *
   * Data lookups (guarded: sibling modules may not be loaded)
   * ------------------------------------------------------------------ */
  const findById = (list, id) => listOf(list).find((x) => x && x.id === id) || null;
  function serviceById(id) {
    if (!id) return null;
    if (typeof VC.data.serviceById === 'function') { const s = VC.data.serviceById(id); if (s) return s; }
    return findById(VC.data.services, id);
  }
  function builderById(id) {
    if (!id) return null;
    if (typeof VC.data.builderById === 'function') { const b = VC.data.builderById(id); if (b) return b; }
    return findById(VC.data.builders, id);
  }
  function categoryById(id) {
    if (typeof VC.data.categoryById === 'function') return VC.data.categoryById(id);
    return findById(VC.data.categories, id);
  }
  const kitEngine = () => (VC.engine && VC.engine.kit) || null;

  /** Env variable name for this key in this framework. */
  function envName(service, key, framework) {
    const k = kitEngine();
    if (k && typeof k.envName === 'function') {
      try { const n = k.envName(key, framework); if (n && typeof n === 'string') return n; } catch (e) { /* fall back */ }
    }
    const env = key.env || {};
    return env[framework] || env.node || env.vite || env.next
      || (service.id + '_' + (key.id || 'key')).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  /* ------------------------------------------------------------------ *
   * Which services, in which order
   * ------------------------------------------------------------------ */
  /** GitHub first (after the builder), then everything else in its original order. */
  function githubFirst(list) {
    return list.slice().sort((a, b) => (a.id === 'github' ? 0 : 1) - (b.id === 'github' ? 0 : 1));
  }

  /** Unique kit services, deduped by serviceId, with the kit's reasons merged in. */
  function kitEntries(kit) {
    const byId = new Map();
    arr(kit.services).forEach((r) => {
      if (!r || !r.serviceId) return;
      let e = byId.get(r.serviceId);
      if (!e) { e = { id: r.serviceId, reasons: [], categories: [], required: false }; byId.set(r.serviceId, e); }
      if (r.reason && e.reasons.indexOf(r.reason) === -1) e.reasons.push(r.reason);
      if (r.category && e.categories.indexOf(r.category) === -1) e.categories.push(r.category);
      if (r.required !== false) e.required = true;
    });
    // Prefer the kit engine's deduped list (its order and data) when it's available.
    let fromEngine = null;
    const k = kitEngine();
    if (k && typeof k.uniqueServices === 'function') {
      try { fromEngine = arr(k.uniqueServices(kit)).filter((s) => s && s.id); } catch (e) { fromEngine = null; }
    }
    const ids = fromEngine && fromEngine.length ? fromEngine.map((s) => s.id) : Array.from(byId.keys());
    const list = ids.map((id) => Object.assign(
      byId.get(id) || { id, reasons: [], categories: [], required: true },
      { service: (fromEngine && findById(fromEngine, id)) || serviceById(id) }
    ));
    return githubFirst(list);
  }

  /** Services the user ticked in standalone mode, in catalog order. */
  function standaloneEntries() {
    const list = listOf(VC.data.services)
      .filter((s) => s && standalone.services.has(s.id))
      .map((s) => ({ id: s.id, service: s, reasons: [], categories: arr(s.categories), required: true }));
    return githubFirst(list);
  }

  /** Steps for the "create your builder account" card (builders have no steps in the data). */
  function builderSteps(builder, project) {
    const steps = [{
      title: 'Create your free ' + builder.name + ' account',
      detail: builder.pricing ? builder.pricing + '. The free plan is plenty to start.' : 'The free plan is plenty to start.',
      url: builder.url,
    }];
    if (builder.versionControl) steps.push({ title: 'Learn how to save and undo your work', detail: builder.versionControl });
    const cf = builder.contextFile;
    if (cf && (cf.how || cf.name)) {
      steps.push({
        title: 'Find where the project brief goes' + (cf.name ? ' (' + cf.name + ')' : ''),
        detail: (cf.how ? oneLine(cf.how) + ' ' : '') + 'You\'ll paste a brief about ' + ((project && project.name) || 'your app') + ' there in the next step.',
      });
    }
    return steps;
  }

  /** Everything the page walks through, in order: [{id, kind, name, tagline, steps, entry?, builder?}] */
  function buildUnits(kit, builder, entries, project) {
    const units = [];
    if (kit && builder) {
      units.push({
        id: 'builder:' + builder.id, kind: 'builder', builder,
        name: 'Your ' + builder.name + ' account', tagline: builder.tagline || 'Where you\'ll build the app',
        steps: builderSteps(builder, project), required: true,
      });
    }
    entries.forEach((e) => {
      const s = e.service;
      units.push({
        id: e.id, kind: 'service', entry: e, service: s || null,
        name: s ? s.name : VC.titleCase(String(e.id).replace(/-/g, ' ')),
        tagline: s ? (s.tagline || '') : 'Guide not available yet',
        steps: s ? arr(s.steps).filter((st) => st && st.title) : [], required: e.required,
      });
    });
    return units;
  }

  /* ------------------------------------------------------------------ *
   * Progress (step ticks + done flags). Saved in the project when there
   * is one; otherwise kept in memory for this tab.
   * ------------------------------------------------------------------ */
  function progressOf(unitId) {
    const p = VC.store.active();
    const src = p ? ((p.setup && p.setup.progress) || {}) : localProgress;
    const cur = src[unitId] || {};
    return { steps: cur.steps || {}, done: !!cur.done };
  }
  function writeProgress(unitId, fn) {
    const apply = (all) => {
      const cur = all[unitId] || (all[unitId] = { steps: {}, done: false });
      if (!cur.steps || typeof cur.steps !== 'object') cur.steps = {};
      fn(cur);
    };
    if (VC.store.active()) {
      VC.store.update((p) => {
        if (!p.setup || typeof p.setup !== 'object') p.setup = { progress: {} };
        if (!p.setup.progress || typeof p.setup.progress !== 'object') p.setup.progress = {};
        apply(p.setup.progress);
      });
    } else {
      apply(localProgress);
    }
  }
  const stepsDone = (u, prog) => u.steps.filter((_, i) => prog.steps[i]).length;

  /* ------------------------------------------------------------------ *
   * Key checker. Uses VC.data.checkKey (knowledge module) when present,
   * with a local fallback, then adds same-service swap detection and
   * test/live mode notes. Runs offline; never stores or sends the value.
   * Returns { level: 'empty'|'ok'|'warn'|'bad'|'danger', message }.
   * ------------------------------------------------------------------ */
  function jwtRole(value) {
    const parts = String(value).split('.');
    if (parts.length !== 3) return null;
    try {
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload = JSON.parse(atob(b64));
      return payload && typeof payload.role === 'string' ? payload.role : null;
    } catch (e) { return null; }
  }
  const SECRET_SHAPES = [/^sk[_.-]/, /^rk_/, /^whsec_/, /^sb_secret_/, /^gh[pousr]_/, /^github_pat_/, /^AKIA[0-9A-Z]{12}/];

  function basicCheck(key, v) {
    const fmt = key.format || {};
    const bad = (message) => ({ level: 'bad', message });
    if (/^["'`]|["'`]$/.test(v)) return bad('Remove the quote marks around the key.');
    if (/^[A-Z][A-Z0-9_]{2,}\s*=\s*\S/.test(v)) return bad('Paste only the value: the part after the = sign.');
    if (/\s/.test(v)) return bad('Remove the spaces or line breaks. Keys never contain them.');
    if (/[•*]{4,}|\.{3,}|…/.test(v)) return bad('That looks like a hidden or shortened key. Use "Reveal" or "Copy" in the dashboard to get the full value.');
    if (key.visibility !== 'secret') {
      if (/^eyJ/.test(v) && jwtRole(v) === 'service_role') {
        return { level: 'danger', message: 'Stop: this is your service_role key. It\'s secret and skips every security rule. Paste the public anon key here instead.' };
      }
      if (!matchesFormat(key, v) && SECRET_SHAPES.some((re) => re.test(v))) {
        return { level: 'danger', message: 'Careful: this looks like a secret key, and this box is for a public one. Never put a secret key in a public setting.' };
      }
    }
    if (compile(fmt.regex) && !matchesFormat(key, v)) {
      return bad('This doesn\'t look like a ' + softLabel(key.label) + '.' + (fmt.hint ? ' ' + String(fmt.hint).replace(/\.$/, '') + '.' : ''));
    }
    return { level: 'ok', message: 'Looks right' };
  }

  /** "Hmm, Stripe's publishable key starts with pk_. …" for a value that belongs in a sibling box. */
  function swapResult(service, key, sibling) {
    const hint = key.format && key.format.hint ? String(key.format.hint).replace(/\.$/, '') : '';
    const who = service.name + '\'s ' + softLabel(key.label);
    const lead = 'Hmm, ' + (hint
      ? (/^(starts|begins|ends|is|has|contains|looks)\b/i.test(hint) ? who + ' ' + softLabel(hint) + '.' : who + ' usually looks like: ' + hint + '.')
      : who + ' looks different.');
    if (sibling.visibility === 'secret' && key.visibility !== 'secret') {
      const what = softLabel(sibling.label) + (/secret/i.test(sibling.label) ? '' : ' (a secret key)');
      return { level: 'danger', message: lead + ' This looks like your ' + what + '. Did you paste the wrong one? Secret keys never go in a public box.' };
    }
    return { level: 'bad', message: lead + ' This looks like your ' + softLabel(sibling.label) + '. Did you paste it in the wrong box?' };
  }

  function checkValue(service, key, raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return { level: 'empty', message: '' };
    let res = null;
    if (typeof VC.data.checkKey === 'function') {
      try { res = VC.data.checkKey(key, v); } catch (e) { res = null; }
    }
    if (!res || !res.level) res = basicCheck(key, v);
    if (res.level === 'empty') res = basicCheck(key, v);
    // Wrong box within the same service (e.g. the secret key pasted into the publishable box).
    if ((res.level === 'bad' || res.level === 'warn') && !matchesFormat(key, v)) {
      const sibling = arr(service.keys).find((k) => k !== key && matchesFormat(k, v));
      if (sibling) res = swapResult(service, key, sibling);
    }
    if (res.level === 'ok') res = { level: 'ok', message: 'Looks right' };
    return res;
  }

  /** 'test' | 'live' | null, from prefixes like pk_test_ / sk_live_. */
  function modeOf(v) {
    const m = /^[a-z]{2,8}_(test|live)_/i.exec(String(v || '').trim());
    return m ? m[1].toLowerCase() : null;
  }
  function modeNote(service, v) {
    const mode = modeOf(v);
    if (!mode) return null;
    const money = arr(service.categories).indexOf('payments') !== -1;
    return mode === 'test'
      ? 'Test mode: ' + (money ? 'no real money moves' : 'made for building and trying things out') + '. Perfect while you build. Swap in the live key when you launch.'
      : 'Live mode: ' + (money ? 'this charges real cards' : 'this works with real users and real data') + '. While you\'re still building, the test-mode key is safer.';
  }
  function modesMixed(service) {
    const modes = new Set();
    arr(service.keys).forEach((k) => { const m = modeOf(pasted.get(refOf(service, k))); if (m) modes.add(m); });
    return modes.size > 1;
  }

  /* ------------------------------------------------------------------ *
   * Environment file generation
   * ------------------------------------------------------------------ */
  /** One row per key across the services: { service, key, ref, name, value, level, usable } (deduped by name). */
  function envRows(c) {
    const rows = [];
    const seen = new Set();
    c.units.forEach((u) => {
      if (!u.service) return;
      arr(u.service.keys).forEach((key) => {
        if (!key || !key.id) return;
        const name = envName(u.service, key, c.framework);
        if (seen.has(name)) return;
        seen.add(name);
        const ref = refOf(u.service, key);
        const value = oneLine(pasted.get(ref) || '');
        const level = checkValue(u.service, key, value).level;
        rows.push({ service: u.service, key, ref, name, value, level, usable: !!value && level !== 'danger' });
      });
    });
    return rows;
  }

  /** Mask a value but keep a recognisable start ("sk_live_••••••••3f9a"). URLs aren't secret. */
  function mask(v) {
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (v.length <= 12) return '••••••••';
    const pre = (/^[A-Za-z]{1,8}[_.-](?:[A-Za-z0-9]{1,8}[_.-])?/.exec(v) || [v.slice(0, 4)])[0].slice(0, 12);
    return pre + '••••••••' + v.slice(-4);
  }

  /** A value safe to put on one line of a .env file. */
  function envValue(v) {
    v = oneLine(v);
    return /[\s#"'`\\]/.test(v) ? '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : v;
  }

  /** The .env file (opts.example → names only; opts.masked → masked values for on-screen preview). */
  function buildEnv(rows, c, opts) {
    const o = opts || {};
    const title = oneLine((c.project && (c.project.name || c.project.idea)) || 'your app').slice(0, 80);
    const out = o.example
      ? ['# ' + o.fileName + ': the settings ' + title + ' needs, without the values.',
        '# Safe to share and upload. Copy it to ' + (c.envFileName || '.env.local') + ' and fill in the values.']
      : ['# ' + o.fileName + ' for ' + title,
        '# Keep this file private. Never upload it, share it, or paste it into an AI chat.'];
    const groups = [
      ['public', 'PUBLIC: safe to use in your app'],
      ['secret', 'SECRET: server only. Never put these in your app\'s code'],
    ];
    groups.forEach(([vis, heading]) => {
      const list = rows.filter((r) => (r.key.visibility === 'secret' ? 'secret' : 'public') === vis);
      if (!list.length) return;
      out.push('', '# ===== ' + heading + ' =====');
      let lastService = null;
      list.forEach((r) => {
        if (r.service !== lastService) { out.push('', '# ' + r.service.name); lastService = r.service; }
        if (o.example) { out.push(r.name + '='); return; }
        if (r.value && r.level === 'danger') {
          out.push('# Left blank: the value pasted for this looked like the wrong (secret) key. Fix it in Vibe Check.');
        } else if (!r.value) {
          out.push('# To do: paste your ' + softLabel(r.key.label) + (r.key.where ? ' (' + oneLine(r.key.where) + ')' : ''));
        }
        const value = r.usable ? (o.masked && !showValues ? mask(r.value) : envValue(r.value)) : '';
        out.push(r.name + '=' + value);
      });
    });
    return out.join('\n') + '\n';
  }

  const GITIGNORE = '# Environment files hold your secret keys. Never upload them.\n.env*\n!.env.example\n';

  /* ------------------------------------------------------------------ *
   * Render pieces
   * ------------------------------------------------------------------ */
  function explainer() {
    return html`<section class="card">
      <div class="grid-3">
        <div class="stack sm">
          <div class="row sm"><span style="${ICON_BOX}">${VC.icon('key')}</span><h3 class="mb-0">What's an API key?</h3></div>
          <p class="small text-2 mb-0">An ${VC.ui.term('API key')} is a password your app uses to talk to a service like Stripe or Claude. Each service gives you one or two when you sign up.</p>
        </div>
        <div class="stack sm">
          <div class="row sm"><span style="${ICON_BOX}">${VC.icon('eye')}</span><h3 class="mb-0">Public or secret?</h3></div>
          <p class="small text-2 mb-0"><span class="dot green"></span> ${VC.ui.term('Public keys', 'publishable key')} are made to be seen, so they're fine inside your app.</p>
          <p class="small text-2 mb-0"><span class="dot red"></span> ${VC.ui.term('Secret keys', 'secret key')} are like your bank PIN: server only. Never in your app's code or an AI chat.</p>
        </div>
        <div class="stack sm">
          <div class="row sm"><span style="${ICON_BOX}">${VC.icon('lock')}</span><h3 class="mb-0">We never save your keys</h3></div>
          <p class="small text-2 mb-0">Anything you paste here only lives in this tab until you download your file. Reloading the page clears it.</p>
        </div>
      </div>
    </section>`;
  }

  /** Standalone mode: pick a builder and the services the app uses. */
  function picker(c) {
    const builders = listOf(VC.data.builders);
    const services = listOf(VC.data.services);
    const cats = listOf(VC.data.categories);
    // Each service shows once, under its main (first) category.
    const groups = cats.map((cat) => ({ cat, list: services.filter((s) => s && arr(s.categories)[0] === cat.id) }))
      .filter((g) => g.list.length);
    const other = services.filter((s) => s && !cats.some((cat) => cat.id === arr(s.categories)[0]));
    if (other.length) groups.push({ cat: { id: 'other', name: 'Other', icon: 'list' }, list: other });
    const needsFramework = !c.builder || c.builder.framework === 'any' || !c.builder.framework;

    return html`<section class="card pad-lg stack lg section">
      <div>
        <h2 class="mb-0">What are you working with?</h2>
        <p class="text-2 mb-0">No build kit yet? No problem. Pick your tool and the services your app uses, and we'll walk you through every key. Starting from scratch? <a href="#/idea">Plan your app first</a>.</p>
      </div>
      <div class="field">
        <span class="label">Which tool are you building with?</span>
        ${builders.length
          ? html`<div class="option-group" role="radiogroup" aria-label="Your builder">
              ${builders.map((b) => html`<button class="chip ${standalone.builderId === b.id ? 'on' : ''}" data-action="pick-builder" data-id="${b.id}" role="radio" aria-checked="${String(standalone.builderId === b.id)}">${b.name}</button>`)}
            </div>`
          : html`<p class="small muted mb-0">The list of builders didn't load. Reload the page to try again.</p>`}
      </div>
      ${needsFramework ? html`<div class="field" style="max-width:360px">
        <label for="setup-framework">What is your app built with?</label>
        <select id="setup-framework" data-framework>
          ${FRAMEWORKS.map((f) => html`<option value="${f.id}" ${c.framework === f.id ? 'selected' : ''}>${f.label}</option>`)}
        </select>
        <span class="hint">This changes the setting names. Not sure? Ask your AI: "Which framework does this project use?"</span>
      </div>` : ''}
      <div class="field">
        <span class="label">Which services does your app use?</span>
        <span class="hint">Tick every one you use or plan to use. You can change this any time.</span>
        ${groups.length
          ? html`<div class="stack" style="margin-top:6px">${groups.map((g) => html`<div class="row top">
              <span class="small bold text-2 row sm" style="min-width:170px;padding-top:6px">${VC.icon(g.cat.icon || 'list', 16)} ${g.cat.name}</span>
              <div class="option-group grow">
                ${g.list.map((s) => {
                  const on = standalone.services.has(s.id);
                  return html`<button class="chip ${on ? 'on' : ''}" data-action="pick-service" data-id="${s.id}" aria-pressed="${String(on)}" title="${s.tagline || ''}">${VC.icon(on ? 'check' : 'plus', 14)} ${s.name}</button>`;
                })}
              </div>
            </div>`)}</div>`
          : VC.ui.callout('warn', 'The service guide didn\'t load. Reload the page to try again.')}
      </div>
    </section>`;
  }

  function numberBadge(n, done) {
    return done
      ? html`<span style="${NUM_STYLE}background:var(--green);color:#fff" aria-label="Done">${VC.icon('check', 14)}</span>`
      : html`<span style="${NUM_STYLE}background:var(--accent-soft);color:var(--accent)">${n}</span>`;
  }

  function unitBadge(u, prog) {
    if (prog.done) return VC.ui.badge('Done', 'green');
    if (!u.steps.length) return '';
    return VC.ui.badge(stepsDone(u, prog) + '/' + u.steps.length + ' steps', 'gray');
  }

  function overview(c) {
    const total = c.units.length;
    const done = c.units.filter((u) => progressOf(u.id).done).length;
    const next = c.units.find((u) => !progressOf(u.id).done);
    const pct = total ? (done / total) * 100 : 0;
    return html`<section class="card stack section" id="setup-overview">
      <div class="spread">
        <div class="grow">
          <h2 class="mb-0">Your setup order</h2>
          <p class="small muted mb-0">${c.kit ? 'Builder account first, then GitHub, then the rest.' : 'GitHub first, then the rest.'} Most take 5 to 10 minutes.</p>
        </div>
        <div class="stat" style="text-align:right">
          <span class="stat-value">${done}<span class="muted" style="font-size:1rem"> / ${total}</span></span>
          <span class="stat-label">ready</span>
        </div>
      </div>
      ${VC.ui.meter(pct, done === total ? 'green' : '')}
      <div class="row sm">
        ${c.units.map((u, i) => {
          const d = progressOf(u.id).done;
          return html`<button class="chip" data-action="jump" data-unit="${u.id}" title="${d ? 'Done' : 'Not done yet'}">
            <span class="dot ${d ? 'green' : ''}"></span>${i + 1}. ${u.kind === 'builder' ? u.builder.name : u.name}
          </button>`;
        })}
      </div>
      <div class="spread">
        ${next
          ? html`<span class="small text-2">Next up: <strong>${next.name}</strong></span>
             <button class="btn primary sm" data-action="jump" data-unit="${next.id}">Continue ${VC.icon('arrow', 14)}</button>`
          : html`<span class="small" style="color:var(--green)">${VC.icon('success', 16)} <strong>Everything's set up.</strong> Grab your environment file below.</span>`}
      </div>
      ${VC.store.active() ? '' : html`<p class="tiny muted mb-0">You don't have a project yet, so your ticks reset when you reload. <a href="#/idea">Start a project</a> to save them.</p>`}
    </section>`;
  }

  function stepList(u, prog) {
    if (!u.steps.length) return '';
    return html`<div class="stack sm">
      <div class="spread"><h4 class="mb-0">Step by step</h4><span class="tiny muted">Tick each one as you go</span></div>
      <ul class="checklist">
        ${u.steps.map((st, i) => {
          const on = !!prog.steps[i];
          const url = safeUrl(st.url);
          return html`<li><label class="check ${on ? 'is-done' : ''}">
            <input type="checkbox" data-step data-unit="${u.id}" data-index="${i}" ${on ? 'checked' : ''}>
            <span class="grow"><span class="check-title bold">${st.title}</span>${st.detail ? html`<span class="small text-2" style="display:block">${st.detail}</span>` : ''}</span>
            ${url ? html`<a class="btn sm" href="${url}" target="_blank" rel="noopener">Open ${VC.icon('external', 13)}</a>` : ''}
          </label></li>`;
        })}
      </ul>
    </div>`;
  }

  function feedback(service, key, value) {
    const r = checkValue(service, key, value);
    if (r.level === 'empty') return '';
    if (r.level === 'danger') return VC.ui.callout('danger', html`<strong>${r.message}</strong>`);
    const ok = r.level === 'ok';
    const note = ok || r.level === 'warn' ? modeNote(service, value) : null;
    return html`<div class="row sm top" style="color:${ok ? 'var(--green)' : 'var(--yellow)'};flex-wrap:nowrap">
        ${VC.icon(ok ? 'check' : 'warn', 16)}<span class="grow bold">${r.message}</span>
      </div>
      ${note ? html`<div class="small text-2" style="margin-top:4px">${note}</div>` : ''}`;
  }

  function inputClass(service, key, value) {
    const l = checkValue(service, key, value).level;
    return l === 'ok' ? 'input-ok' : (l === 'bad' || l === 'danger') ? 'input-bad' : '';
  }

  function mixedModes(service) {
    return modesMixed(service)
      ? VC.ui.callout('warn', html`Your ${service.name} keys are from different modes: one is <strong>test</strong> and one is <strong>live</strong>. They must match, or things will fail. Use both test keys while you build.`)
      : '';
  }

  function keyRow(service, key, c) {
    const ref = refOf(service, key);
    const id = 'key-' + VC.slug(service.id) + '-' + VC.slug(key.id);
    const value = pasted.get(ref) || '';
    const shown = revealed.has(ref);
    const name = envName(service, key, c.framework);
    const fmt = key.format || {};
    return html`<div class="card flat stack sm" style="padding:14px 16px">
      <div class="spread">
        <label class="bold" for="${id}">${key.label || key.id}</label>
        ${VC.ui.visibilityBadge(key.visibility === 'secret' ? 'secret' : 'public')}
      </div>
      ${key.where ? html`<div class="small text-2"><span class="muted">Find it:</span> ${key.where}</div>` : ''}
      <div class="row sm" style="flex-wrap:nowrap">
        <input id="${id}" type="${shown ? 'text' : 'password'}" class="mono grow ${inputClass(service, key, value)}" data-key-ref="${ref}"
          placeholder="${fmt.example ? 'Looks like ' + fmt.example : 'Paste it here'}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-describedby="${id}-fb">
        <button class="btn sm" data-action="reveal" data-ref="${ref}" aria-pressed="${String(shown)}" aria-controls="${id}">${VC.icon('eye', 14)} ${shown ? 'Hide' : 'Show'}</button>
      </div>
      <div id="${id}-fb" class="small" data-feedback="${ref}" aria-live="polite">${feedback(service, key, value)}</div>
      ${key.note ? html`<div class="small muted">${VC.icon('info', 13)} ${key.note}</div>` : ''}
      <div class="row sm small">
        <span class="muted">Setting name:</span>
        <code class="break">${name}</code>
        ${VC.ui.copyButton(name, 'Copy', 'sm ghost')}
      </div>
    </div>`;
  }

  function keysBlock(s, c) {
    const keys = arr(s.keys).filter((k) => k && k.id);
    if (!keys.length) {
      return VC.ui.callout('info', html`No keys to copy for ${s.name}. You connect it by logging in, so the steps above are all you need.`);
    }
    const dash = safeUrl(s.dashboardUrl);
    return html`<div class="stack sm">
      <div class="spread">
        <h4 class="mb-0">Your keys</h4>
        ${dash ? html`<a class="btn ghost sm" href="${dash}" target="_blank" rel="noopener">Open ${s.name} dashboard ${VC.icon('external', 13)}</a>` : ''}
      </div>
      <p class="small muted mb-0">Paste each one to check it. ${VC.icon('lock', 12)} It stays in this tab and is never saved.</p>
      ${keys.map((k) => keyRow(s, k, c))}
      <div data-modes="${s.id}">${mixedModes(s)}</div>
    </div>`;
  }

  function isNative(s, builder) {
    if (!builder) return false;
    return arr(builder.nativeIntegrations).indexOf(s.id) !== -1 || (s.builderSupport && s.builderSupport[builder.id] === 'native');
  }

  function placementBlock(s, c) {
    const keys = arr(s.keys).filter((k) => k && k.id);
    if (!keys.length) return '';
    const b = c.builder;
    const secrets = (b && b.secrets) || {};
    const pub = keys.filter((k) => k.visibility !== 'secret');
    const sec = keys.filter((k) => k.visibility === 'secret');
    const box = (vis, list, steps) => html`<div class="card soft stack sm">
      <div>${VC.ui.visibilityBadge(vis)}</div>
      <div class="row sm">${list.map((k) => html`<code class="break">${envName(s, k, c.framework)}</code>`)}</div>
      ${steps.length ? html`<ol class="numbered small">${steps.map((st) => html`<li>${st}</li>`)}</ol>` : ''}
      ${vis === 'secret' ? VC.ui.callout('danger', html`<strong>Never paste ${list.length > 1 ? 'these' : 'this'} into your app's code or chat with the AI.</strong>`, 'lock') : ''}
    </div>`;
    return html`<div class="stack sm">
      <h4 class="mb-0">Where ${keys.length > 1 ? 'they go' : 'it goes'} in ${b ? b.name : 'your app'}</h4>
      ${!b ? html`<p class="small muted mb-0">Pick your builder above for exact steps.</p>` : ''}
      ${isNative(s, b) ? VC.ui.callout('accent', html`<strong>Shortcut:</strong> ${b.name} has a built-in ${s.name} connection. Use it and ${b.name} adds these keys for you. The steps below are for connecting by hand.`, 'bolt') : ''}
      <div class="${pub.length && sec.length ? 'grid-2' : 'stack'}">
        ${pub.length ? box('public', pub, b ? arr(secrets.publicKeys) : GENERIC.publicKeys) : ''}
        ${sec.length ? box('secret', sec, b ? arr(secrets.secretKeys) : GENERIC.secretKeys) : ''}
      </div>
    </div>`;
  }

  function safetyBlock(s) {
    const safety = arr(s.safety);
    const gotchas = arr(s.gotchas);
    if (!safety.length && !gotchas.length) return '';
    const col = (icon, color, title, list) => html`<div class="stack sm">
      <div class="row sm" style="color:${color}">${VC.icon(icon, 16)}<h4 class="mb-0">${title}</h4></div>
      <ul class="small text-2 mb-0">${list.map((x) => html`<li>${x}</li>`)}</ul>
    </div>`;
    return html`<div class="${safety.length && gotchas.length ? 'grid-2' : 'stack'}">
      ${safety.length ? col('shield', 'var(--green)', 'Stay safe', safety) : ''}
      ${gotchas.length ? col('warn', 'var(--yellow)', 'Common mistakes', gotchas) : ''}
    </div>`;
  }

  function unitFoot(u, prog) {
    const allTicked = u.steps.length > 0 && stepsDone(u, prog) === u.steps.length;
    const label = u.kind === 'builder' ? 'Mark as done' : 'Mark this service done';
    const docs = u.service ? safeUrl(u.service.docsUrl) : null;
    return html`<div class="card-foot" style="margin-top:0">
      ${prog.done
        ? html`<span class="row sm bold" style="color:var(--green)">${VC.icon('success', 18)} Done</span>
           <button class="btn ghost sm" data-action="undone" data-unit="${u.id}">Mark as not done</button>`
        : html`<button class="btn ${allTicked ? 'primary' : ''}" data-action="done" data-unit="${u.id}" data-done-btn="${u.id}">${VC.icon('check', 16)} ${label}</button>`}
      <span class="grow"></span>
      ${docs ? html`<a class="btn ghost sm" href="${docs}" target="_blank" rel="noopener">Help docs ${VC.icon('external', 13)}</a>` : ''}
    </div>`;
  }

  function unitBody(u, c, prog) {
    if (u.kind === 'builder') {
      const reason = c.kit && c.kit.builder && c.kit.builder.reason;
      return html`
        ${reason || u.builder.bestFor ? html`<dl class="kv">
          ${reason ? html`<dt>Why ${u.builder.name}</dt><dd>${reason}</dd>` : ''}
          ${!reason && u.builder.bestFor ? html`<dt>Best for</dt><dd>${u.builder.bestFor}</dd>` : ''}
        </dl>` : ''}
        ${stepList(u, prog)}`;
    }
    const s = u.service;
    if (!s) {
      return VC.ui.callout('info', html`We don't have a step-by-step guide for ${u.name} yet. Search for "${u.name} API key", follow their instructions, then mark it done here.`);
    }
    const e = u.entry;
    const cats = (e.categories.length ? e.categories : arr(s.categories)).map((id) => categoryById(id)).filter(Boolean);
    const why = e.reasons.length ? e.reasons.join(' ') : (s.whyPick || s.bestFor || '');
    return html`
      <dl class="kv">
        ${why ? html`<dt>${e.reasons.length ? 'Why you need it' : 'What it\'s for'}</dt><dd>${why}</dd>` : ''}
        ${s.freeTier ? html`<dt>Free tier</dt><dd>${s.freeTier}${s.paidFrom ? html` <span class="muted">(${/^[$€£\d]/.test(s.paidFrom) ? 'paid plans from ' + s.paidFrom : softLabel(s.paidFrom)})</span>` : ''}</dd>` : ''}
        ${cats.length ? html`<dt>Covers</dt><dd class="row sm">${cats.map((cat) => VC.ui.badge(cat.name, 'accent'))}</dd>` : ''}
      </dl>
      ${stepList(u, prog)}
      ${keysBlock(s, c)}
      ${placementBlock(s, c)}
      ${safetyBlock(s)}`;
  }

  function unitCard(u, i, c) {
    const prog = progressOf(u.id);
    return html`<details class="acc" data-unit="${u.id}" ${openCards.has(u.id) ? 'open' : ''} style="scroll-margin-top:76px">
      <summary>
        <span data-unit-num="${u.id}">${numberBadge(i + 1, prog.done)}</span>
        <span class="grow">
          <span>${u.name}</span>
          ${!u.required ? html` ${VC.ui.badge('Optional', 'gray')}` : ''}
          ${u.tagline ? html`<span class="small muted" style="display:block;font-weight:400">${u.tagline}</span>` : ''}
        </span>
        <span data-unit-badge="${u.id}">${unitBadge(u, prog)}</span>
      </summary>
      <div class="acc-body stack lg">
        ${unitBody(u, c, prog)}
        ${unitFoot(u, prog)}
      </div>
    </details>`;
  }

  /* ---------- "Your environment file" ---------- */
  function codeHead(title, buttons) {
    return html`<div class="code-head"><span>${title}</span><span class="row sm" style="justify-content:flex-end">${buttons}</span></div>`;
  }

  function envFileView(rows, c, dangerous) {
    const fileName = c.envFileName;
    const anyValue = rows.some((r) => r.usable);
    const preview = buildEnv(rows, c, { fileName, masked: true });
    const example = buildEnv(rows, c, { fileName: '.env.example', example: true });
    return html`<ol class="numbered">
      <li class="stack sm">
        <div>
          <strong>${fileName}</strong>: your real keys.
          <span class="text-2">It goes in the top folder of your project, next to <code>package.json</code>.</span>
        </div>
        <div class="code">
          ${codeHead(fileName, html`
            ${anyValue ? html`<button class="btn sm" data-action="env-values" aria-pressed="${String(showValues)}">${VC.icon('eye', 14)} ${showValues ? 'Hide values' : 'Show values'}</button>` : ''}
            <button class="btn sm" data-action="env-copy">${VC.icon('copy', 14)} Copy</button>
            <button class="btn sm" data-action="env-download">${VC.icon('download', 14)} Download</button>`)}
          <pre>${preview}</pre>
        </div>
        ${exported
          ? VC.ui.callout('warn', html`<strong>Keep this file private.</strong> Don't upload it, share it, or paste it into AI chats. If your browser saved it as <code>${fileName.replace(/^\./, '')}</code>, rename it to exactly <code>${fileName}</code>.`)
          : html`<p class="small muted mb-0">Easiest way: in your code editor, create a new file named exactly <code>${fileName}</code> in the top folder, paste this in, and save. ${anyValue ? '' : 'Empty lines are waiting for your keys: paste them in the boxes above, or fill them in yourself.'}</p>`}
        ${dangerous}
      </li>
      <li class="stack sm">
        <div><strong>.env.example</strong>: the same names with no values. <span class="text-2">Safe to share and upload, so anyone (including your AI) knows which settings the app needs. Put it next to ${fileName}.</span></div>
        ${VC.ui.codeBlock(example, { title: '.env.example' })}
      </li>
      <li class="stack sm">
        <div><strong>.gitignore</strong>: stops ${VC.ui.term('Git', 'git')} from ever uploading your keys. <span class="text-2">Add these lines to the <code>.gitignore</code> file in your top folder, or create it if it's missing.</span></div>
        ${VC.ui.codeBlock(GITIGNORE, { title: '.gitignore' })}
      </li>
    </ol>`;
  }

  function envTableView(rows, c, dangerous) {
    const b = c.builder;
    const secrets = (b && b.secrets) || {};
    const hasPub = rows.some((r) => r.key.visibility !== 'secret');
    const hasSec = rows.some((r) => r.key.visibility === 'secret');
    const anyValue = rows.some((r) => r.usable);
    return html`<div class="stack">
      <div class="spread">
        <p class="text-2 mb-0">${b.name} doesn't use a settings file. You paste each setting into ${b.name} instead. Here they all are in one place.</p>
        ${anyValue ? html`<button class="btn sm" data-action="env-values" aria-pressed="${String(showValues)}">${VC.icon('eye', 14)} ${showValues ? 'Hide values' : 'Show values'}</button>` : ''}
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Setting name</th><th>Value</th><th colspan="2">Copy</th></tr></thead>
          <tbody>
            ${rows.map((r) => html`<tr>
              <td><code class="break">${r.name}</code><div class="tiny muted row sm" style="margin-top:4px"><span class="dot ${r.key.visibility === 'secret' ? 'red' : 'green'}"></span>${r.service.name} · ${r.key.visibility === 'secret' ? 'secret' : 'public'}</div></td>
              <td class="small">${r.usable
                ? html`<span class="mono break">${showValues ? r.value : mask(r.value)}</span>`
                : r.value
                  ? html`<button class="btn ghost sm" data-action="goto-key" data-ref="${r.ref}" style="color:var(--red)">${VC.icon('danger', 14)} Wrong key: fix it</button>`
                  : html`<button class="btn ghost sm" data-action="goto-key" data-ref="${r.ref}">${VC.icon('plus', 14)} Paste it</button>`}</td>
              <td style="width:1%">${VC.ui.copyButton(r.name, 'Name')}</td>
              <td style="width:1%"><button class="btn sm" data-action="copy-value" data-ref="${r.ref}" ${r.usable ? '' : 'disabled'} title="${r.usable ? 'Copy the value' : 'Paste this key above first'}">${VC.icon('copy', 14)} Value</button></td>
            </tr>`)}
          </tbody>
        </table>
      </div>
      ${dangerous}
      <div class="${hasPub && hasSec ? 'grid-2' : 'stack'}">
        ${hasPub ? html`<div class="card soft stack sm">
          <div class="row sm">${VC.ui.visibilityBadge('public')}<strong class="small">Where to paste these in ${b.name}</strong></div>
          <ol class="numbered small">${arr(secrets.publicKeys).map((st) => html`<li>${st}</li>`)}</ol>
        </div>` : ''}
        ${hasSec ? html`<div class="card soft stack sm">
          <div class="row sm">${VC.ui.visibilityBadge('secret')}<strong class="small">Where to paste these in ${b.name}</strong></div>
          <ol class="numbered small">${arr(secrets.secretKeys).map((st) => html`<li>${st}</li>`)}</ol>
          ${VC.ui.callout('danger', html`<strong>Never paste secret keys into your app's code or chat with the AI.</strong>`, 'lock')}
        </div>` : ''}
      </div>
    </div>`;
  }

  function deployCard(c) {
    const b = c.builder;
    const steps = b && arr(b.secrets && b.secrets.deployVars).length ? arr(b.secrets.deployVars) : GENERIC.deployVars;
    const money = c.units.some((u) => u.service && arr(u.service.categories).indexOf('payments') !== -1);
    return html`<div class="card soft stack sm">
      <div class="row sm">${VC.icon('rocket')}<h3 class="mb-0">When you go live</h3></div>
      <p class="small text-2 mb-0">Your live app needs the same settings. When you ${VC.ui.term('deploy')}, add the same names and values in:</p>
      <ul class="small mb-0">${steps.map((st) => html`<li>${st}</li>`)}</ul>
      ${money ? html`<p class="small text-2 mb-0">${VC.icon('coin', 14)} Use <strong>test</strong> payment keys while you build, and switch to <strong>live</strong> keys only on the live site.</p>` : ''}
    </div>`;
  }

  function envSection(c) {
    const rows = envRows(c);
    if (!c.units.some((u) => u.service)) return '';
    if (!rows.length) {
      return html`<div class="section-head"><h2>Your environment file</h2></div>
        ${VC.ui.callout('success', 'None of your services need keys, so there\'s no settings file to make. Nice and simple.')}`;
    }
    const b = c.builder;
    const usesFile = !b || !b.secrets || b.secrets.envFile !== false;
    const count = rows.filter((r) => r.usable).length;
    const bad = rows.filter((r) => r.value && r.level === 'danger');
    const dangerous = bad.length
      ? VC.ui.callout('danger', html`<strong>${bad.length === 1 ? 'One box has' : bad.length + ' boxes have'} the wrong key in ${bad.length === 1 ? 'it' : 'them'}</strong> (${bad.map((r) => r.service.name + ' ' + softLabel(r.key.label)).join(', ')}). We left ${bad.length === 1 ? 'it' : 'them'} out so nothing secret ends up in a public spot.
          <div class="row sm" style="margin-top:8px">${bad.map((r) => html`<button class="btn sm" data-action="goto-key" data-ref="${r.ref}">Fix ${r.service.name}</button>`)}</div>`)
      : '';
    return html`
      <div class="section-head">
        <div>
          <h2>Your environment file</h2>
          <p class="text-2 mb-0">${usesFile
            ? html`Your app reads its keys from a small file called an ${VC.ui.term('env file', '.env')}. We built it from the boxes above.`
            : html`Every ${VC.ui.term('setting', 'env var')} your app needs, ready to copy into ${b.name}.`}</p>
        </div>
        <div class="row sm">
          ${VC.ui.badge(count + ' of ' + plural(rows.length, 'key') + ' pasted', count === rows.length ? 'green' : 'gray')}
          <button class="btn ghost sm" data-action="clear-keys" ${pasted.size ? '' : 'disabled'}>${VC.icon('trash', 14)} Clear pasted keys</button>
        </div>
      </div>
      <div class="card pad-lg stack lg">
        ${usesFile ? envFileView(rows, c, dangerous) : envTableView(rows, c, dangerous)}
        <p class="tiny muted mb-0">Names are for ${FRAMEWORK_NAMES[c.framework] || c.framework} apps${b ? ', the way ' + b.name + ' expects them' : ''}.</p>
      </div>
      ${deployCard(c)}`;
  }

  function nextCta(c) {
    const allDone = c.units.length && c.units.every((u) => progressOf(u.id).done);
    return html`<section class="card pad-lg section">
      <div class="spread">
        <div class="grow" style="min-width:220px">
          <h3 class="mb-0">${allDone ? 'You\'re all set up!' : 'Keys sorted?'}</h3>
          <p class="text-2 mb-0">Next, we'll write prompts that build your app one safe step at a time.</p>
        </div>
        <a class="btn primary lg" href="#/prompts">Next: get your build prompts ${VC.icon('arrow', 16)}</a>
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Live updates (typing in key boxes) without re-rendering the page,
   * so the cursor and focus stay put.
   * ------------------------------------------------------------------ */
  const refreshEnv = VC.debounce(() => {
    const box = document.getElementById('setup-env');
    if (box && last) VC.mount(box, html`${envSection(last)}`);
  }, 150);

  function onKeyInput(input) {
    if (!last) return;
    const ref = input.getAttribute('data-key-ref');
    const [sid, kid] = ref.split('::');
    const u = last.units.find((x) => x.service && x.service.id === sid);
    const key = u && arr(u.service.keys).find((k) => k.id === kid);
    if (!key) return;
    const value = input.value;
    if (value.trim()) pasted.set(ref, value); else pasted.delete(ref);
    input.classList.remove('input-ok', 'input-bad');
    const cls = inputClass(u.service, key, value);
    if (cls) input.classList.add(cls);
    const fb = document.querySelector(attrSel('data-feedback', ref));
    if (fb) VC.mount(fb, html`${feedback(u.service, key, value)}`);
    const modes = document.querySelector(attrSel('data-modes', sid));
    if (modes) VC.mount(modes, html`${mixedModes(u.service)}`);
    refreshEnv();
  }

  /** Re-render, then put focus back on the equivalent element. */
  function rerenderKeepFocus(ctx, selector) {
    ctx.rerender();
    if (!selector) return;
    const t = document.querySelector('#view ' + selector);
    if (t) try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  function openAndScroll(unitId, focusSummary) {
    const d = document.querySelector('#view details' + attrSel('data-unit', unitId));
    if (!d) return;
    openCards.add(unitId);
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (focusSummary) { const s = d.querySelector('summary'); if (s) try { s.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }

  function flashCopied(b) {
    const old = b.innerHTML;
    b.classList.add('copied');
    VC.mount(b, html`${VC.icon('check', 14)} Copied`);
    setTimeout(() => { b.classList.remove('copied'); b.innerHTML = old; }, 1400);
  }

  /** Reset per-project state when the active project changes. */
  function syncOwner(project) {
    const id = project ? project.id : null;
    if (owner === id) return;
    owner = id;
    pasted.clear();
    revealed.clear();
    openCards.clear();
    openedFor = null;
    showValues = false;
    exported = false;
    const answer = project && project.answers && project.answers.builder;
    standalone.builderId = answer && answer !== 'unsure' ? answer : null;
    standalone.framework = null;
    standalone.services.clear();
  }

  /* ------------------------------------------------------------------ *
   * The view
   * ------------------------------------------------------------------ */
  VC.registerView({
    id: 'setup',
    title: 'Setup',
    navTitle: 'Setup & keys',
    icon: 'key',
    nav: { group: 'journey', order: 3 },

    /** Done when every unique service in the kit is marked done. */
    status(project) {
      const kit = project && project.kit;
      const ids = Array.from(new Set(arr(kit && kit.services).map((r) => r && r.serviceId).filter(Boolean)));
      if (!ids.length) return 'todo';
      const prog = (project.setup && project.setup.progress) || {};
      return ids.every((id) => prog[id] && prog[id].done) ? 'done' : 'todo';
    },

    render(el, ctx) {
      const project = ctx.project;
      syncOwner(project);

      const kit = project && project.kit && Array.isArray(project.kit.services) ? project.kit : null;
      const builder = kit ? builderById(kit.builder && kit.builder.id) : builderById(standalone.builderId);
      // Framework picks the env names: the kit's, else the builder's fixed one, else what the user chose.
      let framework = kit && kit.framework;
      if (!framework && builder && builder.framework && builder.framework !== 'any') framework = builder.framework;
      if (!framework && !kit) framework = standalone.framework;
      if (!framework || framework === 'any') framework = kit ? 'node' : 'vite';

      const entries = kit ? kitEntries(kit) : standaloneEntries();
      const units = buildUnits(kit, builder, entries, project);
      const envFileName = (builder && builder.secrets && builder.secrets.envFileName) || '.env.local';
      const c = { project, kit, builder, framework, units, envFileName };
      last = c;

      // Open one card by default: the one linked to (?service=…) or the first unfinished one.
      const sig = (project ? project.id : '-') + '|' + (kit ? 'kit' : 'standalone');
      let linked = ctx.params && ctx.params.service && units.find((u) => u.id === ctx.params.service);
      if (!linked) linkedFor = null;
      else if (linkedFor === location.hash) linked = null;         // only jump once per visit to the link
      if (linked) { linkedFor = location.hash; openCards.add(linked.id); }
      if (openedFor !== sig) {
        openedFor = sig;
        const first = units.find((u) => !progressOf(u.id).done);
        if (first && !linked) openCards.add(first.id);
      }

      const noData = !listOf(VC.data.services).length;
      VC.mount(el, html`
        ${VC.ui.pageHead({
          eyebrow: kit ? 'Step 3 · Setup & keys' : 'Setup & keys',
          title: 'Get your keys, the safe way',
          lead: kit
            ? html`Every account and key ${project.name ? html`<strong>${project.name}</strong>` : 'your app'} needs, in the right order, with exactly where each one goes. Tick the steps as you go.`
            : 'Every account and key your app needs, with exactly where each one goes. Tick the steps as you go.',
        })}

        ${explainer()}

        ${!kit ? picker(c) : ''}
        ${noData && kit ? html`<div class="section">${VC.ui.callout('warn', 'The step-by-step service guides didn\'t load, so some cards below are bare. Reload the page to try again.')}</div>` : ''}

        ${units.length
          ? html`${overview(c)}
            <section class="section stack sm" aria-label="Setup steps">
              ${units.map((u, i) => unitCard(u, i, c))}
            </section>
            <section class="section" id="setup-env">${envSection(c)}</section>`
          : kit
            ? html`<div class="section">${VC.ui.callout('success', 'Your kit doesn\'t need any outside services. Nothing to set up here!')}</div>`
            : html`<div class="section">${VC.ui.empty({
                icon: 'key',
                title: 'Pick your services above',
                body: 'Tick the services your app uses and we\'ll show you exactly how to get each key and where it goes.',
              })}</div>`}

        ${units.length || kit ? nextCta(c) : ''}
      `);

      // Put pasted values back into their boxes (set via JS so keys never sit in the HTML).
      el.querySelectorAll('input[data-key-ref]').forEach((input) => {
        const v = pasted.get(input.getAttribute('data-key-ref'));
        if (v) input.value = v;
      });

      /* ---------- Events ---------- */
      VC.delegate(el, 'input', 'input[data-key-ref]', (e, input) => onKeyInput(input));

      // Remember which cards are open (the toggle event doesn't bubble, so capture it).
      el.addEventListener('toggle', (e) => {
        const d = e.target;
        if (!(d instanceof Element) || !d.matches('details[data-unit]')) return;
        const id = d.getAttribute('data-unit');
        if (d.open) openCards.add(id); else openCards.delete(id);
      }, true);

      VC.delegate(el, 'change', 'input[data-step]', (e, box) => {
        const unitId = box.getAttribute('data-unit');
        const i = box.getAttribute('data-index');
        const on = box.checked;
        writeProgress(unitId, (cur) => { if (on) cur.steps[i] = true; else delete cur.steps[i]; });
        const label = box.closest('label');
        if (label) label.classList.toggle('is-done', on);
        const u = units.find((x) => x.id === unitId);
        if (!u) return;
        const prog = progressOf(unitId);
        const badge = el.querySelector(attrSel('data-unit-badge', unitId));
        if (badge) VC.mount(badge, html`${unitBadge(u, prog)}`);
        const btn = el.querySelector(attrSel('data-done-btn', unitId));
        if (btn) btn.classList.toggle('primary', stepsDone(u, prog) === u.steps.length);
      });

      VC.delegate(el, 'change', 'select[data-framework]', (e, sel) => {
        standalone.framework = sel.value;
        rerenderKeepFocus(ctx, '#setup-framework');
      });

      VC.delegate(el, 'click', '[data-action]', async (e, b) => {
        const act = b.getAttribute('data-action');
        const unitId = b.getAttribute('data-unit');
        const ref = b.getAttribute('data-ref');

        if (act === 'jump') {
          openAndScroll(unitId, true);
        } else if (act === 'done' || act === 'undone') {
          const done = act === 'done';
          writeProgress(unitId, (cur) => { cur.done = done; });
          if (done) {
            openCards.delete(unitId);
            const next = units.find((u) => u.id !== unitId && !progressOf(u.id).done);
            if (next) openCards.add(next.id);
            ctx.rerender();
            if (next) {
              VC.ui.toast('Nice! Next up: ' + next.name, 'success');
              openAndScroll(next.id, true);
            } else {
              VC.ui.toast('Everything is set up!', 'success');
              const env = document.getElementById('setup-env');
              if (env) env.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          } else {
            rerenderKeepFocus(ctx, 'button' + attrSel('data-done-btn', unitId));
          }
        } else if (act === 'reveal') {
          const input = el.querySelector('input' + attrSel('data-key-ref', ref));
          if (!input) return;
          const show = !revealed.has(ref);
          if (show) revealed.add(ref); else revealed.delete(ref);
          input.type = show ? 'text' : 'password';
          b.setAttribute('aria-pressed', String(show));
          VC.mount(b, html`${VC.icon('eye', 14)} ${show ? 'Hide' : 'Show'}`);
        } else if (act === 'clear-keys') {
          pasted.clear();
          revealed.clear();
          showValues = false;
          exported = false;
          ctx.rerender();
          VC.ui.toast('Pasted keys cleared from this tab');
        } else if (act === 'env-values') {
          showValues = !showValues;
          refreshEnv();
        } else if (act === 'env-copy' || act === 'env-download') {
          if (!last) return;
          const text = buildEnv(envRows(last), last, { fileName: last.envFileName });
          if (act === 'env-copy') {
            const ok = await VC.copyText(text);
            if (!ok) { VC.ui.toast('Couldn\'t copy. Try the Download button instead.', 'error'); return; }
            flashCopied(b);
          } else {
            VC.download(last.envFileName, text);
            VC.ui.toast('Downloaded ' + last.envFileName);
          }
          if (!exported) { exported = true; setTimeout(refreshEnv, act === 'env-copy' ? 1450 : 0); }
        } else if (act === 'copy-value') {
          const v = oneLine(pasted.get(ref) || '');
          if (!v) return;
          if (await VC.copyText(v)) flashCopied(b);
          else VC.ui.toast('Couldn\'t copy. Click "Show values" and copy it by hand.', 'error');
        } else if (act === 'goto-key') {
          const sid = String(ref || '').split('::')[0];
          openAndScroll(sid, false);
          const input = el.querySelector('input' + attrSel('data-key-ref', ref));
          if (input) setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (err) { /* ignore */ } }, 350);
        } else if (act === 'pick-builder') {
          const id = b.getAttribute('data-id');
          standalone.builderId = standalone.builderId === id ? null : id;
          rerenderKeepFocus(ctx, '[data-action="pick-builder"]' + attrSel('data-id', id));
        } else if (act === 'pick-service') {
          const id = b.getAttribute('data-id');
          if (standalone.services.has(id)) standalone.services.delete(id);
          else { standalone.services.add(id); if (!Array.from(standalone.services).some((x) => x !== id && !progressOf(x).done)) openCards.add(id); }
          rerenderKeepFocus(ctx, '[data-action="pick-service"]' + attrSel('data-id', id));
        }
      });

      // Deep link: #/setup?service=stripe scrolls to that card.
      if (linked) VC.nextFrame().then(() => openAndScroll(linked.id, false));
    },
  });
})();
