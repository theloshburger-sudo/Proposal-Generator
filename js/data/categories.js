/* Vibe Check — knowledge base: categories + shared lookup helpers.
   Loads first of the data files, so the helpers here look things up LAZILY
   (VC.data.services / VC.data.builders are defined by later scripts).
   See docs/ARCHITECTURE.md → "Data contracts". */
(function () {
  'use strict';
  const VC = window.VC;
  VC.data = VC.data || {};

  /* ------------------------------------------------------------------ *
   * Categories — the kinds of things an app can need, in display order.
   * IDs are fixed by the contract; engines and archetypes refer to them.
   * ------------------------------------------------------------------ */
  VC.data.categories = [
    {
      id: 'hosting', name: 'Putting it online', icon: 'globe',
      question: 'Where will your app live on the internet?',
      plain: 'Keeps your app online at a web address, so anyone can open it.',
    },
    {
      id: 'database', name: 'Saving data', icon: 'db',
      question: 'Does your app need to remember things, like posts, orders or scores?',
      plain: 'Stores your app\'s information safely so it\'s still there tomorrow.',
    },
    {
      id: 'auth', name: 'Logins & accounts', icon: 'user',
      question: 'Do people need to sign up and log in?',
      plain: 'Lets people create an account, log in, and reset their password.',
    },
    {
      id: 'payments', name: 'Taking payments', icon: 'coin',
      question: 'Will people pay you inside the app?',
      plain: 'Takes card payments or subscriptions and sends the money to your bank.',
    },
    {
      id: 'ai', name: 'AI features', icon: 'sparkles',
      question: 'Should the app itself use AI, like a chatbot, summaries or image generation?',
      plain: 'Connects your app to an AI model so it can write, answer, or create for your users.',
    },
    {
      id: 'email', name: 'Sending emails', icon: 'file',
      question: 'Does the app need to send emails, like welcome messages or receipts?',
      plain: 'Sends emails from your app, such as sign-up confirmations, receipts and reminders.',
    },
    {
      id: 'storage', name: 'File uploads', icon: 'folder',
      question: 'Will people upload photos, videos or documents?',
      plain: 'Stores the files people upload and gives each one a link your app can show.',
    },
    {
      id: 'maps', name: 'Maps & places', icon: 'map',
      question: 'Does the app show a map or search for addresses?',
      plain: 'Shows interactive maps, pins and directions, and turns addresses into map locations.',
    },
    {
      id: 'sms', name: 'Text messages', icon: 'prompt',
      question: 'Does the app need to send text messages or phone codes?',
      plain: 'Sends texts, such as login codes, reminders and alerts, to people\'s phones.',
    },
    {
      id: 'analytics', name: 'Visitor stats', icon: 'eye',
      question: 'Do you want to see how many people use the app and what they click?',
      plain: 'Shows who visits, what they do, and where they get stuck, so you know what to improve.',
    },
    {
      id: 'monitoring', name: 'Error alerts', icon: 'warn',
      question: 'Do you want to hear about it when the app breaks for someone?',
      plain: 'Tells you the moment something breaks for a user, with the details needed to fix it.',
    },
    {
      id: 'realtime', name: 'Live updates', icon: 'bolt',
      question: 'Should things update instantly for everyone, like a chat or a live scoreboard?',
      plain: 'Pushes changes to everyone\'s screen instantly, with no refresh needed.',
    },
    {
      id: 'media', name: 'Images, video & audio', icon: 'wand',
      question: 'Does the app edit images, play video, or turn text into speech?',
      plain: 'Resizes and optimizes images and video, or generates voice and images for you.',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Lookups. Lazy on purpose: services.js and builders.js load after this
   * file, so never cache the arrays themselves at load time.
   * ------------------------------------------------------------------ */
  function findIn(list, id) {
    if (!Array.isArray(list) || id == null) return null;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].id === id) return list[i];
    return null;
  }

  /** Category object by id ('auth'), or null. */
  VC.data.categoryById = (id) => findIn(VC.data.categories, id);
  /** Service object by id ('supabase'), or null. */
  VC.data.serviceById = (id) => findIn(VC.data.services, id);
  /** Builder object by id ('lovable'), or null. */
  VC.data.builderById = (id) => findIn(VC.data.builders, id);
  /** Every service that can cover a category, in catalog order: servicesForCategory('auth') → [supabase, firebase, clerk]. */
  VC.data.servicesForCategory = function (categoryId) {
    return (VC.data.services || []).filter((s) => Array.isArray(s.categories) && s.categories.indexOf(categoryId) !== -1);
  };

  /* ------------------------------------------------------------------ *
   * Key checker — "does this LOOK like the right key, in the right box?"
   * Runs entirely offline. It never stores or sends the value.
   *
   *   VC.data.checkKey(key, value) -> { level, ok, message }
   *     key   = a service's keys[] entry
   *     level = 'empty' | 'ok' | 'warn' | 'bad' | 'danger'
   *             danger = a SECRET key pasted where a public one goes (or similar)
   *
   *   VC.data.identifyKey(value) -> { service, key } | null
   *     Best guess at which catalog key a pasted value is (by format).
   * ------------------------------------------------------------------ */
  function compile(src) {
    try { return new RegExp(src); } catch (e) { return null; }
  }

  /** Read the "role" claim from a Supabase legacy JWT key without verifying it. */
  function jwtRole(value) {
    const parts = String(value).split('.');
    if (parts.length !== 3) return null;
    try {
      let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const payload = JSON.parse(atob(b64));
      return payload && typeof payload.role === 'string' ? payload.role : null;
    } catch (e) {
      return null;
    }
  }

  VC.data.identifyKey = function (value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    const services = VC.data.services || [];
    for (let i = 0; i < services.length; i++) {
      const keys = services[i].keys || [];
      for (let j = 0; j < keys.length; j++) {
        const k = keys[j];
        // Only keys with a telltale pattern (format.identify, e.g. '^sk-ant-') count;
        // a plain number or random string could be anything.
        const re = k.format && k.format.identify ? compile(k.format.identify) : null;
        if (re && re.test(v)) return { service: services[i], key: k };
      }
    }
    return null;
  };

  VC.data.checkKey = function (key, value) {
    const v = String(value == null ? '' : value).trim();
    const fmt = (key && key.format) || {};
    const label = (key && key.label) || 'key';
    if (!v) return { level: 'empty', ok: false, message: '' };

    // 1. Explicit "wrong box" rules written in the catalog (e.g. sk_ in a pk_ field).
    const warns = fmt.warnIf || [];
    for (let i = 0; i < warns.length; i++) {
      const re = compile(warns[i].regex);
      if (re && re.test(v)) return { level: warns[i].level || 'danger', ok: false, message: warns[i].message };
    }

    // 2. Copy-paste slips.
    if (/^["'`]|["'`]$/.test(v)) return { level: 'bad', ok: false, message: 'Remove the quote marks around the key.' };
    if (/^[A-Z][A-Z0-9_]{2,}\s*=\s*\S/.test(v)) return { level: 'bad', ok: false, message: 'Paste only the value — the part after the = sign.' };
    if (/\s/.test(v) && !fmt.allowSpaces) return { level: 'bad', ok: false, message: 'Remove the spaces or line breaks. Keys never contain them.' };
    if (/[•*]{4,}|\.{3,}|…/.test(v)) return { level: 'bad', ok: false, message: 'That looks like a hidden or shortened key. Click "Reveal" or "Copy" in the dashboard to get the full value.' };

    // 3. Supabase legacy keys are JWTs; the role inside tells anon and service_role apart.
    if (fmt.jwtRole && /^eyJ/.test(v)) {
      const role = jwtRole(v);
      if (role && role !== fmt.jwtRole) {
        if (role === 'service_role') {
          return { level: 'danger', ok: false, message: 'Stop — this is your service_role (secret) key. It skips every security rule. Paste the public anon or publishable key here instead.' };
        }
        return { level: 'bad', ok: false, message: 'This is the public "' + role + '" key. This box needs the secret service_role key.' };
      }
    }

    // 4. Format check.
    const own = compile(fmt.regex);
    const matchesOwn = own ? own.test(v) : true;

    // 5. A known key from a different service? Catch secrets pasted into public boxes.
    if (!matchesOwn) {
      const guess = VC.data.identifyKey(v);
      if (guess && guess.key !== key) {
        const what = guess.service.name + ' ' + guess.key.label;
        if (guess.key.visibility === 'secret' && key && key.visibility === 'public') {
          return { level: 'danger', ok: false, message: 'Careful — this looks like your ' + what + ', which is secret. Never put it in a public setting.' };
        }
        return { level: 'bad', ok: false, message: 'This looks like a ' + what + ', not a ' + label + '.' };
      }
      return { level: 'bad', ok: false, message: 'This doesn\'t look like a ' + label + '.' + (fmt.hint ? ' ' + fmt.hint + '.' : '') };
    }

    return { level: 'ok', ok: true, message: 'Looks right.' };
  };
})();
