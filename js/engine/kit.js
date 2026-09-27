/* Vibe Check — Build Kit engine.
   Turns a project (idea + chosen direction + quick answers) into a Kit: which builder to use,
   which services to sign up for, the step-by-step build plan, what it costs, and the safety
   rules every prompt should carry. Pure data in, data out: no DOM, fully offline.
   See docs/ARCHITECTURE.md → "Kit". */
(function () {
  'use strict';
  const VC = window.VC;

  /* ------------------------------------------------------------------ *
   * Fixed vocabulary + fallback knowledge
   * The catalog (VC.data.services / builders) is the source of truth. The small
   * tables below only keep the engine working if a catalog file is missing.
   * ------------------------------------------------------------------ */
  const CATEGORY_ORDER = ['hosting', 'database', 'auth', 'payments', 'ai', 'email', 'storage', 'maps', 'sms', 'analytics', 'monitoring', 'realtime', 'media'];
  /** GitHub isn't one of the app's categories; its kit entry uses this pseudo-category. */
  const VERSION_CONTROL = 'version-control';

  const CATEGORY_NAMES = {
    hosting: 'Putting it online', database: 'Saving data', auth: 'Logins & accounts', payments: 'Taking payments',
    ai: 'AI features', email: 'Sending emails', storage: 'File uploads', maps: 'Maps & places', sms: 'Text messages',
    analytics: 'Visitor stats', monitoring: 'Error alerts', realtime: 'Live updates', media: 'Images, video & audio',
    'version-control': 'Backups & version history',
  };
  /** Short nouns for running text ("Supabase also handles logins and file uploads"). */
  const CATEGORY_SHORT = {
    hosting: 'hosting', database: 'your data', auth: 'logins', payments: 'payments', ai: 'AI', email: 'emails',
    storage: 'file uploads', maps: 'maps', sms: 'text messages', analytics: 'visitor stats', monitoring: 'error alerts',
    realtime: 'live updates', media: 'images & audio', 'version-control': 'backups',
  };

  // id: [name, categories, monthly low, monthly high, difficulty]
  const FALLBACK_SERVICES = {
    supabase: ['Supabase', ['database', 'auth', 'storage', 'realtime'], 0, 25, 'easy'],
    firebase: ['Firebase', ['database', 'auth', 'storage', 'realtime'], 0, 25, 'medium'],
    clerk: ['Clerk', ['auth'], 0, 25, 'easy'],
    stripe: ['Stripe', ['payments'], 0, 0, 'medium'],
    lemonsqueezy: ['Lemon Squeezy', ['payments'], 0, 0, 'easy'],
    anthropic: ['Anthropic (Claude)', ['ai'], 5, 50, 'easy'],
    openai: ['OpenAI', ['ai'], 5, 50, 'easy'],
    replicate: ['Replicate', ['ai', 'media'], 5, 40, 'medium'],
    elevenlabs: ['ElevenLabs', ['media'], 0, 22, 'easy'],
    resend: ['Resend', ['email'], 0, 20, 'easy'],
    cloudinary: ['Cloudinary', ['storage', 'media'], 0, 89, 'medium'],
    uploadthing: ['UploadThing', ['storage'], 0, 10, 'easy'],
    mapbox: ['Mapbox', ['maps'], 0, 0, 'easy'],
    'google-maps': ['Google Maps', ['maps'], 0, 0, 'medium'],
    twilio: ['Twilio', ['sms'], 1, 20, 'medium'],
    posthog: ['PostHog', ['analytics'], 0, 0, 'easy'],
    sentry: ['Sentry', ['monitoring'], 0, 26, 'easy'],
    vercel: ['Vercel', ['hosting'], 0, 20, 'easy'],
    netlify: ['Netlify', ['hosting'], 0, 19, 'easy'],
    github: ['GitHub', [], 0, 0, 'easy'],
  };
  const FALLBACK_BUILDERS = {
    lovable: { name: 'Lovable', url: 'https://lovable.dev', skill: 'beginner', framework: 'vite', nativeIntegrations: ['supabase', 'stripe', 'github'] },
    bolt: { name: 'Bolt', url: 'https://bolt.new', skill: 'beginner', framework: 'vite', nativeIntegrations: ['supabase', 'stripe', 'netlify', 'github'] },
    replit: { name: 'Replit', url: 'https://replit.com', skill: 'beginner', framework: 'node', nativeIntegrations: ['github'] },
    v0: { name: 'v0', url: 'https://v0.dev', skill: 'beginner', framework: 'next', nativeIntegrations: ['vercel', 'supabase'] },
    cursor: { name: 'Cursor', url: 'https://cursor.com', skill: 'intermediate', framework: 'any', nativeIntegrations: [] },
    'claude-code': { name: 'Claude Code', url: 'https://claude.com/claude-code', skill: 'advanced', framework: 'any', nativeIntegrations: [] },
  };
  const BUILDER_ORDER = ['lovable', 'bolt', 'replit', 'v0', 'cursor', 'claude-code'];
  /** Builders that can make real phone apps (Expo / React Native). */
  const MOBILE_BUILDERS = ['bolt', 'replit', 'cursor', 'claude-code'];
  /** Builders with their own one-click publishing, so no separate hosting account is needed. */
  const BUILTIN_HOSTING = {
    lovable: { name: 'Lovable\'s Publish button', note: 'Click Publish and your app gets a free lovable.app address. You can add your own domain later.' },
    bolt: { name: 'Bolt\'s Publish button', note: 'Click Publish and Bolt puts your app online at a free address. You can add your own domain later.' },
    replit: { name: 'Replit Deployments', note: 'Click Deploy in Replit and your app gets a free replit.app address. You can add your own domain later.' },
  };
  /** Builders that keep their own version history, which makes GitHub a nice-to-have backup. */
  const BUILTIN_HISTORY = ['lovable', 'bolt', 'replit', 'v0'];

  /** The pick we start from in each category, before builder, budget and use case adjust scores. */
  const DEFAULT_PICK = {
    hosting: 'vercel', database: 'supabase', auth: 'supabase', storage: 'supabase', realtime: 'supabase',
    payments: 'stripe', ai: 'anthropic', email: 'resend', maps: 'google-maps', sms: 'twilio',
    analytics: 'posthog', monitoring: 'sentry', media: 'cloudinary',
  };

  /* ------------------------------------------------------------------ *
   * Small text helpers
   * ------------------------------------------------------------------ */
  const has = (arr, v) => Array.isArray(arr) && arr.indexOf(v) !== -1;
  const uniq = (arr) => arr.filter((v, i) => v != null && arr.indexOf(v) === i);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const cap = (s) => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : s; };
  const lcFirst = (s) => { s = String(s || '').trim(); return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; };
  const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
  const numberWord = (n) => NUMBER_WORDS[n] || String(n);

  /** ['a','b','c'] → "a, b and c" */
  function listJoin(items, word) {
    const a = items.filter(Boolean);
    if (a.length <= 1) return a.join('');
    return a.slice(0, -1).join(', ') + ' ' + (word || 'and') + ' ' + a[a.length - 1];
  }

  /** A feature phrase trimmed to a short title ("Upload beats with tags and genres" → "Upload beats with tags"). */
  function shortTitle(s, max) {
    max = max || 34;
    s = cap(String(s || '').replace(/[.!]+$/, '').trim());
    if (s.length <= max) return s;
    const cut = s.slice(0, max + 1);
    const sp = cut.lastIndexOf(' ');
    let out = (sp > 12 ? cut.slice(0, sp) : cut.slice(0, max)).replace(/[,;:\-–—&]+$/, '').trim();
    // Don't end on a dangling little word ("Send beats to artists with a").
    while (/\s(and|or|with|to|for|of|by|in|on|at|the|a|an|your|their|from|into|so|that|which|who)$/i.test(out)) out = out.replace(/\s+\S+$/, '');
    return out;
  }

  /** Tiny stable string hash (djb2), used to notice when inputs change. */
  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  /* ------------------------------------------------------------------ *
   * Catalog lookups (lazy, never throw)
   * ------------------------------------------------------------------ */
  function catalogServices() { return Array.isArray(VC.data && VC.data.services) ? VC.data.services : []; }
  function catalogBuilders() { return Array.isArray(VC.data && VC.data.builders) ? VC.data.builders : []; }

  function fallbackService(id) {
    const f = FALLBACK_SERVICES[id];
    if (!f) return null;
    return { id, name: f[0], categories: f[1], monthlyCost: { low: f[2], high: f[3] }, difficulty: f[4], keys: [], steps: [], safety: [], gotchas: [], builderSupport: {}, _fallback: true };
  }

  /** Service object by id: catalog first, then fallback knowledge, else null. */
  function service(id) {
    if (!id) return null;
    let s = null;
    if (VC.data && typeof VC.data.serviceById === 'function') {
      try { s = VC.data.serviceById(id); } catch (e) { s = null; }
    }
    if (!s) s = catalogServices().find((x) => x && x.id === id) || null;
    return s || fallbackService(id);
  }

  /** Every service that can cover a category, catalog order (fallback list if the catalog is missing). */
  function servicesFor(cat) {
    const list = catalogServices().length ? catalogServices() : Object.keys(FALLBACK_SERVICES).map(fallbackService);
    return list.filter((s) => s && Array.isArray(s.categories) && has(s.categories, cat));
  }

  function serviceOrder(id) {
    const list = catalogServices();
    const i = list.findIndex((s) => s && s.id === id);
    if (i !== -1) return i;
    const j = Object.keys(FALLBACK_SERVICES).indexOf(id);
    return j === -1 ? 999 : j;
  }

  /** Builder object by id: catalog merged over fallback knowledge (so missing fields still work). */
  function builderInfo(id) {
    if (!id) return null;
    let b = null;
    if (VC.data && typeof VC.data.builderById === 'function') {
      try { b = VC.data.builderById(id); } catch (e) { b = null; }
    }
    if (!b) b = catalogBuilders().find((x) => x && x.id === id) || null;
    const f = FALLBACK_BUILDERS[id];
    if (!b && !f) return null;
    if (!b) return Object.assign({ id, secrets: {}, _fallback: true }, f);
    return f ? Object.assign({ id }, f, b) : b;
  }

  function builderIds() {
    const ids = catalogBuilders().map((b) => b && b.id).filter(Boolean);
    return ids.length ? ids : BUILDER_ORDER.slice();
  }

  function canMobile(b) {
    if (!b) return false;
    if (b.framework === 'expo' || b.mobile === true) return true;
    if (has(MOBILE_BUILDERS, b.id)) return true;
    if (FALLBACK_BUILDERS[b.id]) return false;
    return /expo|react native/i.test([b.defaultStack, b.bestFor, b.tagline].join(' '));
  }

  function isNative(s, b) {
    if (!s || !b) return false;
    if (has(b.nativeIntegrations, s.id)) return true;
    return !!(s.builderSupport && s.builderSupport[b.id] === 'native');
  }

  function categoryName(id) {
    let c = null;
    if (VC.data && typeof VC.data.categoryById === 'function') {
      try { c = VC.data.categoryById(id); } catch (e) { c = null; }
    }
    return (c && c.name) || CATEGORY_NAMES[id] || cap(String(id || '').replace(/-/g, ' '));
  }
  const catShort = (id) => CATEGORY_SHORT[id] || categoryName(id).toLowerCase();

  /* ------------------------------------------------------------------ *
   * Reading the project
   * ------------------------------------------------------------------ */
  function answersOf(project) {
    const a = (project && project.answers) || {};
    return {
      builder: a.builder || 'unsure',
      accounts: a.accounts || 'unsure',
      payments: a.payments || '',
      platform: a.platform || 'web',
      budget: a.budget || 'free',
      experience: a.experience || 'never',
      ai: a.ai || 'unsure',
    };
  }

  function directionOf(project) {
    const d = (project && project.chosenDirection) || {};
    return {
      id: d.id || '',
      name: String(d.name || (project && project.name) || 'your app'),
      pitch: String(d.pitch || ''),
      features: (Array.isArray(d.features) ? d.features : []).map((f) => String(f || '').trim()).filter(Boolean),
      needs: Array.isArray(d.needs) ? d.needs : [],
      screens: (Array.isArray(d.screens) ? d.screens : []).map((s) => String((s && s.name) || '').trim()).filter(Boolean),
      vibe: String(d.vibe || ''),
      difficulty: d.difficulty || 'medium',
      archetypeId: d.archetypeId || 'custom',
    };
  }

  /** Everything we know about the app, as one lowercase string for keyword checks. */
  function projectText(project) {
    const d = directionOf(project);
    return [project && project.idea, d.name, d.pitch, d.features.join('. ')].join(' ').toLowerCase();
  }

  /** What the app's AI mostly does: 'images' | 'voice' | 'text'. */
  function aiUseCase(project) {
    const t = projectText(project);
    const img = /\b(generat\w*|creat\w*|mak\w*|design\w*|draw\w*|turn\w*|restyl\w*|transform\w*)\b[^.]{0,40}\b(images?|photos?|pictures?|art|artwork|avatars?|logos?|illustrations?|headshots?|thumbnails?|stickers?|wallpapers?)\b|\b(images?|photos?|pictures?|art|avatars?|logos?|headshots?|thumbnails?|stickers?)\s+(generat\w*|maker|creator)/;
    if (img.test(t)) return 'images';
    if (/\b(voice|voices|voiceover|speech|narrat\w*|text[- ]to[- ]speech|tts|read(s|ing)? aloud|audiobooks?|dubbing|podcasts?)\b/.test(t)) return 'voice';
    return 'text';
  }

  function paymentType(project, needs) {
    const a = answersOf(project);
    if (has(['one-time', 'subscription', 'marketplace'], a.payments)) return a.payments;
    if (!has(needs, 'payments')) return 'none';
    const t = projectText(project);
    if (/\b(marketplace|sellers?|vendors?|commission|payouts?|hosts? get paid)\b/.test(t)) return 'marketplace';
    if (/\b(subscri\w*|monthly|membership|members|premium|pro plan)\b/.test(t)) return 'subscription';
    return 'one-time';
  }

  /** Digital goods (courses, downloads, beats…) are where Lemon Squeezy shines. */
  function sellsDigital(project) {
    const d = directionOf(project);
    if (has(['education-course', 'music-creator', 'content-blog'], d.archetypeId)) return true;
    return /\b(download\w*|digital|e-?books?|courses?|templates?|presets?|beats?|samples?|licen[cs]\w*)\b/.test(projectText(project));
  }

  /** The categories this app needs, in catalog order (hosting handled separately). */
  function needsOf(project) {
    const a = answersOf(project);
    const d = directionOf(project);
    const set = {};
    d.needs.forEach((c) => { if (has(CATEGORY_ORDER, c)) set[c] = true; });
    if (a.accounts === 'yes') set.auth = true;
    if (a.accounts === 'no') delete set.auth;
    if (a.payments && a.payments !== 'none') set.payments = true;
    if (a.payments === 'none') delete set.payments;
    // Subscriptions and marketplaces need to know who's who, so they imply accounts.
    if (set.payments && a.accounts !== 'no' && has(['subscription', 'marketplace'], paymentType(project, Object.keys(set)))) set.auth = true;
    if (a.ai === 'yes') set.ai = true;
    if (a.ai === 'no') delete set.ai;
    if (set.ai && aiUseCase(project) === 'voice') set.media = true;
    if (set.auth || set.realtime) set.database = true;
    delete set.hosting;
    return CATEGORY_ORDER.filter((c) => set[c]);
  }

  /** Signatures of the inputs a kit was built from, so views can tell when it's out of date. */
  function basis(project) {
    const d = (project && project.chosenDirection) || {};
    const dir = hash(JSON.stringify([d.id || '', d.name || '', d.needs || [], d.features || []]));
    const a = answersOf(project);
    const ans = hash(JSON.stringify([a.builder, a.accounts, a.payments, a.platform, a.budget, a.experience, a.ai]));
    return { direction: dir, answers: ans };
  }

  /* ------------------------------------------------------------------ *
   * Builder
   * ------------------------------------------------------------------ */
  const SKILL_FIT = {
    never: { beginner: 4, intermediate: 0, advanced: -4 },
    some: { beginner: 3, intermediate: 2, advanced: -1 },
    shipped: { beginner: 0, intermediate: 3, advanced: 4 },
  };

  /** Score every builder for this project. Each score carries reason fragments ({w, text}). */
  function rankBuilders(project, needs) {
    const a = answersOf(project);
    const d = directionOf(project);
    const D = d.name;
    const mobile = a.platform === 'mobile' || a.platform === 'both';
    const landing = !has(needs, 'database') && !has(needs, 'auth');
    const payType = paymentType(project, needs);
    const backendNeeds = needs.filter((c) => has(['ai', 'sms', 'email'], c)).concat(payType === 'marketplace' ? ['payments'] : []);

    return builderIds().map((id, idx) => {
      const b = builderInfo(id);
      if (!b) return null;
      const skill = b.skill || 'beginner';
      const why = [];
      let score = (SKILL_FIT[a.experience] || SKILL_FIT.never)[skill] || 0;

      if (a.experience === 'never' && skill === 'beginner') {
        why.push({ w: 3, text: `You describe ${D} in plain English and ${b.name} builds it, with no code to touch. That's ideal for a first app.` });
      } else if (a.experience === 'some' && skill !== 'advanced') {
        why.push({ w: 2, text: `${b.name} does the heavy lifting from chat, but still lets you look at the code when you're curious.` });
      } else if (a.experience === 'shipped' && skill !== 'beginner') {
        why.push({ w: 3, text: `You've shipped before, so ${b.name} gives you full control of the code without guardrails slowing you down.` });
      }

      if (mobile) {
        if (canMobile(b)) {
          score += 4;
          why.push({ w: 4, text: `It can build a real phone app (with Expo), which ${D} needs since you want it on ${a.platform === 'both' ? 'phones and the web' : 'phones'}.` });
        } else {
          score -= 6;
        }
      }

      // Built-in connectors for the services this app needs.
      const nativeIds = uniq((b.nativeIntegrations || []).filter((sid) => {
        const s = service(sid);
        return s && (s.categories || []).some((c) => has(needs, c));
      }));
      const covered = uniq(nativeIds.reduce((acc, sid) => acc.concat((service(sid).categories || []).filter((c) => has(needs, c))), []));
      if (covered.length) {
        score += Math.min(2, covered.length * 0.6);
        why.push({ w: 1 + Math.min(2, covered.length * 0.5), text: `It has built-in connections for ${listJoin(nativeIds.map((sid) => service(sid).name))}, which covers ${listJoin(covered.map(catShort))} in a few clicks.` });
      }

      if (landing && (id === 'v0' || id === 'lovable')) {
        score += id === 'v0' ? 2 : 1;
        why.push({ w: 2, text: `${D} is mostly about looking great, and ${b.name} is especially good at polished, fast pages.` });
      }
      if (backendNeeds.length && a.experience !== 'never' && has(['replit', 'cursor', 'claude-code'], id)) {
        score += 1;
        why.push({ w: 1, text: `It runs real server code, which keeps ${listJoin(uniq(backendNeeds).map(catShort))} safe and simple.` });
      }
      if (a.experience === 'shipped' && d.difficulty === 'hard' && id === 'claude-code') score += 1;
      if (a.budget === 'free' && id === 'claude-code') score -= 2;   // no free plan

      return { id, b, score, why, idx };
    }).filter(Boolean).sort((x, y) => (y.score - x.score) || (x.idx - y.idx));
  }

  function composeReason(entry) {
    const parts = entry.why.slice().sort((x, y) => y.w - x.w).slice(0, 2).map((f) => f.text);
    return parts.length ? parts.join(' ') : (entry.b.bestFor ? cap(entry.b.bestFor) + '.' : `${entry.b.name} is a solid all-round choice.`);
  }

  /** Kit.builder for a project: the user's own pick if they have one, otherwise our recommendation. */
  function chooseBuilder(project, needs) {
    const a = answersOf(project);
    const D = directionOf(project).name;
    const mobile = a.platform === 'mobile' || a.platform === 'both';
    const ranked = rankBuilders(project, needs);
    if (!ranked.length) return { id: 'lovable', reason: 'Lovable is the easiest way to start a web app.', alternatives: ['bolt', 'cursor'], chosenBy: 'recommended' };

    const picked = a.builder && a.builder !== 'unsure' ? ranked.find((r) => r.id === a.builder) : null;
    if (picked) {
      const b = picked.b;
      // Add the single most useful fragment: its built-in connectors, else why it suits you.
      const native = picked.why.find((f) => /built-in connections/.test(f.text));
      const other = picked.why.filter((f) => f !== native).sort((x, y) => y.w - x.w)[0];
      const extra = native || other;
      const reason = `You're building with ${b.name}, so every step below (keys, settings and prompts) is written for it.` + (extra ? ' ' + extra.text : '');
      let warning = '';
      if (mobile && !canMobile(b)) {
        const alt = ranked.find((r) => canMobile(r.b));
        warning = `${b.name} makes web apps. ${D} will work in a phone's browser (and can be saved to the home screen), but it won't be in the App Store or Google Play.` + (alt ? ` If you need that, ${alt.b.name} can build a real phone app.` : '');
      } else if (a.experience === 'never' && (b.skill === 'advanced' || b.skill === 'intermediate')) {
        const gentle = ranked.find((r) => (r.b.skill || 'beginner') === 'beginner' && (!mobile || canMobile(r.b)));
        warning = `${b.name} expects some comfort with code.` + (gentle ? ` If it starts to feel like too much, ${gentle.b.name} is gentler, and this kit can switch to it in one click.` : '');
      }
      return {
        id: b.id, reason, alternatives: ranked.filter((r) => r.id !== b.id).slice(0, 2).map((r) => r.id),
        chosenBy: 'you', warning: warning || undefined,
      };
    }

    const top = ranked[0];
    return { id: top.id, reason: composeReason(top), alternatives: ranked.slice(1, 3).map((r) => r.id), chosenBy: 'recommended' };
  }

  function pickFramework(b, platform) {
    const fw = (b && b.framework) || 'vite';
    if ((platform === 'mobile' || platform === 'both') && canMobile(b)) return 'expo';
    if (fw === 'any') return 'next';
    return has(['vite', 'next', 'node', 'expo'], fw) ? fw : 'vite';
  }

  /* ------------------------------------------------------------------ *
   * Services
   * ------------------------------------------------------------------ */
  function excluded(s, cat, ctx) {
    // Lemon Squeezy can't pay out to other sellers.
    return cat === 'payments' && s.id === 'lemonsqueezy' && ctx.payType === 'marketplace';
  }

  function scoreService(s, cat, ctx, usedIds) {
    let score = 0;
    const mc = s.monthlyCost || { low: 0, high: 0 };
    if (DEFAULT_PICK[cat] === s.id) score += 4;
    if (has(usedIds, s.id)) score += 6;
    score += 1.5 * (s.categories || []).filter((c) => c !== cat && has(ctx.needs, c)).length;
    const support = s.builderSupport && s.builderSupport[ctx.builder.id];
    score += isNative(s, ctx.builder) ? 3 : support === 'easy' ? 1.5 : 0;
    if (ctx.budget === 'free' && mc.low > 0) score -= 4;
    if (ctx.budget === 'low' && mc.low > 20) score -= 2;
    const diff = { easy: 1, medium: 0, hard: -1 }[s.difficulty] || 0;
    score += ctx.experience === 'never' ? diff * 2 : diff;
    if (ctx.useCase === 'images' && s.id === 'replicate' && (cat === 'ai' || cat === 'media')) score += 8;
    if (ctx.useCase === 'voice' && s.id === 'elevenlabs' && cat === 'media') score += 8;
    if (cat === 'maps') score += (ctx.budget === 'free' ? s.id === 'mapbox' : s.id === 'google-maps') ? 3 : 0;
    if (cat === 'payments' && ctx.payType === 'marketplace' && s.id === 'stripe') score += 5;
    return score;
  }

  const NEED = {
    database: (D) => `Saves everything in ${D} so it's safe and still there tomorrow.`,
    auth: (D) => `Lets people sign up and log in to ${D}.`,
    ai: (D, ctx) => ctx.useCase === 'images' ? `Creates the images in ${D}.` : `Powers the AI features in ${D}.`,
    email: (D) => `Sends ${D}'s emails, like receipts and reminders.`,
    storage: (D) => `Stores the photos and files people upload to ${D}.`,
    maps: (D) => `Shows maps and finds places in ${D}.`,
    sms: (D) => `Sends text messages from ${D}, like codes and reminders.`,
    analytics: (D) => `Shows how people use ${D} and where they get stuck.`,
    monitoring: (D) => `Tells you when ${D} breaks for someone, before they have to tell you.`,
    realtime: (D) => `Makes ${D} update instantly for everyone, with no refresh.`,
    media: (D, ctx) => ctx.useCase === 'voice' ? `Turns text into natural-sounding speech for ${D}.` : ctx.useCase === 'images' ? `Creates and edits images for ${D}.` : `Resizes and serves ${D}'s images and video so they load fast.`,
    hosting: (D) => `Puts ${D} on the internet at a real web address.`,
    payments: (D, ctx) => ({
      subscription: `Charges monthly subscriptions in ${D} and pays out to your bank.`,
      marketplace: `Takes payments from buyers in ${D}, pays the sellers, and keeps your cut.`,
    })[ctx.payType] || `Takes card payments in ${D} and pays out to your bank.`,
  };

  function serviceReason(cat, s, ctx, picks) {
    const D = ctx.D;
    const need = (NEED[cat] || ((x) => `Handles ${catShort(cat)} for ${x}.`))(D, ctx);
    const first = picks.find((p) => p.serviceId === s.id);
    if (first) return `${need} ${s.name} already does this, so there's nothing extra to set up.`;

    const bits = [];
    const others = (s.categories || []).filter((c) => c !== cat && has(ctx.needs, c));
    if (others.length) bits.push(`${s.name} also handles ${listJoin(others.map(catShort))}, so it's one account instead of ${numberWord(others.length + 1)}.`);
    if (isNative(s, ctx.builder)) bits.push(`${ctx.builder.name} connects to it built-in.`);

    if (cat === 'payments') {
      if (s.id === 'stripe' && ctx.payType === 'marketplace') bits.push('Stripe Connect handles paying sellers and keeping your fee.');
      else if (s.id === 'stripe' && ctx.digital) bits.push('Selling digital products? Lemon Squeezy is a simpler swap: it handles sales tax for you.');
      else if (s.id === 'stripe') bits.push('It\'s the standard, and every AI builder knows it well.');
      else if (s.id === 'lemonsqueezy') bits.push('It handles sales tax and VAT for you, which matters most for digital products.');
    }
    if (cat === 'email') {
      const authPick = picks.find((p) => p.category === 'auth');
      if (authPick) bits.push(`Login and password emails are already sent by ${service(authPick.serviceId).name}; this is for everything else.`);
    }
    if (cat === 'ai') {
      if (s.id === 'anthropic') bits.push('Claude is great at writing, summarizing and following instructions.');
      if (s.id === 'replicate') bits.push('It runs the popular image models, and you pay per image.');
      if (s.id === 'openai' && ctx.useCase === 'voice') bits.push('It also does speech, if you want one AI account.');
    }
    if (cat === 'media' && s.id === 'elevenlabs') bits.push('Its voices are the most natural-sounding.');
    const mc = s.monthlyCost || {};
    if (ctx.budget === 'free' && mc.low > 0) bits.push(`There's no fully free option here: it's pay-as-you-go, about $${mc.low}–$${mc.high} a month for a small app.`);

    if (!bits.length && s.whyPick) bits.push(cap(s.whyPick).replace(/([^.!?])$/, '$1.'));
    return [need].concat(bits.slice(0, 2)).join(' ');
  }

  /** Validate saved swaps against the current needs: drop any that no longer make sense. */
  function validChoices(choices, needs) {
    const out = {};
    Object.keys(choices || {}).forEach((cat) => {
      const id = choices[cat];
      if (cat === 'hosting') {
        if (id === 'builtin' || has((service(id) || {}).categories, 'hosting')) out.hosting = id;
        return;
      }
      const s = service(id);
      if (has(needs, cat) && s && has(s.categories, cat)) out[cat] = id;
    });
    return out;
  }

  function pickServices(ctx) {
    const picks = [];
    const used = [];
    ctx.needs.forEach((cat) => {
      const cands = servicesFor(cat).filter((s) => !excluded(s, cat, ctx));
      if (!cands.length) return;
      const ranked = cands
        .map((s) => ({ s, score: scoreService(s, cat, ctx, used) }))
        .sort((x, y) => (y.score - x.score) || (serviceOrder(x.s.id) - serviceOrder(y.s.id)));
      const userId = ctx.choices[cat];
      const byUser = !!(userId && cands.some((s) => s.id === userId));
      const s = byUser ? cands.find((c) => c.id === userId) : ranked[0].s;
      const entry = {
        category: cat,
        serviceId: s.id,
        reason: serviceReason(cat, s, ctx, picks),
        required: true,
        alternatives: ranked.map((r) => r.s.id).filter((id) => id !== s.id).slice(0, 3),
      };
      if (byUser) entry.chosenBy = 'you';
      picks.push(entry);
      if (!has(used, s.id)) used.push(s.id);
    });

    // Hosting: the builder's own publish button when it has one, otherwise Vercel/Netlify.
    const builtIn = BUILTIN_HOSTING[ctx.builder.id];
    const hostChoice = ctx.choices.hosting;
    let hosting;
    if (builtIn && (!hostChoice || hostChoice === 'builtin')) {
      hosting = { builtIn: true, builderId: ctx.builder.id, name: builtIn.name, note: builtIn.note, alternatives: servicesFor('hosting').map((s) => s.id) };
    } else {
      const cands = servicesFor('hosting');
      if (cands.length) {
        const ranked = cands.map((s) => {
          let score = DEFAULT_PICK.hosting === s.id ? 4 : 0;
          if (has(ctx.builder.nativeIntegrations, s.id)) score += 3;
          if (ctx.framework === 'next' && s.id === 'vercel') score += 2;
          if (ctx.framework === 'vite' && s.id === 'netlify') score += 1;
          return { s, score };
        }).sort((x, y) => (y.score - x.score) || (serviceOrder(x.s.id) - serviceOrder(y.s.id)));
        const byUser = !!(hostChoice && hostChoice !== 'builtin' && cands.some((s) => s.id === hostChoice));
        const s = byUser ? cands.find((c) => c.id === hostChoice) : ranked[0].s;
        let why = NEED.hosting(ctx.D);
        if (ctx.builder.id === 'v0' && s.id === 'vercel') why += ' v0 is made by Vercel, so publishing is one click with the same account.';
        else if (has(ctx.builder.nativeIntegrations, s.id)) why += ` ${ctx.builder.name} can publish to it directly.`;
        else if (!builtIn) why += ` It publishes a new version every time you save your code to GitHub${s.freeTier ? ', and the free plan is plenty to start' : ''}.`;
        if (ctx.framework === 'expo') why += ' (This hosts the web version; the phone app goes through the app stores.)';
        const entry = { category: 'hosting', serviceId: s.id, reason: why, required: true, alternatives: ranked.map((r) => r.s.id).filter((id) => id !== s.id) };
        if (byUser) entry.chosenBy = 'you';
        picks.unshift(entry);
        hosting = { builtIn: false, serviceId: s.id };
        if (builtIn) hosting.canUseBuiltIn = true;
      } else {
        hosting = { builtIn: false, serviceId: null };
      }
    }
    if (ctx.framework === 'expo') hosting.appStores = true;

    // Version control: GitHub is a must for code-on-your-computer tools, a nice backup elsewhere.
    const handled = has(BUILTIN_HISTORY, ctx.builder.id);
    const hostName = hosting.serviceId ? service(hosting.serviceId).name : 'your host';
    picks.push({
      category: VERSION_CONTROL,
      serviceId: 'github',
      reason: handled
        ? `${ctx.builder.name} keeps its own version history, so this is optional. Syncing to GitHub gives you a backup of ${ctx.D} that you own, even if you ever leave ${ctx.builder.name}.`
        : `${ctx.builder.name} works on files on your computer. GitHub keeps every version of ${ctx.D} safe online, so a bad change is easy to undo, and ${hostName} can publish straight from it.`,
      required: !handled,
      alternatives: [],
    });

    return { services: picks, hosting };
  }

  /* ------------------------------------------------------------------ *
   * Milestones
   * ------------------------------------------------------------------ */
  const PAY_RE = /\b(pay|pays|paying|payments?|checkout|subscri\w*|pricing|tip jar|tipping|donat\w*|purchas\w*|buy|buying|sell|selling|premium|paid|billing|invoic\w*|membership|payouts?|commission)\b/i;
  const AUTH_RE = /\b(sign[ -]?ups?|log[ -]?ins?|sign[ -]?in|passwords?|user accounts?|auth|authentication)\b/i;
  const AI_RE = /\b(ai|a\.i\.|gpt|claude|llm|smart|generat\w*|suggest\w*|recommend\w*|summar\w*|chatbot|assistant|auto-?(tag|write|fill|generat)\w*)\b/i;

  /** Keyword → a check anyone can do by clicking around, plus the category it leans on. */
  const FEATURE_CHECKS = [
    [/\b(search\w*|filter\w*|find|browse|sort\w*)\b/i, 'Searching or filtering shows the right results, and a search with no matches shows a friendly "nothing found" message.', null],
    [/\b(upload\w*|photos?|images?|pictures?|files?|attach\w*|avatars?|gallery|videos?)\b/i, 'Uploading a photo shows it on the page, and a huge or wrong type of file gets a clear message instead of breaking.', 'storage'],
    [/\b(maps?|locations?|nearby|address\w*|near me|directions)\b/i, 'The map shows pins in the right places, and tapping one shows its details.', 'maps'],
    [/\b(chat\w*|messag\w*|dms?|comments?|live|real-?time|feed)\b/i, 'LIVE', 'realtime'],
    [/\b(book\w*|schedul\w*|appointments?|calendar|slots?|reserv\w*)\b/i, 'Booking a time slot makes it unavailable to the next person, and both sides can see the booking.', null],
    [/\b(text messages?|sms)\b/i, 'The text message actually arrives on your phone.', 'sms'],
    [/\b(remind\w*|notif\w*|emails?|alerts?|digest)\b/i, 'The reminder or email actually arrives (check the spam folder too).', 'email'],
    [/\b(dashboard|stats|charts?|analytics|reports?|insights?|progress|streaks?|totals?)\b/i, 'The numbers and charts match what you actually entered.', null],
    [/\b(share\w*|sharing|invite\w*|public (profile|page|link)s?)\b/i, 'A shared link opens correctly in a private browser window and shows only what should be public.', null],
    [/\b(reviews?|ratings?|liking|upvot\w*|favou?rit\w*|bookmark\w*|wishlists?|save for later)\b/i, 'Liking or saving something sticks after a refresh, and you can undo it.', null],
    [/\b(profiles?)\b/i, 'You can edit your profile and see the change straight away.', null],
    [/\b(export\w*|downloads?|pdfs?|csv)\b/i, 'The download opens correctly on your computer.', null],
    [/\b(audio|playback|player|playlists?|listen\w*|music|songs?|podcasts?)\b/i, 'Audio plays, pauses and skips on both a laptop and a phone.', null],
  ];

  function checkForFeature(feature, ctx) {
    for (let i = 0; i < FEATURE_CHECKS.length; i++) {
      const [re, text, cat] = FEATURE_CHECKS[i];
      if (!re.test(feature)) continue;
      if (text === 'LIVE') {
        return {
          text: has(ctx.needs, 'realtime')
            ? 'Open the app in two browser windows: something posted in one shows up in the other without refreshing.'
            : 'Something posted by one test account shows up for another after a refresh.',
          cat: has(ctx.needs, 'realtime') ? 'realtime' : null,
        };
      }
      return { text, cat };
    }
    return { text: `"${shortTitle(feature, 60)}" works from start to finish when you try it yourself.`, cat: null };
  }

  function serviceFor(cat, services) {
    const e = services.find((s) => s.category === cat);
    return e ? e.serviceId : null;
  }

  function buildMilestones(project, ctx, services) {
    const d = directionOf(project);
    const D = d.name;
    const B = ctx.builder.name;
    const idOf = (cat) => serviceFor(cat, services);
    const nameOf = (cat) => { const id = idOf(cat); return id ? service(id).name : ''; };
    const screens = d.screens.length ? d.screens : ['Home'];
    const mainScreen = screens.find((s) => !/^(home|landing|welcome|splash|login|sign ?up)/i.test(s)) || screens[0];
    const githubRequired = services.some((s) => s.serviceId === 'github' && s.required);
    const hasAuth = has(ctx.needs, 'auth');
    const hasDb = has(ctx.needs, 'database');
    const hasPay = has(ctx.needs, 'payments');
    const hasAI = has(ctx.needs, 'ai');

    // Sort the direction's features into buckets: accounts, payments, AI, and the main app.
    const buckets = { auth: [], pay: [], ai: [], main: [] };
    d.features.forEach((f) => {
      if (hasPay && PAY_RE.test(f)) buckets.pay.push(f);
      else if (hasAI && AI_RE.test(f)) buckets.ai.push(f);
      else if (hasAuth && AUTH_RE.test(f) && !/\bprofiles?\b/i.test(f)) buckets.auth.push(f);
      else buckets.main.push(f);
    });

    const ms = [];

    // 1 — setup + first screen with fake data
    ms.push({
      title: 'Project setup & first screens',
      goal: `Get ${D} running with its main screens, filled with made-up example data so you can see how it feels before anything is real.`,
      features: [
        `Start a new project in ${B}`,
        `Screens: ${listJoin(screens)}`,
        d.vibe ? `Look and feel: ${lcFirst(d.vibe)}` : 'A clean, consistent look',
        'Realistic made-up example data (no database yet)',
        githubRequired ? 'Connect GitHub and save the first version' : 'Save a first checkpoint you can go back to',
      ],
      doneWhen: uniq([
        `The preview shows the ${screens[0]} screen, and it looks like ${D}, not a template.`,
        screens.length > 1 ? `You can click between ${listJoin(screens)} without anything breaking.` : null,
        'The example data looks realistic (real-sounding names, not "Lorem ipsum").',
        'Shrinking the window to phone size still looks good.',
      ]),
      services: githubRequired ? ['github'] : [],
      size: 'S',
    });

    // 2 — accounts
    if (hasAuth) {
      const authName = nameOf('auth');
      ms.push({
        title: 'Sign-up & login',
        goal: `Let people create an account and log in${authName ? ' with ' + authName : ''}, so their stuff stays theirs.`,
        features: uniq(['Sign up and log in with email', 'Log out', '"Forgot password" email', `Only logged-in people can open ${mainScreen}`].concat(buckets.auth)).slice(0, 6),
        doneWhen: [
          `You can sign up with a new email address and end up on the ${mainScreen} screen.`,
          'Logging out and back in works, and a wrong password shows a friendly error.',
          `Opening ${mainScreen} while logged out sends you to the login page.`,
          'The "forgot password" email arrives, and its link lets you set a new password.',
        ],
        services: uniq([idOf('auth')]),
        size: idOf('auth') === 'clerk' ? 'S' : 'M',
      });
    }

    // 3 — real data
    if (hasDb) {
      const dbId = idOf('database');
      const lockCheck = dbId === 'supabase'
        ? 'In Supabase → Table Editor, no table is marked "Unrestricted" (that means Row Level Security is on).'
        : dbId === 'firebase'
          ? 'Your Firebase security rules don\'t contain "allow read, write: if true".'
          : 'The database only lets people read and change what they\'re allowed to.';
      ms.push({
        title: 'Save real data',
        goal: `Swap the example data for real data that's saved in ${nameOf('database') || 'the database'}, and lock it so people only see what they should.`,
        features: uniq([
          'Replace the example data with real, saved data',
          'Add, edit and delete items',
          hasAuth ? 'Each person only sees and changes their own private data' : 'Visitors can read public data but can\'t change or delete it',
          dbId === 'supabase' ? 'Row Level Security on every table' : 'Database security rules',
        ]),
        doneWhen: uniq([
          'Add something, refresh the page, and it\'s still there.',
          'Editing and deleting work, and deleting asks "Are you sure?" first.',
          hasAuth ? 'Log in as a second test account: you can\'t see or change the first account\'s private stuff.' : null,
          lockCheck,
        ]),
        services: uniq([dbId]),
        size: d.difficulty === 'hard' ? 'L' : 'M',
      });
    }

    // 4 — main features, split into 1–3 milestones
    const tailCount = (hasPay ? 1 : 0) + (hasAI ? 1 : 0) + 1;   // + polish
    const fixed = ms.length + tailCount;
    const maxChunks = clamp(8 - fixed, 1, 3);
    const minChunks = clamp(5 - fixed, 1, 3);
    let main = buckets.main.slice();
    const fillers = [
      'Search and sort',
      hasAuth ? 'Profile and settings page' : 'An "About" page with a contact form',
      'Share a link to any item',
    ];
    while (main.length < minChunks && fillers.length) main.push(fillers.shift());
    const chunkCount = clamp(Math.ceil(main.length / 2), minChunks, Math.min(maxChunks, main.length));
    const chunks = [];
    for (let i = 0; i < chunkCount; i++) {
      const from = Math.round((i * main.length) / chunkCount);
      const to = Math.round(((i + 1) * main.length) / chunkCount);
      chunks.push(main.slice(from, to));
    }
    const GOALS = [
      `Build the heart of ${D}: the part people come for.`,
      'Add the next most important pieces.',
      'Round out the main features.',
    ];
    chunks.forEach((chunk, i) => {
      const titles = chunk.map((f) => shortTitle(f, 30));
      const joined = titles.length > 1 ? titles[0] + ' & ' + lcFirst(titles[1]) : titles[0];
      const title = titles.length === 1 ? titles[0] : (joined.length <= 46 && titles.length === 2 ? joined : shortTitle(chunk[0], 32) + ' & more');
      const checks = chunk.map((f) => checkForFeature(f, ctx));
      const cats = uniq(checks.map((c) => c.cat).filter((c) => c && has(ctx.needs, c)));
      const heavy = /\b(real-?time|live|chat|maps?|calendar|book\w*|upload\w*|video|marketplace)\b/i.test(chunk.join(' '));
      ms.push({
        title,
        goal: GOALS[i] || GOALS[2],
        features: chunk.map((f) => cap(f)),
        doneWhen: uniq(checks.map((c) => c.text).concat(hasDb ? ['Everything you added is still there after a refresh.'] : [])).slice(0, 4),
        services: uniq(cats.map(idOf).concat(i === 0 && hasDb ? [idOf('database')] : [])).filter(Boolean),
        size: chunk.length >= 3 || heavy ? 'L' : chunk.length === 1 ? 'S' : 'M',
      });
    });

    // 5 — payments
    if (hasPay) {
      const payId = idOf('payments');
      const payName = nameOf('payments') || 'the payment service';
      const byType = {
        'one-time': { title: 'Payments', feats: ['A checkout button that opens a secure payment page', 'A "thank you" page and confirmation', 'Unlock what they bought only after the payment is confirmed'] },
        subscription: { title: 'Subscriptions', feats: ['A pricing page with your plans', 'Checkout for a monthly plan', 'Premium features unlock only for paying members', 'Members can cancel or change plans themselves'] },
        marketplace: { title: 'Payments & seller payouts', feats: ['Sellers connect a bank account to get paid', 'Buyers pay through a secure checkout', 'Your fee is taken automatically', 'Sellers see what they\'ve earned'] },
      }[ctx.payType] || { title: 'Payments', feats: ['A secure checkout'] };
      ms.push({
        title: byType.title,
        goal: `Take real money through ${payName}, safely: prices are set on the server and nothing unlocks until the payment is confirmed.`,
        features: uniq(byType.feats.concat(buckets.pay.map(cap))).slice(0, 6),
        doneWhen: uniq([
          'Paying with the test card 4242 4242 4242 4242 (any future date, any 3 digits) works and unlocks what you paid for.',
          'The declined test card 4000 0000 0000 0002 shows a friendly error, and nothing unlocks.',
          `The test payment shows up in your ${payName} dashboard.`,
          ctx.payType === 'subscription' ? 'Cancelling the test subscription removes premium access at the end of the period.' : null,
          ctx.payType === 'marketplace' ? 'A test seller account receives its share of a test sale.' : null,
        ]).slice(0, 4),
        services: uniq([payId]),
        size: ctx.payType === 'one-time' ? 'M' : 'L',
      });
    }

    // 6 — the AI feature
    if (hasAI) {
      const aiFeat = buckets.ai[0] || '';
      ms.push({
        title: !aiFeat ? 'The AI feature' : /\bAI\b/i.test(aiFeat) ? shortTitle(aiFeat, 38) : 'AI: ' + lcFirst(shortTitle(aiFeat, 32)),
        goal: `Add ${D}'s AI feature in a way that's fast, safe, and can't run up your bill.`,
        features: uniq(buckets.ai.map(cap).concat([
          'The AI runs on the server, so your AI key stays secret',
          'A limit on how often each person can use it',
          'A loading message while it thinks, and a friendly error if it fails',
        ])).slice(0, 6),
        doneWhen: [
          'It gives a useful result in under about 15 seconds.',
          'While it\'s working you see a loading message, not a frozen screen.',
          'Clicking it 20 times fast gets a polite "slow down" message instead of 20 charges.',
          'Vibe Check\'s safety scan finds no AI key in your app\'s code.',
        ],
        services: uniq([idOf('ai'), idOf('media')]).filter(Boolean),
        size: 'M',
      });
    }

    // Last — polish, safety, launch
    const hostId = idOf('hosting');
    ms.push({
      title: 'Polish, safety check & launch',
      goal: `Smooth the rough edges, pass the safety scan, and put ${D} online for real.`,
      features: [
        'Friendly empty screens and error messages',
        'Looks good on phones',
        'Run the Vibe Check safety scan and fix what it finds',
        'Add your keys to the live site\'s settings',
        ctx.hosting.builtIn ? `Publish with ${ctx.hosting.name}` : `Publish on ${hostId ? service(hostId).name : 'your host'}`,
      ],
      doneWhen: [
        'Vibe Check\'s safety scan gives you an A or B.',
        'Every page looks right on your phone.',
        'Screens with no data yet explain what to do next.',
        'The live link works in a private browser window.',
      ],
      services: uniq([hostId, githubRequired ? 'github' : null]).filter(Boolean),
      size: 'M',
    });

    return ms.map((m, i) => Object.assign({ id: 'm' + (i + 1) }, m));
  }

  /* ------------------------------------------------------------------ *
   * Cost
   * ------------------------------------------------------------------ */
  const PROMPT_RANGE = { S: [3, 6], M: [6, 12], L: [10, 20] };
  const CREDIT_NOTE = {
    lovable: 'Lovable counts each message as a credit, so that\'s roughly how many credits to expect.',
    bolt: 'Bolt counts tokens, and long chats use them up fast, so start a fresh chat for each milestone.',
    replit: 'Replit\'s Agent charges by effort, so small, clear prompts keep the bill down.',
    v0: 'v0 uses credits per message, so small, focused prompts stretch your plan further.',
    cursor: 'Most of this fits inside Cursor\'s monthly plan if you keep to one feature per chat.',
    'claude-code': 'This usually fits a Claude subscription\'s usage limits if you clear the chat between milestones.',
  };

  function firstSentence(s) {
    s = String(s || '').trim();
    const m = s.match(/^(.{20,140}?[.;])\s/);
    return (m ? m[1] : s).replace(/[.;]$/, '');
  }

  function buildCost(project, ctx, services, milestones) {
    const lines = [];
    let low = 0;
    let high = 0;
    const seen = {};
    services.forEach((e) => {
      if (seen[e.serviceId]) return;
      seen[e.serviceId] = true;
      const s = service(e.serviceId);
      if (!s) return;
      const mc = s.monthlyCost || { low: 0, high: 0 };
      const lo = Number(mc.low) || 0;
      const hi = Math.max(lo, Number(mc.high) || 0);
      let amount;
      let note = s.freeTier ? firstSentence(s.freeTier) : '';
      if (e.category === 'payments') {
        amount = 'Fee per sale';
        note = note || 'No monthly fee; a small cut of each payment';
      } else if (lo > 0) {
        amount = lo === hi ? `$${lo}/mo` : `$${lo}–$${hi}/mo`;
        if (has(s.categories, 'ai') || has(s.categories, 'sms')) note = `Pay as you go. Set a spending limit.${note && !/pay/i.test(note) ? ' ' + note : ''}`;
      } else if (hi > 0) {
        amount = 'Free to start';
        note = note ? `${note}. Then from ~$${hi}/mo` : `Up to ~$${hi}/mo as you grow`;
      } else {
        amount = 'Free';
      }
      low += lo;
      high += hi;
      lines.push({ label: s.name, amount, note, serviceId: s.id, required: e.required !== false });
    });

    const b = ctx.builder;
    const builderLine = { label: b.name, amount: b.pricing ? firstSentence(b.pricing) : 'Free to start', note: 'Your builder\'s plan while you build' };

    const extras = [];
    if (ctx.framework === 'expo') {
      extras.push({ label: 'Apple Developer account', amount: '$99/year', note: 'Only needed to publish on the App Store' });
      extras.push({ label: 'Google Play developer account', amount: '$25 once', note: 'Only needed to publish on Google Play' });
    }

    let pLo = 0;
    let pHi = 0;
    milestones.forEach((m) => { const r = PROMPT_RANGE[m.size] || PROMPT_RANGE.M; pLo += r[0]; pHi += r[1]; });
    const buildNote = `Expect roughly ${pLo}–${pHi} prompts across ${milestones.length} milestones, including a few fix-ups. ` +
      (CREDIT_NOTE[b.id] || 'Small, focused prompts keep your credits and costs down.') +
      ' Prompt Studio\'s step-by-step prompts are written to keep this number low.';

    let budgetNote = '';
    const paid = lines.filter((l) => /\$/.test(l.amount) && !/^Free/.test(l.amount));
    if (ctx.budget === 'free' && paid.length) {
      budgetNote = `You asked to keep it free. Everything here has a free plan except ${listJoin(paid.map((l) => l.label))}, which ${paid.length === 1 ? 'charges' : 'charge'} per use (usually a few dollars a month while you're small).`;
    }

    return { monthlyLow: low, monthlyHigh: high, lines, buildNote, builder: builderLine, extras, budgetNote: budgetNote || undefined };
  }

  /* ------------------------------------------------------------------ *
   * Safety rules (injected into every prompt)
   * ------------------------------------------------------------------ */
  function words(s) { return String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3); }
  function similar(a, b) {
    const wa = words(a);
    const wb = words(b);
    if (!wa.length || !wb.length) return false;
    const setB = {};
    wb.forEach((w) => { setB[w] = true; });
    const overlap = wa.filter((w) => setB[w]).length;
    return overlap / Math.min(wa.length, wb.length) >= 0.6;
  }

  function buildSafety(project, ctx, services) {
    const ids = uniq(services.map((s) => s.serviceId));
    const dbId = serviceFor('database', services);
    const needs = ctx.needs;
    const prefix = { vite: 'VITE_', next: 'NEXT_PUBLIC_', expo: 'EXPO_PUBLIC_' }[ctx.framework];
    const secrets = ctx.builder.secrets || {};
    const rules = [];

    rules.push('Keep every secret key in environment variables (the builder\'s secrets settings or a .env file). Never put keys in code or paste them into chat.');
    rules.push('Only public keys (like publishable or anon keys) may appear in frontend code. Anything secret runs on the server.');
    if (prefix) rules.push(`Never give a secret key a name starting with ${prefix}: anything with that prefix is visible to every visitor.`);
    if (dbId === 'supabase') rules.push('Turn on Row Level Security for every table, with policies so people can only read and change their own rows.');
    else if (dbId === 'firebase') rules.push('Write Firebase security rules that only let signed-in users read and write their own data. Never use "allow read, write: if true".');
    else if (has(needs, 'database')) rules.push('Lock the database so people can only read and change their own data.');
    if (has(needs, 'auth')) rules.push('Check who is logged in on the server for every private page and action, not just by hiding buttons.');
    rules.push('Validate every input on the server (required fields, length, type). Never trust what the browser sends.');
    if (has(needs, 'ai')) rules.push('Call the AI only from the server (an edge function or API route), never directly from the browser.');
    if (needs.some((c) => has(['ai', 'sms', 'email', 'media'], c))) rules.push('Rate-limit every feature that costs money per use (AI, texts, emails) so one person can\'t run up your bill.');
    if (has(needs, 'payments')) rules.push('Never trust the browser for prices or payment status: prices come from the server, and access unlocks only after a verified payment webhook.');
    if (has(needs, 'storage')) rules.push('Limit uploads by file type and size, and keep private files private.');
    if (secrets.envFile) rules.push(`Keep ${secrets.envFileName || '.env'} listed in .gitignore so keys are never uploaded to GitHub.`);
    rules.push('Show people friendly error messages. Never show raw error details, keys or stack traces.');

    // Service-specific must-dos from the catalog (skipping ones we already said).
    ids.forEach((id) => {
      const s = service(id);
      (s && Array.isArray(s.safety) ? s.safety : []).slice(0, 2).forEach((r) => {
        const text = String(r || '').trim();
        if (!text || rules.some((x) => similar(x, text))) return;
        rules.push(`${s.name}: ${text.replace(/([^.!?])$/, '$1.')}`);
      });
    });
    return uniq(rules).slice(0, 18);
  }

  /* ------------------------------------------------------------------ *
   * Build
   * ------------------------------------------------------------------ */
  /**
   * build(project, opts?) -> Kit
   * opts.choices: { [category]: serviceId } swaps to honour (default: the ones saved on project.kit).
   */
  function build(project, opts) {
    opts = opts || {};
    project = project || {};
    const a = answersOf(project);
    const d = directionOf(project);
    const needs = needsOf(project);
    const builderPick = chooseBuilder(project, needs);
    const builder = builderInfo(builderPick.id) || Object.assign({ id: builderPick.id, name: cap(builderPick.id), secrets: {} });
    const framework = pickFramework(builder, a.platform);
    const saved = opts.choices || (project.kit && project.kit.choices) || {};
    const choices = validChoices(saved, needs);

    const ctx = {
      D: d.name,
      needs,
      builder,
      framework,
      budget: a.budget,
      experience: a.experience,
      platform: a.platform,
      useCase: aiUseCase(project),
      payType: paymentType(project, needs),
      digital: sellsDigital(project),
      choices,
    };

    const picked = pickServices(ctx);
    ctx.hosting = picked.hosting;
    const services = picked.services.sort((x, y) => {
      const ix = x.category === VERSION_CONTROL ? 99 : CATEGORY_ORDER.indexOf(x.category);
      const iy = y.category === VERSION_CONTROL ? 99 : CATEGORY_ORDER.indexOf(y.category);
      return ix - iy;
    });
    const milestones = buildMilestones(project, ctx, services);

    const kit = {
      builder: builderPick,
      framework,
      services,
      milestones,
      cost: buildCost(project, ctx, services, milestones),
      safetyRules: buildSafety(project, ctx, services),
      generatedAt: Date.now(),
      // Extras beyond the contract (safe to ignore):
      hosting: picked.hosting,           // { builtIn, builderId?, name?, note?, serviceId?, appStores? }
      needs,                             // category IDs the kit covers
      paymentType: ctx.payType,          // 'none' | 'one-time' | 'subscription' | 'marketplace'
      choices,                           // the user's own swaps, re-applied on rebuild
      basis: basis(project),             // input signatures, see isStale()
      directionName: d.name,
    };
    if (!builderPick.warning) delete builderPick.warning;
    return kit;
  }

  /** Deduped Service objects for a kit (catalog data; fallback stubs if the catalog is missing). */
  function uniqueServices(kit) {
    const ids = uniq(((kit && kit.services) || []).map((s) => s && s.serviceId));
    return ids.map(service).filter(Boolean);
  }

  /**
   * Kit services grouped by service, for display:
   * [{ serviceId, service, categories: [...], required, reason, alternatives, chosenBy }]
   */
  function groups(kit) {
    const out = [];
    ((kit && kit.services) || []).forEach((e) => {
      if (!e || !e.serviceId) return;
      let g = out.find((x) => x.serviceId === e.serviceId);
      if (!g) {
        g = { serviceId: e.serviceId, service: service(e.serviceId), categories: [], required: false, reason: e.reason || '', alternatives: [], chosenBy: e.chosenBy };
        out.push(g);
      }
      g.categories.push(e.category);
      g.required = g.required || e.required !== false;
      g.alternatives = uniq(g.alternatives.concat(e.alternatives || []));
      if (e.chosenBy) g.chosenBy = e.chosenBy;
    });
    return out;
  }

  /**
   * What a service in the kit could be swapped for:
   * [{ serviceId, name, category, takesOver: [categories] }] — `category` is the one to pass to swapService.
   */
  function swapOptions(kit, serviceId) {
    const held = ((kit && kit.services) || []).filter((e) => e.serviceId === serviceId);
    const opts = [];
    held.forEach((e) => {
      (e.alternatives || []).forEach((altId) => {
        const s = service(altId);
        if (!s) return;
        let o = opts.find((x) => x.serviceId === altId);
        if (!o) { o = { serviceId: altId, name: s.name, category: e.category, takesOver: [] }; opts.push(o); }
        held.forEach((h) => { if (has(s.categories, h.category) && !has(o.takesOver, h.category)) o.takesOver.push(h.category); });
      });
    });
    return opts.sort((x, y) => y.takesOver.length - x.takesOver.length);
  }

  /** Builder object for a kit (catalog data, or a minimal fallback). */
  function builderOf(kit) {
    const id = kit && kit.builder && kit.builder.id;
    return builderInfo(id) || (id ? { id, name: cap(id), secrets: {} } : null);
  }

  /** The environment variable name for a key in a framework. Secrets never get a public prefix. */
  function envName(key, framework) {
    if (!key) return '';
    const env = key.env || {};
    const fw = framework === 'any' ? 'next' : framework;
    let name = env[fw] || env.node || env.vite || env.next || env.expo || '';
    if (!name) name = String(key.id || 'key').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    if (key.visibility === 'secret') name = name.replace(/^(VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)/, '');
    return name;
  }

  /**
   * swapService(project, category, newServiceId) -> new Kit with that category replaced.
   * If the new service can also cover other categories the old one held (Firebase for
   * Supabase), those move too, so you never end up with two half-used accounts.
   * For hosting, pass 'builtin' to go back to the builder's own publish button.
   */
  function swapService(project, category, newServiceId) {
    const kit = (project && project.kit) || build(project);
    const choices = Object.assign({}, kit.choices || {});
    if (category === 'hosting' && (!newServiceId || newServiceId === 'builtin')) {
      choices.hosting = 'builtin';
    } else {
      const s = service(newServiceId);
      if (!s || !has(s.categories, category)) return build(project, { choices });
      const current = (kit.services || []).find((e) => e.category === category);
      const oldId = current && current.serviceId;
      choices[category] = newServiceId;
      if (oldId && oldId !== newServiceId) {
        (kit.services || []).forEach((e) => {
          if (e.serviceId === oldId && e.category !== category && has(s.categories, e.category)) choices[e.category] = newServiceId;
        });
      }
    }
    return build(project, { choices });
  }

  /** false if the kit matches the project, else 'direction' or 'answers' (what changed). */
  function isStale(project) {
    const kit = project && project.kit;
    if (!kit || !kit.basis) return false;
    const now = basis(project);
    if (kit.basis.direction !== now.direction) return 'direction';
    if (kit.basis.answers !== now.answers) return 'answers';
    return false;
  }

  VC.engine.kit = {
    build,
    uniqueServices,
    builder: builderOf,
    envName,
    swapService,
    // Helpers for views
    groups,
    swapOptions,
    isStale,
    categoryName,
    categoryShort: catShort,
    isNative: (serviceId, builderId) => isNative(service(serviceId), builderInfo(builderId)),
    needs: needsOf,
    canMobile: (id) => canMobile(builderInfo(id)),
    builtInHosting: (id) => BUILTIN_HOSTING[id] || null,
    service,
    builderInfo,
  };
})();
