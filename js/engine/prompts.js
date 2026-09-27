/* Vibe Check — prompt engine (VC.engine.prompts).
   Turns a project (idea → direction → kit) into paste-ready text for the user's AI builder:
     brief()            the project brief, pasted ONCE as persistent context (CLAUDE.md, Knowledge…)
     starterPrompt()    the very first prompt: a clickable skeleton with fake data
     milestonePrompt()  one tight, scoped prompt per milestone
     improve()          a rule-based prompt improver (improveAI() is the optional AI upgrade)
     stuck()            a "break the loop" prompt for when the AI goes in circles
     tokenTips()        habits that spend fewer tokens and credits
   Offline and deterministic: the same project always gives the same text. No DOM access.
   Sibling modules (kit engine, data catalogs) are optional here — every lookup has a fallback.
   See docs/ARCHITECTURE.md → Engines. */
(function () {
  'use strict';
  const VC = window.VC;
  VC.engine = VC.engine || {};

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */
  const arr = (v) => (Array.isArray(v) ? v : []);
  /** One-line string: trimmed, inner whitespace collapsed. */
  const line = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
  /** Multi-line string: trimmed, line breaks kept. */
  const block = (v) => (v == null ? '' : String(v)).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  const tokens = (t) => (VC.estimateTokens ? VC.estimateTokens(t) : Math.ceil(String(t || '').length / 4));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  const unpunct = (s) => line(s).replace(/[\s.!?;:,]+$/, '');
  const period = (s) => { s = line(s); return !s || /[.!?"'`]$/.test(s) ? s : s + '.'; };
  const titleCase = (s) => (VC.titleCase ? VC.titleCase(s) : String(s || '').replace(/\b\w/g, (c) => c.toUpperCase()));
  const code = (name) => '`' + name + '`';

  /** "a, b and c" (or "a, b or c") */
  function listJoin(items, word) {
    const a = items.filter(Boolean);
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' ' + (word || 'and') + ' ' + a[a.length - 1];
  }
  /** Lower-case the first letter unless it starts an acronym or name ("Know exactly…" → "know exactly…"). */
  const lowerFirst = (s) => (s && /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s || '');
  /** Dedupe strings case-insensitively, keeping the first spelling. */
  function uniq(list) {
    const seen = new Set();
    return list.filter((s) => {
      const k = line(s).toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  /** Split prose into sentences, without breaking on "e.g." / "i.e." / "etc." / "vs.". */
  function sentences(text) {
    return line(text)
      .replace(/\b(e\.g|i\.e|etc|vs|approx|incl)\./gi, (m) => m.replace(/\./g, '\u0000'))
      .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(`[])/)
      .map((x) => x.replace(/\u0000/g, '.').trim())
      .filter(Boolean);
  }

  /* Near-duplicate detection for rules: two rules are "the same" when most of the
     meaningful words of the shorter one also appear in the longer one. */
  const STOP = new Set('the a an and or to of in on for with your you it its is are be this that from into only every all any use using make sure never always must should can by as at so their them they our we not no'.split(' '));
  /** Crude stemmer so "verifies"/"verify" and "keys"/"key" compare equal. */
  const stem = (w) => (w.length > 4 ? w.replace(/ies$/, 'i').replace(/(?<=(?:s|x|ch|sh))es$|(?<!s)s$|ing$|ed$|ly$/, '') : w.replace(/(?<![su])s$/, '')).replace(/y$/, 'i');
  function wordSet(s) {
    return new Set(line(s).toLowerCase().replace(/[^a-z0-9_ ]+/g, ' ').split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
  }
  function similar(a, b) {
    const A = wordSet(a);
    const B = wordSet(b);
    if (!A.size || !B.size) return false;
    let shared = 0;
    A.forEach((w) => { if (B.has(w)) shared++; });
    return shared / Math.min(A.size, B.size) >= 0.7 && shared / Math.max(A.size, B.size) >= 0.5;
  }
  /** Does text `a` already say what `b` says? (most of b's meaningful words appear in a) */
  function covers(a, b) {
    const A = wordSet(a);
    const B = wordSet(b);
    if (!B.size) return true;
    let shared = 0;
    B.forEach((w) => { if (A.has(w)) shared++; });
    return shared / B.size >= 0.75;
  }
  /** Add a rule unless a near-duplicate exists; a clearly longer duplicate replaces the shorter one. */
  function addRule(list, rule) {
    rule = period(rule);
    if (!rule) return list;
    for (let i = 0; i < list.length; i++) {
      if (similar(list[i], rule)) {
        if (rule.length > list[i].length * 1.25) list[i] = rule;
        return list;
      }
    }
    list.push(rule);
    return list;
  }

  /* ------------------------------------------------------------------ *
   * Lookups with fallbacks (siblings may not be loaded)
   * ------------------------------------------------------------------ */
  const BUILDER_NAMES = { lovable: 'Lovable', bolt: 'Bolt', replit: 'Replit', v0: 'v0', cursor: 'Cursor', 'claude-code': 'Claude Code' };
  const SERVICE_NAMES = {
    supabase: 'Supabase', firebase: 'Firebase', clerk: 'Clerk', stripe: 'Stripe', lemonsqueezy: 'Lemon Squeezy',
    anthropic: 'Claude API (Anthropic)', openai: 'OpenAI', replicate: 'Replicate', elevenlabs: 'ElevenLabs',
    resend: 'Resend', cloudinary: 'Cloudinary', uploadthing: 'UploadThing', mapbox: 'Mapbox', 'google-maps': 'Google Maps',
    twilio: 'Twilio', posthog: 'PostHog', sentry: 'Sentry', vercel: 'Vercel', netlify: 'Netlify', github: 'GitHub',
  };
  const FRAMEWORKS = { vite: 'React + Vite', next: 'Next.js', node: 'Node.js', expo: 'React Native (Expo)' };
  const PUBLIC_PREFIX = { vite: 'VITE_', next: 'NEXT_PUBLIC_', expo: 'EXPO_PUBLIC_', node: '' };
  /** How each category reads in a brief, for the AI (short and precise). */
  const ROLES = {
    hosting: 'hosting', database: 'database', auth: 'auth (sign-up/login)', payments: 'payments', ai: 'AI features',
    email: 'transactional email', storage: 'file storage', maps: 'maps', sms: 'SMS', analytics: 'product analytics',
    monitoring: 'error monitoring', realtime: 'realtime updates', media: 'media processing',
  };
  /** Services that are tools around the app (not features inside it). */
  const TOOLING = new Set(['github', 'vercel', 'netlify']);

  const kitOf = (p) => (p && p.kit ? p.kit : null);
  const milestones = (p) => arr(kitOf(p) && kitOf(p).milestones).filter((m) => m && m.id);
  const doneMap = (p) => (p && p.prompts && p.prompts.done) || {};

  function builderOf(p) {
    const kit = kitOf(p);
    let b = null;
    try { if (kit && VC.engine.kit && VC.engine.kit.builder) b = VC.engine.kit.builder(kit); } catch (e) { b = null; }
    const id = (kit && kit.builder && kit.builder.id) || (p && p.answers && p.answers.builder);
    if (!b && id && VC.data.builderById) b = VC.data.builderById(id);
    if (!b && id && BUILDER_NAMES[id]) b = { id, name: BUILDER_NAMES[id] };
    return b || null;
  }

  function serviceData(id) {
    return (VC.data.serviceById && VC.data.serviceById(id)) || { id, name: SERVICE_NAMES[id] || titleCase(String(id).replace(/-/g, ' ')), keys: [] };
  }

  /** The kit's services, deduped by serviceId, with catalog data. */
  function servicesOf(p) {
    const kit = kitOf(p);
    if (!kit) return [];
    let list = null;
    try { if (VC.engine.kit && VC.engine.kit.uniqueServices) list = VC.engine.kit.uniqueServices(kit); } catch (e) { list = null; }
    if (!Array.isArray(list) || !list.length) {
      const seen = new Set();
      list = [];
      arr(kit.services).forEach((s) => {
        if (!s || !s.serviceId || seen.has(s.serviceId)) return;
        seen.add(s.serviceId);
        list.push(serviceData(s.serviceId));
      });
    }
    return list.filter((s) => s && s.id);
  }

  /** Category IDs a service covers in THIS kit (Supabase → database, auth, storage). */
  function categoriesIn(p, serviceId) {
    return uniq(arr(kitOf(p) && kitOf(p).services).filter((s) => s && s.serviceId === serviceId).map((s) => s.category));
  }

  function frameworkOf(p) {
    const kit = kitOf(p);
    if (kit && FRAMEWORKS[kit.framework]) return kit.framework;
    const b = builderOf(p);
    if (b && FRAMEWORKS[b.framework]) return b.framework;
    return 'vite';
  }

  function envName(key, fw) {
    try { if (VC.engine.kit && VC.engine.kit.envName) { const n = VC.engine.kit.envName(key, fw); if (n) return n; } } catch (e) { /* fall through */ }
    const env = (key && key.env) || {};
    return env[fw] || env.node || env.vite || Object.values(env)[0] || String(key && key.id || 'KEY').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  /** [{name, secret}] for one service in this project's framework. */
  function keysOf(service, fw) {
    return arr(service && service.keys).map((k) => ({ name: envName(k, fw), secret: k.visibility === 'secret', label: k.label || k.id }));
  }

  function appName(p) {
    const d = (p && p.chosenDirection) || {};
    let n = line(p && p.name) || line(d.name);
    if (!n && p && p.idea) {
      try { n = VC.engine.directions && VC.engine.directions.ideaName ? line(VC.engine.directions.ideaName(p.idea)) : ''; } catch (e) { n = ''; }
    }
    return n || 'My app';
  }

  /** Where secret keys live for this stack (said to the AI). */
  function serverPlace(p) {
    const fw = frameworkOf(p);
    const ids = servicesOf(p).map((s) => s.id);
    if (fw === 'next') return 'server-side code (API routes or server actions)';
    if (ids.indexOf('supabase') !== -1) return 'Supabase Edge Functions';
    if (ids.indexOf('firebase') !== -1) return 'Firebase Cloud Functions';
    if (fw === 'node') return 'server-side code';
    if (ids.indexOf('netlify') !== -1) return 'Netlify Functions';
    if (ids.indexOf('vercel') !== -1) return 'serverless functions (the /api folder on Vercel)';
    return 'server-side code';
  }

  /** Where the user will put key values (said to the AI). */
  function keyHome(p) {
    const b = builderOf(p);
    const s = b && b.secrets;
    if (s && s.envFile && s.envFileName) return code(s.envFileName);
    if (b && b.name) return b.name + '\'s secrets settings';
    return 'the env settings';
  }

  function contextMeta(p) {
    const b = builderOf(p);
    const cf = b && b.contextFile ? b.contextFile : null;
    return {
      filename: cf && cf.filename ? cf.filename : null,
      name: (cf && cf.name) || 'Project brief',
      how: (cf && cf.how) || 'Paste it at the start of each new chat, or into your tool\'s project instructions or knowledge setting, so the AI always has it.',
    };
  }
  /** How prompts refer to the brief: "CLAUDE.md" or "Project Knowledge". */
  function briefRef(p) {
    const m = contextMeta(p);
    return m.filename || m.name;
  }

  function platformLine(p) {
    const plat = p && p.answers && p.answers.platform;
    if (frameworkOf(p) === 'expo') return 'Mobile app for iPhone and Android.';
    if (plat === 'mobile') return 'Mobile-first web app: design for phone screens first.';
    if (plat === 'both') return 'Works on phones and desktops (design mobile-first).';
    return 'Responsive: works on phones and desktops.';
  }

  /* ------------------------------------------------------------------ *
   * "Data it stores" — inferred from the idea, pitch and features
   * ------------------------------------------------------------------ */
  const NOUNS = ('artist client customer lead contact member student teacher tutor coach patient candidate employee guest attendee vendor seller buyer '
    + 'host driver creator player team beat song album playlist video photo post comment review rating message conversation booking appointment '
    + 'reservation class lesson course quiz assignment event ticket listing product order invoice task note goal habit workout meal recipe '
    + 'ingredient expense transaction budget job application shift property room pet plant document template deal campaign collection '
    + 'wishlist favorite placement submission project portfolio').split(' ');
  function plural(w) {
    if (/(s|x|ch|sh)$/.test(w)) return w + 'es';
    if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
    return w + 's';
  }
  function inferRecords(p) {
    const d = (p && p.chosenDirection) || {};
    const text = [p && p.idea, d.pitch].concat(arr(d.features)).join(' . ').toLowerCase();
    const found = [];
    NOUNS.forEach((n) => {
      const pl = plural(n);
      const re = new RegExp('(?<!in )\\b(' + n + '|' + pl + ')\\b');
      const m = text.match(re);
      if (m) found.push({ word: pl, at: m.index });
    });
    return found.sort((a, b) => a.at - b.at).slice(0, 7).map((f) => titleCase(f.word));
  }

  /** Name of the kit service that covers a category ('auth' → 'Supabase'), or ''. */
  function serviceForCategory(p, cat) {
    const s = arr(kitOf(p) && kitOf(p).services).find((x) => x && x.category === cat);
    return s ? serviceData(s.serviceId).name : '';
  }

  function needsOf(p) {
    const d = (p && p.chosenDirection) || {};
    const fromKit = arr(kitOf(p) && kitOf(p).services).map((s) => s && s.category);
    return uniq(arr(d.needs).concat(fromKit).filter(Boolean));
  }

  /* ------------------------------------------------------------------ *
   * Rules — kit safety rules + condensed service snippets
   * ------------------------------------------------------------------ */
  const SAFETY_WORDS = /\b(never|must|always|only|rls|row level|secret|server|webhook|verif|rate.?limit|validat|polic|sanitiz|escape|permission|private|expos|leak)/i;

  /**
   * The most useful 1–3 sentences of a service's promptSnippet, minus anything already said.
   * `rules` are the kit's rules: a snippet sentence that repeats one is dropped — or, if the
   * snippet says it more precisely, the rule is dropped instead. `covered` are things the brief
   * already says elsewhere (stack roles, key rules); they only block, never print.
   */
  function condensedSnippet(snippet, rules, covered, max) {
    const out = [];
    sentences(snippet).forEach((s, i) => {
      if (out.length >= (max || 2)) return;
      if (covered.some((r) => similar(r, s)) || out.some((r) => similar(r, s))) return;
      const dup = rules.findIndex((r) => similar(r, s));
      if (dup !== -1) {
        // The snippet says it more precisely: keep it here (with its service name) and drop the vaguer rule.
        if (s.length > rules[dup].length * 1.25) rules.splice(dup, 1);
        else return;
      }
      if (i === 0 || SAFETY_WORDS.test(s)) out.push(period(s));
    });
    return out.join(' ');
  }

  /** Which topics a piece of text touches (for picking the rules relevant to a milestone). */
  const TOPICS = {
    database: /\b(rls|row level|tables?|database|polic(y|ies)|sql|quer(y|ies)|records?|rows?|supabase|firebase|firestore)\b/i,
    auth: /\b(log ?ins?|sign ?ups?|auth\w*|passwords?|sessions?|accounts?|users?|clerk)\b/i,
    payments: /\b(pay\w*|stripe|checkout|webhooks?|subscriptions?|prices?|refunds?|billing|lemon ?squeezy)\b/i,
    ai: /\b(ai|llm|claude|openai|anthropic|models?|prompts?|replicate|elevenlabs|generat\w*)\b/i,
    storage: /\b(uploads?|files?|images?|buckets?|storage|photos?|videos?|cloudinary|uploadthing)\b/i,
    email: /\b(emails?|resend|inbox)\b/i,
    sms: /\b(sms|text messages?|twilio|phone)\b/i,
    maps: /\b(maps?|mapbox|locations?|address(es)?|geocod\w*)\b/i,
    hosting: /\b(deploy\w*|hosting|domains?|vercel|netlify|production|go(ing)? live|launch)\b/i,
    analytics: /\b(analytics|posthog|tracking|cookies?)\b/i,
    monitoring: /\b(sentry|monitoring|error reports?)\b/i,
  };
  function topicsOf(text) {
    return Object.keys(TOPICS).filter((t) => TOPICS[t].test(text || ''));
  }
  /** Topics that apply to almost every step (most features read and write data for a logged-in user). */
  const GENERIC_TOPICS = new Set(['database', 'auth']);

  /* ------------------------------------------------------------------ *
   * Brief (persistent project context)
   * ------------------------------------------------------------------ */
  const STARTER_ID = 'starter';
  /** What the brief's key lines already say; kit rules repeating them are skipped. */
  const KEY_RULES = [
    'Keep secret keys out of frontend code',
    'Never commit .env files or keys to git',
    'Never put API keys in code or chat; use env vars',
  ];
  const SKELETON_RE = /skeleton|layout|screens?|shell|mock|prototype|foundation|clickable|\bpages?\b|\bui\b|design|look|sample data|fake data/i;

  /** The kit milestone the starter prompt covers (a service-free "skeleton" first milestone), or null. */
  function starterMilestone(p) {
    const m = milestones(p)[0];
    if (!m || arr(m.services).length) return null;
    return SKELETON_RE.test(line(m.title) + ' ' + line(m.goal)) ? m : null;
  }

  /** Ordered build steps: the starter first, then every milestone it doesn't already cover. */
  function steps(p) {
    const ms = milestones(p);
    if (!ms.length) return [];
    const sm = starterMilestone(p);
    const out = [{
      id: sm ? sm.id : STARTER_ID, kind: 'starter', number: sm ? 1 : 0,
      title: sm ? line(sm.title) : 'Clickable skeleton', goal: sm ? line(sm.goal) : 'Every screen, with realistic fake data, so you can click through the whole app before anything real is connected.',
      milestone: sm || null, size: sm ? sm.size : 'M', services: [], prompt: starterPrompt(p),
    }];
    ms.forEach((m, i) => {
      if (m === sm) return;
      out.push({ id: m.id, kind: 'milestone', number: i + 1, title: line(m.title), goal: line(m.goal), milestone: m, size: m.size, services: arr(m.services), prompt: milestonePrompt(p, m) });
    });
    out.forEach((s) => { s.tokens = tokens(s.prompt); });
    return out;
  }

  function brief(project) {
    const p = project || {};
    const d = p.chosenDirection || {};
    const b = builderOf(p);
    const fw = frameworkOf(p);
    const services = servicesOf(p);
    const out = [];

    out.push('# ' + appName(p) + ' — project brief', '');
    const pitch = period(d.pitch || p.idea);
    if (pitch) out.push(pitch);
    if (d.audience) out.push('For: ' + period(d.audience));
    out.push('');

    // Stack
    out.push('## Stack');
    out.push('- Built with ' + (b ? b.name + ' · ' : '') + FRAMEWORKS[fw]);
    const stackLines = [];
    services.forEach((s) => {
      const roles = categoriesIn(p, s.id).map((c) => ROLES[c] || c);
      const role = roles.length ? listJoin(uniq(roles)) : (s.id === 'github' ? 'code backup and version history' : unpunct(s.tagline || '').toLowerCase());
      stackLines.push('Use ' + s.name + ' for ' + role);
      out.push('- ' + s.name + (role ? ': ' + role : ''));
    });
    out.push('');

    // Features
    let features = arr(d.features).map(unpunct).filter(Boolean);
    if (!features.length) features = milestones(p).reduce((all, m) => all.concat(arr(m.features).map(unpunct)), []).slice(0, 8);
    if (features.length) {
      out.push('## Core features');
      uniq(features).slice(0, 10).forEach((f) => out.push('- ' + cap(f)));
      out.push('');
    }

    // Data
    const needs = needsOf(p);
    const data = [];
    const records = inferRecords(p);
    if (records.length) data.push('Main records: ' + records.join(', '));
    if (needs.indexOf('auth') !== -1) {
      const via = serviceForCategory(p, 'auth');
      data.push('User accounts and profiles' + (via ? ' (' + via + ')' : '') + '. Every record stores its owner\'s user id; people can only change their own records');
    }
    if (needs.indexOf('payments') !== -1) {
      const via = serviceForCategory(p, 'payments') || 'the payment provider';
      data.push('Payments: ' + via + ' customer/subscription IDs and status only, never card details');
    }
    if (needs.indexOf('storage') !== -1) {
      const via = serviceForCategory(p, 'storage');
      data.push('Uploaded files live in ' + (via ? via + ' storage' : 'file storage') + '; the database keeps only the link');
    }
    if (needs.indexOf('ai') !== -1) data.push('AI results worth keeping (so they aren\'t paid for twice)');
    if (data.length) {
      out.push('## Data it stores');
      data.forEach((x) => out.push('- ' + period(x)));
      out.push('');
    }

    // Look & feel
    out.push('## Look & feel');
    out.push((d.vibe ? period(cap(d.vibe)) + ' ' : '') + platformLine(p) + ' Every screen has friendly loading, empty and error states.');
    out.push('');

    // Rules
    out.push('## Rules');
    const allKeys = [];
    services.forEach((s) => keysOf(s, fw).forEach((k) => allKeys.push(k)));
    const pub = uniq(allKeys.filter((k) => !k.secret).map((k) => k.name));
    const sec = uniq(allKeys.filter((k) => k.secret).map((k) => k.name));
    out.push('- Keys live in env vars, never in code, commits or chat. Refer to them by name.');
    if (pub.length) out.push('  - Public (OK in the app): ' + pub.map(code).join(', '));
    if (sec.length) out.push('  - Secret (only in ' + serverPlace(p) + '): ' + sec.map(code).join(', '));
    if (!sec.length) out.push('  - Secret keys only ever go in ' + serverPlace(p) + '.');
    const s = b && b.secrets;
    if (s && s.envFile && s.envFileName) out.push('- ' + code(s.envFileName) + ' holds the values and must be listed in .gitignore.');
    // Already said above (keys) or in the Stack section: kit rules and snippets repeating these are skipped.
    const covered = KEY_RULES.concat(stackLines);
    const rules = [];
    arr(kitOf(p) && kitOf(p).safetyRules).forEach((r) => { if (!covered.some((c) => similar(c, r))) addRule(rules, r); });
    const snippetLines = [];
    services.forEach((svc) => {
      if (!svc.promptSnippet) return;
      const c = condensedSnippet(svc.promptSnippet, rules, covered);
      if (c) snippetLines.push('- ' + svc.name + ': ' + c);
    });
    rules.forEach((r) => out.push('- ' + r));
    snippetLines.forEach((l) => out.push(l));
    out.push('');

    // How to work with me
    const exp = p.answers && p.answers.experience;
    out.push('## How to work with me');
    out.push('- Small steps: one feature at a time, then stop so I can test it.');
    out.push('- Before big changes (new library, database change, deleting or moving files), show me a short plan and wait for my OK.');
    out.push('- Only touch files needed for the current task. Don\'t refactor, rename or restyle anything else.');
    out.push(exp === 'shipped'
      ? '- After each change, tell me briefly what changed and how to test it.'
      : '- I don\'t read code: after each change, explain in plain English what changed and how to test it.');
    out.push('- Never put API keys or passwords in code, and never ask me to paste them in chat. Tell me the env var name and I\'ll set it.');
    out.push('- If a fix fails twice, stop and list the likely causes instead of guessing again.');

    // Build plan
    const ms = milestones(p);
    if (ms.length) {
      const done = doneMap(p);
      const sm = starterMilestone(p);
      const list = steps(p);
      const current = list.find((x) => !done[x.id]);
      out.push('');
      out.push('## Build plan (one milestone at a time; don\'t start the next until I ask)');
      if (!sm) out.push('- [' + (done[STARTER_ID] ? 'x' : ' ') + '] 0. Clickable skeleton with fake data' + (current && current.id === STARTER_ID ? ' ← current' : ''));
      ms.forEach((m, i) => {
        out.push('- [' + (done[m.id] ? 'x' : ' ') + '] ' + (i + 1) + '. ' + unpunct(m.title) + (current && current.id === m.id ? ' ← current' : ''));
      });
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function contextFile(project) {
    const m = contextMeta(project);
    let content = brief(project);
    // Cursor rule files (.mdc) need front matter, or Cursor won't apply them automatically.
    if (m.filename && /\.mdc$/i.test(m.filename)) {
      content = '---\ndescription: Project brief for ' + appName(project) + '. Read before every task.\nalwaysApply: true\n---\n\n' + content;
    }
    return { filename: m.filename, name: m.name, how: m.how, content };
  }

  /* ------------------------------------------------------------------ *
   * Starter prompt (skeleton with fake data)
   * ------------------------------------------------------------------ */
  const BLOCKS = {
    hero: 'a big header section', row2: 'a row of 2 cards', row3: 'a row of 3 cards', list: 'a list', form: 'a form',
    chart: 'a chart', table: 'a table', chat: 'a chat thread', map: 'a map (a placeholder image is fine for now)',
    player: 'an audio/video player', calendar: 'a calendar', button: 'a main call-to-action button', tall: 'a large content area', grid: 'a grid of cards',
  };
  function describeScreen(s) {
    const parts = uniq(arr(s.blocks).filter((x) => x !== 'nav').map((x) => BLOCKS[x]).filter(Boolean));
    return line(s.name) + (parts.length ? ': ' + parts.join(', ') : '');
  }
  const SAMPLE_FILE = { vite: 'src/data/sample.ts', next: 'lib/sample-data.ts', expo: 'data/sample.ts', node: 'data/sample.js' };

  function starterPrompt(project) {
    const p = project || {};
    const d = p.chosenDirection || {};
    const b = builderOf(p);
    const fw = frameworkOf(p);
    const sm = starterMilestone(p);
    const inApp = servicesOf(p).filter((s) => !TOOLING.has(s.id)).map((s) => s.name);
    const local = b && (b.id === 'cursor' || b.id === 'claude-code');
    const out = [];

    const pitch = unpunct(d.pitch || p.idea);
    out.push('Let\'s build ' + appName(p) + (pitch ? ': ' + lowerFirst(pitch) : '') + '.');
    out.push('Read the project brief (' + briefRef(p) + ') first. It has the full plan and the rules.');
    out.push('');
    out.push('Goal: a clickable skeleton of the whole app with realistic fake data. '
      + (inApp.length ? 'Don\'t connect ' + listJoin(inApp, 'or') + ' yet; we\'ll add each one in its own step.' : 'Don\'t connect any outside services yet.'));
    out.push('');

    if (local) {
      out.push('Setup:');
      out.push(fw === 'expo'
        ? '- Create an Expo (React Native) app in this folder, with TypeScript.'
        : '- Create a ' + FRAMEWORKS[fw] + ' app in this folder, with TypeScript and Tailwind CSS.');
      out.push('- Add a .gitignore that covers .env*, node_modules and build output.');
      out.push('- Initialize git and commit when the skeleton works.');
      out.push('');
    }

    const screens = arr(d.screens).filter((s) => s && s.name);
    out.push('Screens:');
    if (screens.length) screens.forEach((s) => out.push('- ' + describeScreen(s)));
    else out.push('- A home screen, plus one screen for each core feature in the brief');
    out.push('');

    out.push('Build:');
    out.push('- Navigation that reaches every screen.');
    // The skeleton milestone's own features, minus any that just restate the screen list.
    const screenText = screens.map((x) => x.name).join(' ') + ' screens pages';
    if (sm) arr(sm.features).forEach((f) => { if (!(screens.length && covers(screenText, f))) out.push('- ' + period(cap(f))); });
    out.push('- Put all fake data in one file (e.g. ' + code(SAMPLE_FILE[fw]) + ') so it\'s easy to swap for the real database later.');
    if (inApp.length) out.push('- Buttons that will need a service later (log in, pay, AI and so on) show a friendly "Coming soon" message.');
    out.push('- Look & feel: ' + (d.vibe ? period(cap(d.vibe)) + ' ' : '') + platformLine(p));
    out.push('');

    out.push('Rules:');
    out.push('- Only this step: no login, database, payments or API calls yet.');
    out.push('- Small components, one per file, with clear names.');
    out.push('- Ask me before adding any library beyond the basics.');
    out.push('');

    out.push('Done when:');
    const own = sm ? arr(sm.doneWhen).map(unpunct).filter(Boolean) : [];
    if (!own.some((c) => /\b(screens?|pages?|menu|navigation|nav)\b/i.test(c))) out.push('- I can reach every screen from the navigation.');
    out.push('- Every screen shows realistic fake data (no "Lorem ipsum").');
    own.forEach((c) => out.push('- ' + period(cap(c))));
    out.push(fw === 'expo' ? '- It looks right on a phone, with no red error screens.' : '- It looks right at phone and desktop width, with no errors in the browser console.');
    out.push('');
    out.push('When finished: tell me in plain English what you built and how to click through it.');
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Milestone prompt
   * ------------------------------------------------------------------ */
  function milestonePrompt(project, milestone) {
    const p = project || {};
    const ms = milestones(p);
    const m = milestone ? (ms.find((x) => x.id === milestone.id) || milestone) : ms[0];
    if (!m) return '';
    const b = builderOf(p);
    const fw = frameworkOf(p);
    const idx = Math.max(0, ms.indexOf(m));
    const total = ms.length || 1;
    const sm = starterMilestone(p);
    const out = [];

    out.push('Milestone ' + (idx + 1) + ' of ' + total + ': ' + unpunct(m.title));
    let built = '';
    if (idx === 0 && !sm) built = 'The clickable skeleton (with fake data) is already built. Build on it; don\'t redo it.';
    else if (idx === 1 && sm) built = 'Milestone 1 (the skeleton) is done. Build on it; don\'t redo it.';
    else if (idx === 1) built = 'The skeleton and milestone 1 are done. Build on them; don\'t redo them.';
    else if (idx > 1) built = (sm ? 'Milestones' : 'The skeleton and milestones') + ' 1–' + idx + ' are done. Build on them; don\'t redo them.';
    out.push(('Follow the project brief (' + briefRef(p) + '). ' + built).trim());
    out.push('');

    out.push('Goal: ' + period(cap(m.goal || m.title)));
    out.push('');

    const features = arr(m.features).map(unpunct).filter(Boolean);
    if (features.length) {
      out.push('Build:');
      features.forEach((f) => out.push('- ' + period(cap(f))));
      out.push('');
    }

    // What this step is about. A single-purpose service adds its category (Stripe → payments);
    // multi-purpose ones (Supabase) don't, or every Supabase step would look like a file-upload step.
    const svcs = uniq(arr(m.services)).map(serviceData);
    const mTopics = new Set(topicsOf([m.title, m.goal].concat(arr(m.features)).join(' ')));
    svcs.forEach((s) => { const cats = categoriesIn(p, s.id); if (cats.length === 1) mTopics.add(cats[0]); });
    const relevantHere = (text) => {
      const specific = topicsOf(text).filter((t) => !GENERIC_TOPICS.has(t));
      return !specific.length || specific.some((t) => mTopics.has(t));
    };

    // Services used in this step: their snippet (minus sentences about other steps) and exact env var names.
    const native = arr(b && b.nativeIntegrations);
    const said = [];          // sentences already in this prompt, so rules don't repeat them
    let hasKeys = false;
    let hasSecret = false;
    if (svcs.length) {
      out.push('Services:');
      svcs.forEach((s) => {
        const roles = categoriesIn(p, s.id).map((c) => ROLES[c] || c);
        const parts = sentences(s.promptSnippet).filter((x, i) => i === 0 || relevantHere(x));
        if (!parts.length) parts.push('Use ' + s.name + (roles.length ? ' for ' + listJoin(roles) : '') + '.');
        parts.forEach((x) => said.push(x));
        const isNative = native.indexOf(s.id) !== -1 && b;
        out.push('- ' + s.name + (isNative ? ' (use ' + b.name + '\'s built-in ' + s.name + ' integration)' : '') + ': ' + parts.map(period).join(' '));
        // Built-in integrations wire up the public keys themselves; only name the secret ones.
        const keys = keysOf(s, fw);
        const pub = isNative ? [] : keys.filter((k) => !k.secret).map((k) => code(k.name));
        const sec = keys.filter((k) => k.secret).map((k) => code(k.name));
        if (pub.length || sec.length) hasKeys = true;
        if (sec.length) hasSecret = true;
        const kp = [];
        if (pub.length) kp.push(pub.join(', ') + ' (public)');
        if (sec.length) kp.push(sec.join(', ') + ' (secret: server only)');
        if (kp.length) out.push('  Keys: ' + kp.join('; '));
      });
      out.push('');
    }

    // Rules: keys, the safety rules that matter for THIS step (not already said), and scope.
    out.push('Rules:');
    if (hasKeys) {
      out.push('- Read keys from these env vars by name. Never hard-code a key or ask me to paste one in chat; tell me which variable to set and I\'ll add it in ' + keyHome(p) + '.');
    }
    if (hasSecret) {
      const pre = PUBLIC_PREFIX[fw];
      out.push('- Secret keys only in ' + serverPlace(p) + '. Never in frontend code' + (pre ? ' or a ' + pre + ' variable' : '') + '.');
    }
    const blockers = said.concat(hasKeys ? KEY_RULES : []);
    const rules = [];
    const consider = (r) => {
      if (!line(r) || !relevantHere(r) || blockers.some((x) => similar(x, r) || covers(x, r))) return;
      addRule(rules, r);
    };
    arr(kitOf(p) && kitOf(p).safetyRules).forEach(consider);
    svcs.forEach((s) => arr(s.safety).forEach(consider));
    rules.slice(0, 6).forEach((r) => out.push('- ' + r));
    out.push('- Only change files needed for this milestone. Don\'t refactor or restyle anything else, and keep existing features working.');
    out.push('');

    if (m.size === 'L') {
      out.push('Before coding: give me a short plan (files you\'ll add or change, any database changes) and wait for my OK.');
      out.push('');
    }

    out.push('Done when:');
    arr(m.doneWhen).map(unpunct).filter(Boolean).forEach((c) => out.push('- ' + period(cap(c))));
    if (idx > 0 || !sm) out.push('- Everything from earlier milestones still works.');
    if (hasSecret) out.push('- No secret key appears in frontend code.');
    out.push('');
    out.push('When finished: tell me in plain English what changed and how to test it, step by step.');
    return out.join('\n');
  }

  /* ------------------------------------------------------------------ *
   * Secret detection (shared by improve() and stuck())
   * ------------------------------------------------------------------ */
  const SECRET_KINDS = [
    { re: /sk-ant-[A-Za-z0-9_-]{20,}/g, name: 'Claude (Anthropic) API key', service: 'anthropic', env: 'ANTHROPIC_API_KEY' },
    { re: /\b[sr]k_live_[A-Za-z0-9]{10,}/g, name: 'Stripe live secret key', service: 'stripe', env: 'STRIPE_SECRET_KEY' },
    { re: /\b[sr]k_test_[A-Za-z0-9]{10,}/g, name: 'Stripe test secret key', service: 'stripe', env: 'STRIPE_SECRET_KEY' },
    { re: /\bwhsec_[A-Za-z0-9]{10,}/g, name: 'Stripe webhook secret', service: 'stripe', env: 'STRIPE_WEBHOOK_SECRET' },
    { re: /\bsk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g, name: 'OpenAI API key', service: 'openai', env: 'OPENAI_API_KEY' },
    { re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, name: 'Resend API key', service: 'resend', env: 'RESEND_API_KEY' },
    { re: /\bAKIA[0-9A-Z]{16}\b/g, name: 'AWS access key', env: 'AWS_ACCESS_KEY_ID' },
    { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, name: 'Google API key', env: 'GOOGLE_API_KEY' },
    { re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g, name: 'GitHub token', service: 'github', env: 'GITHUB_TOKEN' },
    { re: /\br8_[A-Za-z0-9]{30,}/g, name: 'Replicate API token', service: 'replicate', env: 'REPLICATE_API_TOKEN' },
    { re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g, name: 'Slack token', env: 'SLACK_TOKEN' },
    { re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, name: 'Supabase key or login token', service: 'supabase', env: 'SUPABASE_SERVICE_ROLE_KEY', jwt: true },
    { re: /\bsb_secret_[A-Za-z0-9_-]{10,}/g, name: 'Supabase secret key', service: 'supabase', env: 'SUPABASE_SECRET_KEY' },
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, name: 'private key', env: 'PRIVATE_KEY' },
    { re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'`]+/gi, name: 'database connection string', env: 'DATABASE_URL' },
    { re: /\b(?:[A-Z0-9]+_)*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*["']?[^\s"'`]{8,}/gi, name: 'password or secret value' },
  ];

  /** The "role" claim of a JWT (Supabase legacy keys say anon or service_role), or null. */
  function jwtRole(token) {
    try {
      let b64 = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload = JSON.parse(atob(b64));
      return payload && typeof payload.role === 'string' ? payload.role : null;
    } catch (e) {
      return null;
    }
  }

  /** Find secrets in text → [{name, service, env, public}] (one entry per kind). Never returns the secret itself.
      public = true for keys that are public by design (a Supabase anon key): still don't paste them, but no need to replace them. */
  function detectSecrets(text) {
    const t = String(text == null ? '' : text);
    const found = [];
    SECRET_KINDS.forEach((k) => {
      k.re.lastIndex = 0;
      const matches = t.match(k.re) || [];
      k.re.lastIndex = 0;
      matches.forEach((m) => {
        let item = { name: k.name, service: k.service || null, env: k.env || null, public: false };
        if (k.jwt) {
          const role = jwtRole(m);
          if (role === 'anon') item = { name: 'Supabase anon key', service: 'supabase', env: null, public: true };
          else if (role === 'service_role') item = { name: 'Supabase service_role key', service: 'supabase', env: 'SUPABASE_SERVICE_ROLE_KEY', public: false };
        }
        if (!found.some((f) => f.name === item.name)) found.push(item);
      });
    });
    return found;
  }

  /** Remove every secret we can recognise (VC.ai.redact plus the extra patterns above). */
  function redactAll(text) {
    let out = String(text == null ? '' : text);
    if (VC.ai && VC.ai.redact) out = VC.ai.redact(out);
    SECRET_KINDS.forEach((k) => {
      out = out.replace(k.re, (m) => {
        const eq = m.match(/^([A-Za-z0-9_]+\s*[=:]\s*["']?)/);
        return eq && /[=:]/.test(eq[1]) ? eq[1] + '[REDACTED]' : '[REDACTED]';
      });
      k.re.lastIndex = 0;
    });
    return out;
  }

  /** Best env var name for a detected secret, using the project's own catalog names when possible. */
  function envForSecret(found, p) {
    if (found.service && p) {
      const s = servicesOf(p).find((x) => x.id === found.service);
      const k = s && arr(s.keys).find((x) => x.visibility === 'secret');
      if (k) return envName(k, frameworkOf(p));
    }
    return found.env;
  }

  function envForPublic(found, p) {
    if (found.service && p) {
      const s = servicesOf(p).find((x) => x.id === found.service);
      const k = s && arr(s.keys).find((x) => x.visibility !== 'secret' && /anon|publishable|public/i.test(x.id + ' ' + (x.label || '')));
      if (k) return envName(k, frameworkOf(p));
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Prompt improver (rule-based)
   * ------------------------------------------------------------------ */
  const ACRONYMS = new Set(('API APIS AI UI UX URL URLS CSS HTML JSON SQL RLS JWT ID IDS OK PDF SMS CRM SDK CORS HTTP HTTPS DB ENV CLI SEO '
    + 'FAQ CTA MVP SAAS IOS USD EUR GBP GPT LLM AWS GCP DNS SSL TLS CSV XML PNG JPG JPEG SVG GIF MP3 MP4 NPM README TODO CMS KPI ASAP '
    + 'USA UK EU PM AM IP QR OTP OAUTH SSO MFA GDPR PWA RSS VAT TOS FYI ETA DM DMS UTC').split(' '));

  const FILLER = [
    [/^\s*(?:hi|hey|hello|yo)\b(?: there)?(?: claude| lovable| cursor| bolt| ai)?\s*[,!.]*\s*/i, ''],
    [/\bi was wondering if you could\s+/gi, ''],
    [/\bi (?:would|'d) (?:really )?(?:like|love|want) (?:for )?you to\s+/gi, ''],
    [/\bi (?:need|want) you to\s+/gi, ''],
    [/(^|[.!?]\s+|\n)(?:can|could|would|will) you(?: please)?(?: possibly| maybe)?\s+/gi, '$1'],
    [/\bif (?:it'?s not too much trouble|you don'?t mind|possible|you can)\s*,?\s*/gi, ''],
    [/\b(?:please|pls|plz|kindly)\b\s*,?\s*/gi, ''],
    [/\b(?:thank you|thanks|thx|ty)(?: so much| a lot| in advance| very much| again)?\b\s*[.!]*\s*/gi, ''],
    [/\bi(?:'d| would) (?:really |greatly )?appreciate (?:it|your help|that)\b\s*[.!]*\s*/gi, ''],
    [/\byou(?:'re| are) (?:an? |the )?(?:world[- ]class|expert|senior|amazing|genius|brilliant|best|10x)\b[^.!?\n]*[.!?]?\s*/gi, ''],
    [/\b(?:basically|literally|honestly|kind of|sort of|super duper)\b\s*/gi, ''],
    [/\b(?:really|very|super) (?=really|very|super)/gi, ''],
  ];

  const VAGUE = [
    { id: 'design', re: /\bmake (?:it|this|the (?:app|site|page|design|ui|dashboard|homepage|screen))\s+(?:look\s+)?(?:better|good|nicer|nice|pretty|prettier|modern|cool|clean|cleaner|pop|professional|sleek|amazing|awesome|beautiful|perfect|fancy)\b|\b(?:improve|fix|redo|update|polish) the (?:design|look|ui|styling|style|layout)\b|\blooks? (?:bad|ugly|off|weird|boring|meh)\b/i },
    { id: 'fix', re: /\bfix (?:it|this|that|everything|the (?:bugs?|errors?|issues?|problems?))\b|\b(?:it'?s|it is|this is|still|everything is) (?:broken|not working)\b|\b(?:doesn'?t|does not|won'?t|isn'?t|is not) work(?:ing)?\b/i },
    { id: 'everything', re: /\b(?:add|build|do|make|finish|complete)\s+(?:everything|all (?:the )?(?:features|of it|the rest|pages|screens)|the rest|whatever|more features|the whole (?:app|thing|site))\b|\bfinish (?:it|the app)\b/i },
    { id: 'better', re: /\bmake (?:it|this|everything) (?:better|work|perfect|good)\b|\bimprove (?:it|this|everything|the app)\b|\bclean (?:it|this|everything) up\b|\boptimi[sz]e (?:it|this|everything)\b/i },
  ];
  const SYMPTOM_RE = /\b(when|after|error|says|shows?|instead|expected|nothing happens|blank|crash\w*|freez\w*|500|404|undefined|null|console|message)\b|["'`]/i;
  const DESIGN_DETAIL_RE = /\b(colou?rs?|fonts?|spacing|padding|margins?|sizes?|bigger|smaller|align\w*|dark mode|contrast|layout|mobile|header|button|cards?|logo|images?|icons?|shadows?|rounded|gradient|#[0-9a-f]{3,6}|px|rem)\b/i;
  const DONE_RE = /\b(done when|it'?s done|success(?:ful)? (?:is|when|means)|acceptance|should (?:see|be able|show|display|appear|redirect|return|work|stay|save|load)|expect(?:ed)?|make sure|test (?:it|that|by)|verify|check that|so that i can)\b/i;
  const SCOPE_RE = /\b(only|just|don'?t (?:change|touch|modify|edit|rewrite|refactor|remove|break)|do not (?:change|touch|modify|edit|rewrite|refactor|remove|break)|leave .{1,40}(?:alone|as is)|without (?:changing|touching|breaking)|nothing else|keep (?:the|everything|all|it|existing))\b/i;
  const CONTEXT_RE = /\b(brief|claude\.md|agents\.md|knowledge|\.cursor\w*|cursorrules|rules file|project (?:brief|context|instructions|knowledge|file)|readme|spec)\b|@[\w./-]+/i;
  const EXPLAIN_RE = /\b(explain|tell me (?:what|how)|summar(?:y|ise|ize)|walk me through)\b/i;
  const VERB = '(?:add|build|create|make|implement|integrate|set ?up|include|put|connect|allow|let|enable|support|show|display|fix|change|update|remove|redesign|replace|move)';
  const VERB_START = new RegExp('^\\s*(?:also\\s+|then\\s+|and\\s+|now\\s+)?(' + VERB + ')\\b', 'i');
  const BIG_RE = /\b(log ?in|sign ?up|auth\w*|accounts?|pay\w*|stripe|checkout|subscriptions?|database|uploads?|ai|chat\w*|messag\w*|notifications?|emails?|maps?|search|admin|dashboard|profiles?|calendar|bookings?)\b/i;
  const CONSTRAINT_RE = /^(?:don'?t|do not|never|only|avoid|keep|without|no need|leave|make sure (?:not|you don'?t))\b|\b(?:don'?t|do not) (?:change|touch|modify|edit|remove|delete|rewrite|refactor|break|use|add)\b/i;
  const DONE_LINE_RE = /^(?:done when|it'?s done when|success|acceptance|expected|test|verify|check that|make sure)\b|\bshould (?:see|be able|show|display|appear|redirect|return|save|load|work|stay|update|open|send|take|go)\b/i;
  const BUG_RE = /\b(broken|errors?|bugs?|crash\w*|nothing happens|doesn'?t work|not working|won'?t|can'?t|fails?|failing|undefined|blank|stuck)\b/i;

  /** Checks we can infer from what the prompt asks for (keyword → testable check). */
  const CHECKS = [
    [/\b(log ?in|sign ?up|auth\w*|accounts?)\b/i, 'I can sign up, log out, and log back in.'],
    [/\b(pay\w*|stripe|checkout|subscri\w*)\b/i, 'A test payment (card 4242 4242 4242 4242) goes through and shows as paid.'],
    [/\b(uploads?|photos?|images?|avatars?)\b/i, 'An uploaded file still shows after I refresh the page.'],
    [/\b(emails?)\b/i, 'The email arrives (check the spam folder too).'],
    [/\b(search|filter\w*)\b/i, 'Search returns the right results, and a friendly message when nothing matches.'],
    [/\b(forms?|contact)\b/i, 'Submitting the form shows a success message; empty or invalid fields show a clear error.'],
    [/\bdark mode\b/i, 'Dark mode can be switched on and off, and remembers my choice after a refresh.'],
    [/\b(dashboard|charts?|stats|analytics)\b/i, 'The dashboard shows real numbers from my data.'],
    [/\b(chat\w*|messag\w*)\b/i, 'A message I send shows up for the other person without refreshing.'],
    [/\b(ai|generat\w*|summar\w*|gpt|claude)\b/i, 'The AI feature returns a result, and shows a friendly error if it fails.'],
    [/\b(notifications?|remind\w*)\b/i, 'The notification shows up at the right moment.'],
    [/\b(maps?|locations?)\b/i, 'The map shows the right pins and works on a phone.'],
    [/\b(delete|remove)\b/i, 'Deleting asks me to confirm first.'],
    [/\b(mobile|responsive|phone)\b/i, 'It looks right at phone width.'],
    [/\b(pages?|screens?)\b/i, 'I can reach the new page from the navigation.'],
  ];
  /** Up to 2 checks, in the order the prompt mentions them. */
  function inferChecks(text) {
    return CHECKS.map(([re, c]) => { const m = re.exec(text); return m ? { c, at: m.index } : null; })
      .filter(Boolean).sort((a, b) => a.at - b.at).slice(0, 2).map((x) => x.c);
  }

  /** Lower-case ALL-CAPS words (keeping acronyms and ENV_VAR names) and calm "!!!". */
  function deShout(text) {
    const isShout = (w) => !ACRONYMS.has(w.replace(/'S$/, ''));
    const n = (text.match(/\b[A-Z][A-Z']{2,}\b/g) || []).filter(isShout).length;
    const bangs = /[!?]{2,}/.test(text);
    let out = text;
    // Once someone is shouting, short words in the shout ("DO NOT") get calmed too.
    if (n >= 2) out = out.replace(/\b[A-Z][A-Z']+\b/g, (w) => (w === 'I' || !isShout(w) ? w : w.toLowerCase()));
    out = out.replace(/!{2,}/g, '.').replace(/[!?]*\?[!?]*/g, (m) => (m.length > 1 ? '?' : m));
    return { text: out, shouted: n >= 2 || bangs };
  }

  /** Tidy after removals: spacing, stray punctuation, capital at the start of each sentence. */
  function tidy(text) {
    return text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([,.!?])/g, '$1')
      .replace(/([,.!?]){2,}/g, '$1')
      .replace(/^[\s,.;:!?]+/gm, '')
      .replace(/(^|[.!?]\s+|\n)([a-z])/g, (m, a, c) => a + c.toUpperCase())
      .trim();
  }

  /** Split "add a login page, a dashboard, dark mode and payments" into separate asks. */
  const SUBORDINATE = /^(?:so|which|that|because|where|when|with|for|to|if|but|like|including|e\.?g\.?|i\.?e\.?|such as|as|in|on|from|by|using|via|or)\b/i;
  /** A part with its own verb ("the login is broken") is a clause, not a new ask. */
  const CLAUSE_RE = /\b(?:is|are|was|were|isn'?t|aren'?t|doesn'?t|don'?t|won'?t|can'?t|has|have|had|keeps|shows|says|looks|seems|gets|goes|breaks|crashes|works|need|needs)\b/i;
  function splitAsks(sentence) {
    const s = unpunct(sentence);
    const vm = s.match(VERB_START);
    if (!vm) return [s];
    let parts = s.split(new RegExp('\\s*;\\s*|\\s*,\\s*(?:and\\s+|then\\s+|also\\s+|plus\\s+)?|\\s+(?:and then|and also|then also|then|also|plus)\\s+|\\s+and\\s+(?=' + VERB + '\\b)', 'i'))
      .map((x) => x && x.trim()).filter(Boolean);
    // "…, Y and Z" → the last "and" in a comma list is a separator too.
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const bits = last.split(/\s+and\s+/i);
      if (bits.length === 2 && bits[0] && bits[1]) parts.splice(parts.length - 1, 1, bits[0], bits[1]);
    }
    // Re-attach clauses that aren't asks ("…, so people can reach me").
    const merged = [];
    parts.forEach((x) => {
      const clause = CLAUSE_RE.test(x) && !new RegExp('^' + VERB + '\\b', 'i').test(x);
      if (merged.length && (SUBORDINATE.test(x) || clause)) merged[merged.length - 1] += ', ' + x;
      else merged.push(x);
    });
    if (merged.length < 2) return [s];
    const verb = vm[1].toLowerCase();
    return merged.map((x, i) => {
      x = x.replace(/^(?:and|also|then|now)\s+/i, '');
      if (i > 0 && !new RegExp('^' + VERB + '\\b', 'i').test(x)) x = verb + ' ' + x;
      return cap(x.replace(/^(also|then|and|now)\s+/i, ''));
    });
  }

  function improve(text, project) {
    const p = project || null;
    const original = String(text == null ? '' : text);
    const before = tokens(original);
    const changes = [];
    const warnings = [];
    if (!line(original)) {
      return { improved: '', changes: [], warnings: [], secrets: [], before: 0, after: 0 };
    }

    // 1. Secrets — remove first, warn loudly.
    const secrets = detectSecrets(original);
    let t = block(original);
    if (secrets.length || (VC.ai && VC.ai.redact && VC.ai.redact(t) !== t)) {
      t = redactAll(t);
      t = t.replace(/(?:\b(?:here'?s|here is|this is|it'?s|use|using|with)\s+)?(?:\b(?:my|the|our|your)\s+)?(?:\b[\w-]+\s+)?(?:\bapi\s+)?\b(?:key|token|secret|password)(?:\s+is)?\s*[:=]?\s*\[REDACTED\][.,;]?\s*/gi, '')
        .replace(/\[REDACTED\]/g, '[secret removed]');
      const real = secrets.filter((s) => !s.public);
      const many = secrets.length > 1;
      const names = secrets.length ? listJoin(secrets.map((s) => s.name)) : 'a secret key';
      if (real.length || !secrets.length) {
        warnings.push('Your prompt contained ' + (many ? 'secrets' : 'a secret') + ' (' + names + '). We removed ' + (many ? 'them' : 'it') + '. Anything pasted into a chat can end up in logs, in your code, or on GitHub.');
        warnings.push('To be safe, create a new key in that service\'s dashboard and delete the old one. Then add the new key in your builder\'s secrets settings, not in the chat.');
      } else {
        warnings.push('Your prompt contained your ' + names + '. It\'s public by design, so it\'s not a disaster, but keys belong in env vars, not in chat. We took it out.');
      }
      changes.push('Removed the ' + (many ? 'keys' : 'key') + ' you pasted and told the AI to read ' + (many ? 'them' : 'it') + ' from an env var instead.');
    }

    // 2. Shouting and filler.
    const shout = deShout(t);
    if (shout.shouted) {
      t = shout.text;
      changes.push('Toned down the ALL CAPS and "!!!". Shouting doesn\'t make the AI more careful; it can make it overdo things.');
    }
    const beforeFiller = tokens(t);
    let noFiller = t;
    FILLER.forEach(([re, rep]) => { noFiller = noFiller.replace(re, rep); });
    noFiller = tidy(noFiller);
    const saved = beforeFiller - tokens(noFiller);
    if (line(noFiller)) t = noFiller;
    if (saved >= 3) changes.push('Cut filler and politeness (~' + saved + ' tokens). Being nice is fine, but it costs tokens on every message, and clear beats polite.');

    // 3. Split into goal / details / constraints / done criteria (keeping every word of intent).
    const lines = t.split(/\n+/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    const asks = [];
    const details = [];
    const constraints = [];
    const done = [];
    lines.forEach((l) => {
      sentences(l).forEach((s) => {
        const sLine = unpunct(s);
        if (!sLine || /^\[secret removed\]$/i.test(sLine)) return;
        if (DONE_LINE_RE.test(sLine)) done.push(period(cap(sLine.replace(/^(?:done when|it'?s done when)\s*:?\s*/i, ''))));
        else if (CONSTRAINT_RE.test(sLine)) constraints.push(period(cap(sLine)));
        else if (VERB_START.test(sLine)) splitAsks(sLine).forEach((a) => asks.push(a));
        else details.push(period(cap(sLine)));
      });
    });
    // A prompt with no clear verb ("the login page is broken") — its first sentence is the goal.
    if (!asks.length && details.length) {
      const first = unpunct(details.shift());
      asks.push(BUG_RE.test(first) || /\bdoesn'?t|isn'?t\b/i.test(first) ? 'Fix this: ' + lowerFirst(first) : first);
    }

    const lower = t.toLowerCase();
    const words = lower.split(/\s+/).filter(Boolean).length;
    const vague = VAGUE.filter((v) => v.re.test(lower)).map((v) => v.id);
    const bigCount = asks.filter((a) => BIG_RE.test(a)).length;
    const multi = asks.length >= 3 || (asks.length === 2 && bigCount >= 2);
    const d = (p && p.chosenDirection) || {};
    const nextStep = p ? steps(p).find((s) => !doneMap(p)[s.id]) : null;

    // 4. Vague asks → keep the words, add the specifics the AI needs (in [brackets] for the user to fill).
    const extraDetails = [];
    const extraConstraints = [];
    const extraDone = [];
    if (vague.indexOf('design') !== -1 && !(DESIGN_DETAIL_RE.test(lower) && words > 8)) {
      extraDetails.push('Change specifically: [pick 1–3, e.g. more spacing, bigger headings, one accent color, a cleaner mobile layout].');
      if (d.vibe) extraDetails.push('Match the look & feel in the brief: ' + period(unpunct(d.vibe)));
      extraConstraints.push('Styling only: don\'t change features, text or data.');
      extraDone.push('It looks right at phone and desktop width.', 'Everything works exactly as before.');
      changes.push('"Make it look better" leaves the AI guessing, so it may redo parts you like. Added a spot to say exactly what to change. Fill in the [brackets].');
    }
    if (vague.indexOf('fix') !== -1 && !(SYMPTOM_RE.test(original) && words > 10)) {
      extraDetails.push('What I did: [the clicks or steps that cause it].', 'What I expected: [what should happen].', 'What happened instead: [what you see; copy any error message exactly].');
      extraConstraints.push('Find the cause before changing code. Make the smallest fix; don\'t rewrite working parts.');
      extraDone.push('The problem doesn\'t happen when I repeat the same steps.');
      changes.push('"Fix it" alone makes the AI guess what\'s wrong, and guesses cost credits. Added what happened, what you expected and the exact error. Fill in the [brackets].');
    }
    let goalOverride = '';
    if (vague.indexOf('everything') !== -1) {
      const pick = '[pick ONE feature' + (nextStep ? ', e.g. "' + nextStep.title + '" from the build plan' : '') + ']';
      if (asks.length <= 1) goalOverride = 'Build the next feature: ' + pick + '.';
      else extraDetails.push('Next feature to build: ' + pick + '.');
      extraConstraints.push('Build only this one feature in this prompt.');
      changes.push('"Add everything" makes the AI rewrite huge chunks at once, which is how apps break. Narrowed it to one feature at a time.'
        + (p && p.kit ? ' Tip: the Build prompts tab has a ready-made prompt for each step.' : ''));
    }
    // A specific bug report still benefits from "find the cause first".
    if (BUG_RE.test(lower) && vague.indexOf('fix') === -1 || (vague.indexOf('fix') !== -1 && SYMPTOM_RE.test(original) && words > 10)) {
      extraConstraints.push('Find the cause before changing code, then make the smallest fix.');
      changes.push('Asked the AI to find the cause before changing code. It\'s the fastest way out of fix-it-break-it loops.');
    }
    if (vague.indexOf('better') !== -1 && vague.length === 1 && words < 15) {
      extraDetails.push('What\'s wrong with it now: [e.g. too slow, confusing, too many steps].', 'What "better" means: [the result you want to see].');
      changes.push('"Make it better" doesn\'t say what better means. Added a spot for what\'s wrong now and what you want instead.');
    }

    // 5. Several features in one prompt → numbered, one at a time.
    if (multi) {
      changes.push('Split ' + asks.length + ' requests into numbered steps, built one at a time. Smaller steps mean fewer broken features and cheaper fixes.');
    }

    // 6. Context: point at the saved brief instead of re-explaining the project.
    let contextLine = '';
    if (!CONTEXT_RE.test(lower)) {
      if (p && p.kit) {
        contextLine = 'Context: follow the project brief (' + briefRef(p) + ').';
        changes.push('Pointed the AI at your saved project brief, so it knows your app without you re-explaining it.');
      } else {
        changes.push('Tip: save a project brief once (Build prompts tab) so the AI always knows your app and you never re-explain it.');
      }
    }

    // 7. Scope limits.
    const hasScope = SCOPE_RE.test(lower);
    if (!hasScope) {
      extraConstraints.push('Only change the files needed for this. Don\'t refactor or restyle anything else, and keep what already works working.');
      if (!/\b(ask|check with) me\b/i.test(lower)) extraConstraints.push('Ask me before adding a library or changing the database.');
      changes.push('Added limits so the AI only touches what\'s needed. That protects the parts that already work.');
    }
    if (secrets.length) {
      secrets.forEach((s) => {
        const env = s.public ? envForPublic(s, p) : envForSecret(s, p);
        extraConstraints.push('Read the ' + s.name + ' from ' + (env ? 'the ' + code(env) + ' env var' : 'an env var') + '. I\'ll set the value myself; never put it in code.');
      });
    }

    // 8. Done criteria.
    const hasDone = done.length > 0 || DONE_RE.test(lower);
    if (!hasDone) {
      const focus = multi ? asks[0] : [asks.join(' '), details.join(' ')].join(' ');
      const inferred = inferChecks(focus);
      const checks = uniq(inferred.concat(extraDone));
      if (!checks.length) checks.push('[What you\'ll see when it works, e.g. "clicking Save shows my new item in the list"].');
      if (!checks.some((c) => /as before|still works|nothing .*broken/i.test(c))) checks.push('Nothing that worked before is broken.');
      extraDone.length = 0;
      checks.forEach((c) => extraDone.push(c));
      changes.push('Added a "Done when" list, so you and the AI both know when it\'s finished.');
    }

    // 9. Plain-English wrap-up.
    const wantsExplain = EXPLAIN_RE.test(lower);
    if (!wantsExplain) changes.push('Asked for a plain-English summary of what changed and how to test it.');

    // Assemble.
    const out = [];
    if (multi) {
      out.push('Goal: Build these, one at a time:');
      asks.forEach((a, i) => out.push((i + 1) + '. ' + period(cap(a))));
    } else {
      out.push('Goal: ' + (goalOverride || (asks.length ? period(cap(asks.join('. '))) : '[What do you want built or changed?]')));
    }
    if (contextLine) out.push('', contextLine);
    const allDetails = uniq(details.concat(extraDetails));
    if (allDetails.length) {
      out.push('', 'Details:');
      allDetails.forEach((x) => out.push('- ' + x));
    }
    const allConstraints = uniq((multi ? ['Build #1 only, then stop so I can test it. I\'ll say "next" when it works.'] : []).concat(constraints, extraConstraints));
    if (allConstraints.length) {
      out.push('', 'Constraints:');
      allConstraints.forEach((x) => out.push('- ' + x));
    }
    const allDone = uniq(done.concat(extraDone));
    if (allDone.length) {
      out.push('', 'Done when:');
      allDone.forEach((x) => out.push('- ' + (multi && !hasDone && x.indexOf('Nothing') !== 0 ? '#1 works: ' + x : x)));
    }
    if (!wantsExplain) out.push('', 'When finished: tell me in plain English what changed and how to test it.');

    if (!changes.length || (changes.length === 1 && !wantsExplain && changes[0].indexOf('plain-English') !== -1)) {
      changes.unshift('Already a solid prompt. Organized it into Goal / Details / Constraints / Done when so nothing gets missed.');
    }
    const improved = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { improved, changes: uniq(changes), warnings, secrets, before, after: tokens(improved) };
  }

  /* ------------------------------------------------------------------ *
   * AI-assisted improver (optional; falls back to improve())
   * Resolves with the same shape as improve() plus:
   *   source: 'ai' | 'offline', aiError?: string  (show it as a toast)
   * ------------------------------------------------------------------ */
  const IMPROVE_SYSTEM = [
    'You are the world\'s best prompt engineer for AI app builders (Lovable, Bolt, Replit, v0, Cursor, Claude Code).',
    'You rewrite prompts written by NON-TECHNICAL people so the builder gets it right the first time, stays safe, and spends fewer tokens.',
    'Rules for the rewrite:',
    '- Never lose or change what the user actually wants. Keep their specifics (names, text, colors, pages).',
    '- Structure it as plain text with these labels: "Goal:", "Details:", "Constraints:", "Done when:", then a final line "When finished: tell me in plain English what changed and how to test it."',
    '- Details and Done when are short "- " bullets. Done-when items are checks a non-coder can test by clicking.',
    '- If the ask is vague, add [bracketed placeholders] for the facts only the user knows. Do not invent features.',
    '- If it asks for several features, number them and say to build #1 only, then stop for testing.',
    '- Constraints: only change files needed; don\'t refactor or restyle unrelated code; keep existing features working; ask before new libraries or database changes; keys only via env vars by name.',
    '- Refer to the saved project brief instead of re-explaining the project.',
    '- Cut filler, politeness padding and ALL CAPS. Keep it as short as possible while complete. No markdown headings, no emojis.',
    'Also return "changes": 3 to 6 plain-English sentences (each under 22 words) explaining what you changed and why it helps. No jargon.',
  ].join('\n');

  function projectSummary(p) {
    if (!p) return 'No project details available.';
    const d = p.chosenDirection || {};
    const b = builderOf(p);
    const fw = frameworkOf(p);
    const svc = servicesOf(p).map((s) => {
      const keys = keysOf(s, fw).map((k) => k.name + (k.secret ? ' (secret)' : ''));
      return s.name + (keys.length ? ' [' + keys.join(', ') + ']' : '');
    });
    const next = steps(p).find((s) => !doneMap(p)[s.id]);
    return [
      'App: ' + appName(p) + (d.pitch ? ' — ' + unpunct(d.pitch) : ''),
      'Builder: ' + (b ? b.name : 'unknown') + ' · ' + FRAMEWORKS[fw],
      svc.length ? 'Services (env var names): ' + svc.join('; ') : '',
      'Saved project brief lives in: ' + briefRef(p),
      next ? 'Current milestone: ' + next.title : '',
    ].filter(Boolean).join('\n');
  }

  async function improveAI(text, project) {
    const offline = improve(text, project);
    if (!line(text) || !VC.ai || !VC.ai.enabled || !VC.ai.enabled()) return Object.assign({ source: 'offline' }, offline);
    try {
      const res = await VC.ai.json({
        system: IMPROVE_SYSTEM,
        prompt: [
          'Project context:',
          projectSummary(project),
          '',
          'Problems an automatic check found (fix these):',
          offline.changes.map((c) => '- ' + c).join('\n') || '- none',
          '',
          'The user\'s prompt, between the markers:',
          '<<<',
          redactAll(String(text)),
          '>>>',
        ].join('\n'),
        schema: {
          type: 'object',
          properties: {
            improved: { type: 'string', description: 'The rewritten prompt, ready to paste.' },
            changes: { type: 'array', items: { type: 'string' }, description: '3 to 6 plain-English explanations of what changed.' },
          },
        },
        effort: 'medium',
      });
      const improved = redactAll(block(res && res.improved));
      if (!improved) throw new Error('Claude returned an empty prompt. Here\'s the offline version instead.');
      const changes = uniq((offline.secrets.length ? [offline.changes[0]] : []).concat(arr(res.changes).map(line).filter(Boolean))).slice(0, 7);
      return { improved, changes, warnings: offline.warnings, secrets: offline.secrets, before: offline.before, after: tokens(improved), source: 'ai' };
    } catch (err) {
      return Object.assign({}, offline, { source: 'offline', aiError: (err && err.message) || String(err) });
    }
  }

  /* ------------------------------------------------------------------ *
   * "I'm stuck" — break the loop
   * ------------------------------------------------------------------ */
  /** Quick picks for common situations. The view pre-fills its form from these. */
  const STUCK_SITUATIONS = [
    {
      id: 'blank', label: 'Blank white screen',
      goal: 'Open the app and see the home screen.',
      error: 'The page is completely blank (a white screen). Nothing shows up.',
      hints: [
        'A blank screen usually means an error stopped the app from starting. If you need the exact error, tell me how to open the browser console and what to copy.',
        'Check the most recent changes first: imports, routing, and env vars that might be missing (undefined).',
      ],
      where: 'Open your app, right-click the blank page → Inspect → Console. Copy the first red line.',
    },
    {
      id: 'regressed', label: 'It worked before, now it\'s broken',
      goal: 'Get back to the version that worked, then make the last change again carefully.',
      error: 'It worked earlier. After the last few changes it\'s broken.',
      hints: [
        'List what changed since it last worked (files, packages, settings), and which change most likely broke it.',
        'Prefer undoing the breaking change over patching on top of it.',
      ],
    },
    {
      id: 'loop', label: 'The AI keeps making the same fix',
      goal: '',
      error: 'You keep trying the same kind of fix and the problem is still there.',
      hints: [
        'The previous fixes did not work, so don\'t repeat them. Assume the real cause is somewhere else and look wider: config, data, env vars, another file.',
      ],
    },
    {
      id: 'login', label: 'Login isn\'t working',
      goal: 'Let people sign up and log in.',
      error: 'Logging in doesn\'t work.',
      hints: [
        'Check the auth provider\'s settings (site URL and redirect URLs), email confirmation settings, env var names and values, and whether security rules block reading the user\'s profile after login.',
        'Don\'t turn off Row Level Security or any security check to make it work.',
      ],
    },
    {
      id: 'deploy', label: 'Deploy failed',
      goal: 'Put the app online.',
      error: 'The deploy failed.',
      hints: [
        'Read the build log from the top: the first error is usually the real one.',
        'Check that every env var the code uses is also set on the host, with the right public prefix, and that the build works locally.',
      ],
      where: 'Open the failed deploy on your host (Vercel, Netlify…) and copy the first red error from the build log.',
    },
    {
      id: 'keys', label: 'My keys aren\'t working',
      goal: 'Connect the app to the service with my API key.',
      error: 'The key doesn\'t seem to work.',
      hints: [
        'Check that env var names match the code exactly (including the public prefix for public keys), that the app was restarted or redeployed after adding them, test vs live mode, and no quotes or spaces around the values.',
        'Never ask me to paste the key in chat. Tell me what to check instead.',
      ],
    },
  ];

  /** Keep huge logs useful and cheap: first 30 lines + last 8. */
  function trimLog(text) {
    const ls = block(text).split('\n');
    if (ls.length <= 45) return ls.join('\n').slice(0, 5000);
    return ls.slice(0, 30).concat(['… (' + (ls.length - 38) + ' lines cut) …'], ls.slice(-8)).join('\n').slice(0, 5000);
  }
  function triedList(tried) {
    return block(tried).split(/\n+|;\s*/).map((x) => unpunct(x.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''))).filter(Boolean);
  }

  function stuck(input, project) {
    const i = input || {};
    const p = project || null;
    const sit = STUCK_SITUATIONS.find((s) => s.id === i.situation) || null;
    const goal = redactAll(block(i.goal));
    const err = redactAll(trimLog(i.error));
    const tried = triedList(redactAll(i.tried || ''));
    const looksLikeLog = /\n/.test(err) || /(error|exception|failed|at [\w.]+ \(|\.(t|j)sx?:\d+|status \d{3}|undefined|null)/i.test(err);
    const out = [];

    out.push('Stop. Don\'t write any code yet. We\'re going in circles, so let\'s find the real cause first.');
    if (p && p.kit) out.push('Follow the project brief (' + briefRef(p) + ').');
    out.push('');
    out.push('What I\'m trying to do:');
    out.push(goal || '[Describe what should happen]');
    out.push('');
    out.push('What happens instead:');
    if (err && looksLikeLog) out.push('```', err, '```');
    else out.push(err || '[Describe what you see, and paste any error message exactly]');
    out.push('');
    out.push('What we\'ve already tried (it didn\'t work):');
    if (tried.length) tried.forEach((x) => out.push('- ' + x));
    else out.push('- Asking you to fix it, without success.');
    out.push('');
    if (sit) {
      out.push('Where to look:');
      sit.hints.forEach((h) => out.push('- ' + h));
      out.push('');
    }
    out.push('Please:');
    out.push('1. Explain in plain English what you think is going wrong.');
    out.push('2. List the 3 most likely root causes, most likely first, and how sure you are about each.');
    out.push('3. For the top cause, propose the smallest possible fix: name the exact files you\'d change, and change nothing else.');
    out.push('4. Tell me how to check it worked: what to click and what I should see. Add a temporary log message if it helps confirm the cause.');
    out.push('5. If the last 2 fixes didn\'t work, tell me to revert to the last working version first, and apply the new fix from there instead of stacking fixes.');
    out.push('');
    out.push('Wait for my OK before changing any code.');
    return out.join('\n');
  }

  /** Plain-English advice for the human (not the AI) → [{title, detail}]. */
  function stuckAdvice(input, project) {
    const i = input || {};
    const p = project || null;
    const b = builderOf(p);
    const sit = STUCK_SITUATIONS.find((s) => s.id === i.situation) || null;
    const tries = triedList(i.tried || '').length;
    const out = [];
    const revert = {
      title: tries >= 2 ? 'Go back to a version that worked, first' : 'Know how to go back',
      detail: (tries >= 2 ? 'You\'ve already tried ' + tries + ' fixes. Stacking more on top usually makes it worse. ' : 'If this fix doesn\'t work either, don\'t keep stacking fixes. ')
        + (b && b.versionControl ? period(b.versionControl) : 'Use your tool\'s history, checkpoints or GitHub to restore the last version that worked.'),
    };
    if (tries >= 2) out.push(revert);
    out.push({
      title: 'Start a fresh chat',
      detail: 'Long chats make the AI forget and repeat itself (its memory for the chat fills up). Open a new chat'
        + (p && p.kit ? ', check your project brief is saved in ' + briefRef(p) : ', paste your project brief if you have one')
        + ', then paste the prompt below.',
    });
    out.push({
      title: 'Read the error message out loud',
      detail: 'Really. Read it slowly, word by word. It often names the file and the problem ("undefined", "permission denied", "not found"). Copy it exactly; don\'t paraphrase.',
    });
    if (sit && sit.where) out.push({ title: 'Find the exact error', detail: sit.where });
    else if (!line(i.error)) out.push({ title: 'Find the exact error', detail: 'In the browser: right-click the page → Inspect → Console. Red lines are errors; copy the first one into the form.' });
    if (tries < 2) out.push(revert);
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Token tips
   * ------------------------------------------------------------------ */
  function tokenTips(project) {
    const p = project || null;
    const b = builderOf(p);
    const where = p && p.kit ? briefRef(p) : 'your tool\'s project instructions (CLAUDE.md, Cursor rules, Lovable Knowledge…)';
    const general = [
      { title: 'Save your project brief once', detail: 'Put it in ' + where + ' so the AI always knows your app. You never pay to re-explain it.' },
      { title: 'One feature per prompt, then test', detail: 'Small steps are cheaper to get right and easy to undo. "Build everything" prompts break things you then pay to fix.' },
      { title: 'Start a fresh chat for each milestone', detail: 'Every message re-sends the whole chat so far. Long chats cost more, and the AI starts forgetting. A new chat plus your brief is cheap and sharp.' },
      { title: 'Ask for a plan before big changes', detail: 'A short plan costs a few hundred tokens. Undoing a wrong change across ten files costs thousands.' },
      { title: 'Say exactly where', detail: '"Only change the Settings page" stops the AI from rewriting files that already work.' },
      { title: 'Paste the exact error, not whole files', detail: 'Copy the red error message and say what you clicked. The AI can find the file itself.' },
      { title: 'Two failed fixes? Go back', detail: 'Don\'t say "still broken" a third time. Revert to the last working version and use the "I\'m stuck" prompt.' },
      { title: 'Match the model to the job', detail: 'Use a faster, cheaper mode for small tweaks like text or colors. Save the strongest model for planning and hard bugs.' },
      { title: 'Batch tiny tweaks, split real features', detail: 'Three small text or color changes can share one message. A login system and a payment page can\'t.' },
      { title: 'Save a checkpoint before risky steps', detail: 'Undoing is free if you saved first. Re-prompting a broken app isn\'t.' },
      { title: 'Skip the filler', detail: '"Hi! Could you please…" is paid for on every message. Clear and direct gets better results.' },
    ];
    const specific = arr(b && b.tokenTips).map((tip) => {
      const t = line(tip);
      const m = t.match(/^(.{8,80}?)(?:[:—–]\s+|\.\s+)(.+)$/);
      return m ? { title: unpunct(m[1]), detail: period(m[2]), builder: b.name } : { title: unpunct(t), detail: '', builder: b.name };
    });
    return general.concat(specific);
  }

  /* ------------------------------------------------------------------ *
   * Public API
   * ------------------------------------------------------------------ */
  VC.engine.prompts = {
    brief,
    contextFile,
    starterPrompt,
    milestonePrompt,
    improve,
    improveAI,
    stuck,
    tokenTips,
    // Extras used by the Prompt Studio view:
    steps,                 // (project) -> [{id, kind:'starter'|'milestone', number, title, goal, milestone, size, services, prompt, tokens}]
    starterMilestone,      // (project) -> the kit milestone the starter prompt covers, or null
    STARTER_ID,            // done-key for a separate starter step: project.prompts.done.starter
    stuckAdvice,           // (input, project?) -> [{title, detail}] advice for the human
    stuckSituations: STUCK_SITUATIONS,
    detectSecrets,         // (text) -> [{name, service, env}] — never returns the secret itself
    redact: redactAll,     // (text) -> text with secrets replaced by [REDACTED]
  };
})();
