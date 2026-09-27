/* Vibe Check — Launch (#/ship): a launch checklist tailored to the kit's builder and services.
   Ticks persist in project.ship.checked; each item has plain "How?" steps for this exact stack. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const has = (list, v) => arr(list).indexOf(v) !== -1;
  const listJoin = (a) => (a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

  /* ------------------------------------------------------------------ *
   * Builder-specific know-how (used when the catalog doesn't say)
   * ------------------------------------------------------------------ */
  const DOWNLOAD = {
    lovable: 'In Lovable, connect GitHub (the GitHub button, top right), then on GitHub click Code → Download ZIP.',
    bolt: 'In Bolt, use the download / export button to save your project as a .zip.',
    replit: 'In Replit, open the Files panel menu (⋮) and choose "Download as zip".',
    v0: 'In v0, open the project menu and download the code as a .zip.',
    cursor: 'Your code is already a folder on your computer, so you can drag that folder straight in.',
    'claude-code': 'Your code is already a folder on your computer, so you can drag that folder straight in.',
  };
  const PUBLISH = {
    lovable: ['Click Publish (top right) in Lovable.', 'Keep the free lovable.app address for now. You can add your own domain later.', 'Open the live link in a private browser window and click through it.'],
    bolt: ['Click Publish (top right) in Bolt.', 'Wait for it to finish, then copy the live link.', 'Open it in a private browser window and click through it.'],
    replit: ['Click Deploy (top right) in Replit.', 'Pick "Autoscale" for most apps, or "Static" for a simple site with no server.', 'Check your Secrets are listed in the deployment settings, then deploy.', 'Open the replit.app link in a private browser window and click through it.'],
    v0: ['Click Publish in v0. It deploys to Vercel using the same account.', 'In Vercel → your project → Settings → Environment Variables, check every key from your kit is there.', 'Open the vercel.app link in a private browser window and click through it.'],
  };
  const SECRET_PLACE = {
    lovable: ['When Lovable asks for a secret key, use its secure form, never the chat. It stores the key as a Supabase Edge Function secret.'],
    bolt: ['Put secret keys in Bolt\'s environment / secrets settings, never in the chat or a code file.'],
    replit: ['Put secret keys in Replit\'s Secrets tool (the lock icon), never in a code file.'],
    v0: ['Put secret keys in the project\'s Environment Variables (in Vercel settings), never in the chat.'],
    cursor: ['Put secret keys in your .env.local file, and make sure .gitignore lists it.'],
    'claude-code': ['Put secret keys in your .env.local file, and make sure .gitignore lists it.'],
  };
  const HOST_VARS = {
    vercel: ['Vercel → your project → Settings → Environment Variables.', 'Add each name and value below (tick "Production"), then redeploy so the change takes effect.'],
    netlify: ['Netlify → your site → Site configuration → Environment variables.', 'Add each name and value below, then trigger a new deploy so the change takes effect.'],
  };
  const LIVE_KEYS = {
    stripe: 'Stripe: finish activating your account, switch off "Test mode", and swap the pk_test_ / sk_test_ keys for the pk_live_ / sk_live_ ones.',
    lemonsqueezy: 'Lemon Squeezy: activate your store, switch off "Test mode", and create live API keys.',
    clerk: 'Clerk: create a Production instance (it needs your own domain) and use its pk_live_ / sk_live_ keys.',
    supabase: 'Supabase: if you made a separate test project, make sure the live site uses the real project\'s URL and keys.',
    firebase: 'Firebase: make sure the live site uses your real project, not a test one.',
    twilio: 'Twilio: upgrade from the trial account, or texts only go to numbers you\'ve verified.',
    resend: 'Resend: verify your own domain, or emails can only go to your own address.',
  };
  const AUTH_URLS = {
    supabase: ['Supabase → Authentication → URL Configuration.', 'Set "Site URL" to your live address (for example https://yourapp.com).', 'Add the same address under "Redirect URLs", then save.', 'Sign up with a new email and check the confirmation link opens your live site, not localhost.'],
    clerk: ['Clerk dashboard → Domains (in your Production instance).', 'Add your live domain and follow the DNS steps it shows.', 'Check sign-in and sign-up work on the live site.'],
    firebase: ['Firebase console → Authentication → Settings → Authorized domains.', 'Add your live domain (and your custom domain if you have one).', 'Check sign-in works on the live site.'],
  };
  const AI_LIMITS = {
    anthropic: 'Anthropic Console → Settings → Limits: set a monthly spend limit you\'re comfortable with.',
    openai: 'OpenAI Platform → Settings → Limits: set a monthly budget and an email alert.',
    replicate: 'Replicate → Account → Billing: set a monthly spend limit.',
    elevenlabs: 'ElevenLabs → Subscription: check whether usage-based billing is on, and turn it off if you want a hard cap.',
  };
  const BACKUPS = {
    supabase: ['Open Supabase → Database → Backups to see what your plan includes.', 'On the free plan, export your important tables now and then (Table Editor → Export → CSV).', 'Once you have paying users, the Pro plan adds daily backups.'],
    firebase: ['Firestore\'s scheduled backups need the paid Blaze plan.', 'Until then, export important data now and then from the Firebase console.', 'Once you have real users, turn on scheduled backups.'],
  };

  /* ------------------------------------------------------------------ *
   * Checklist: groups of items built from the kit
   * item = { id, title, why?, how: [string], optional?, extra?: 'scan'|'env'|'secrets'|'links' }
   * ------------------------------------------------------------------ */
  function kitInfo(project) {
    const kit = project && project.kit;
    if (!kit || !Array.isArray(kit.services)) return null;
    const K = VC.engine && VC.engine.kit;
    const svcById = (id) => (K && K.service ? K.service(id) : (VC.data.serviceById ? VC.data.serviceById(id) : null));
    let services = [];
    try { services = K ? K.uniqueServices(kit) : []; } catch (e) { services = []; }
    if (!services.length) services = arr(kit.services).map((s) => s && svcById(s.serviceId)).filter(Boolean);
    let builder = null;
    try { builder = K ? K.builder(kit) : null; } catch (e) { builder = null; }
    if (!builder && VC.data.builderById) builder = VC.data.builderById(kit.builder && kit.builder.id);
    builder = builder || { id: (kit.builder && kit.builder.id) || '', name: 'your builder', secrets: {} };
    const byCat = (cat) => { const e = arr(kit.services).find((s) => s && s.category === cat); return e ? e.serviceId : null; };
    const envName = (key) => {
      try { if (K && K.envName) return K.envName(key, kit.framework); } catch (e) { /* fall through */ }
      const env = key.env || {};
      return env[kit.framework] || env.node || env.vite || env.next || String(key.id || '').toUpperCase();
    };
    const hosting = kit.hosting || {};
    const hostId = byCat('hosting');
    return {
      kit, K, builder, services, ids: services.map((s) => s.id), byCat, svcById, envName,
      hostId,
      hostName: hostId ? (svcById(hostId) || {}).name || hostId : '',
      builtInHost: !!hosting.builtIn,
      mobile: kit.framework === 'expo' || !!hosting.appStores,
      needs: arr(kit.needs).length ? kit.needs : arr(kit.services).map((s) => s.category),
      payType: kit.paymentType || (project.answers && project.answers.payments) || 'one-time',
      budget: (project.answers && project.answers.budget) || 'free',
    };
  }

  function buildChecklist(project) {
    const info = kitInfo(project);
    if (!info) return [];
    const { builder, ids, byCat, svcById, needs } = info;
    const B = builder.name;
    const secrets = builder.secrets || {};
    const dbId = byCat('database');
    const authId = byCat('auth');
    const payId = byCat('payments');
    const hasAuth = has(needs, 'auth');
    const hasDb = has(needs, 'database');
    const aiIds = ids.filter((id) => has(['anthropic', 'openai', 'replicate', 'elevenlabs'], id));
    const nameOf = (id) => (svcById(id) || {}).name || id;
    const groups = [];

    // --- Safety check
    const safety = [{
      id: 'scan', extra: 'scan',
      title: 'Run the safety scan and fix anything serious',
      why: 'It finds leaked keys and open databases, the two things that sink most AI-built apps.',
      how: [
        DOWNLOAD[builder.id] || 'Download your project as a folder or .zip.',
        'Open Safety Scan and drop the folder or .zip in. Nothing is uploaded: it runs in your browser.',
        `Fix critical and high issues first. Each one has a "Copy fix prompt" button to paste into ${B}.`,
        'Scan again until you get an A or B.',
      ],
    }];
    if (dbId === 'supabase') {
      safety.push({
        id: 'db-lock', title: 'Every database table is locked (Row Level Security on)',
        why: 'Without it, anyone can read or wipe your whole database with the public key.',
        how: [
          'Open Supabase → Table Editor.',
          'Look at each table: none should be labelled "Unrestricted".',
          `If one is, ask ${B}: "Turn on Row Level Security for the <table name> table and add policies so people can only read and change their own rows."`,
          'Run the safety scan again to confirm.',
        ],
      });
    } else if (dbId === 'firebase') {
      safety.push({
        id: 'db-lock', title: 'Firebase security rules are locked down',
        why: 'Test-mode rules let anyone read or wipe your data.',
        how: [
          'Open the Firebase console → Firestore Database → Rules (and Storage → Rules if you use it).',
          'Make sure nothing says "allow read, write: if true".',
          `If it does, ask ${B}: "Write Firebase security rules so signed-in users can only read and write their own documents."`,
          'Click Publish on the rules.',
        ],
      });
    }
    groups.push({ id: 'safety', title: 'Safety check', icon: 'shield', lead: 'Check these before anyone signs up.', items: safety });

    // --- Keys & settings
    const hostSteps = arr(secrets.deployVars).length
      ? arr(secrets.deployVars).concat(['Add each setting listed below, then publish again so the change takes effect.'])
      : (HOST_VARS[info.hostId] || ['Open your hosting settings and find "Environment variables".', 'Add each setting listed below, then publish again.']);
    const keys = [
      {
        id: 'secret-server', extra: 'secrets',
        title: 'Secret keys only live on the server',
        why: 'Anything in your app\'s browser code can be read by every visitor.',
        how: (arr(secrets.secretKeys).length ? arr(secrets.secretKeys) : (SECRET_PLACE[builder.id] || ['Keep secret keys in your builder\'s secrets settings, never in code.']))
          .concat([`Ask ${B}: "List every place a secret key is used. Is any of it code that runs in the browser?"`, 'The safety scan also flags secret keys in browser code.']),
      },
      {
        id: 'env-host', extra: 'env',
        title: 'Your live site has all its settings',
        why: 'The live version needs its own copy of every key. A missing one is the #1 reason apps break right after launch.',
        how: hostSteps,
      },
    ];
    if (secrets.envFile) {
      const file = secrets.envFileName || '.env';
      keys.push({
        id: 'env-gitignore', title: `Your ${file} file is never uploaded to GitHub`,
        why: 'Bots scan GitHub for keys within minutes of them appearing.',
        how: [
          'Open the .gitignore file in your project.',
          `Make sure it has a line that covers ${file} (for example .env*).`,
          'On GitHub, open your repository: you should NOT see any .env file.',
          'If you do, delete it and replace every key that was in it. Once a key has been on GitHub, treat it as leaked.',
        ],
      });
    }
    const liveLines = ids.map((id) => LIVE_KEYS[id]).filter(Boolean);
    keys.push({
      id: 'live-keys', title: 'You\'re using live keys, not test keys',
      why: 'Test keys make everything look like it works, but no real payments, emails or texts go through.',
      how: liveLines.length ? liveLines.concat(['Paste new keys into your live site\'s settings, never into chat.']) : ['Check each service\'s dashboard for a "test" or "sandbox" mode and make sure the live site uses the real keys.'],
    });
    if (authId && AUTH_URLS[authId]) {
      keys.push({
        id: 'auth-urls', title: 'Login links point to your live address',
        why: 'Otherwise confirmation and reset emails send people to a broken "localhost" page.',
        how: AUTH_URLS[authId],
      });
    }
    groups.push({ id: 'keys', title: 'Keys & settings', icon: 'key', lead: 'Your live site needs its own settings, and secret keys must never reach the browser.', items: keys });

    // --- Payments
    if (payId === 'stripe' || payId === 'lemonsqueezy') {
      const stripe = payId === 'stripe';
      const P = nameOf(payId);
      const pay = [
        {
          id: 'pay-test', title: 'A full test payment works',
          why: 'Catch problems with fake money before real customers find them.',
          how: [
            `Make sure ${P} is in Test mode.`,
            'Pay with the test card 4242 4242 4242 4242, any future date and any 3-digit code.',
            'Check that what they paid for actually unlocks, and the payment shows in your dashboard.',
            'Try the declined card 4000 0000 0000 0002: you should see a friendly error and nothing unlocks.',
          ],
        },
        {
          id: 'pay-webhook', title: 'The payment webhook is set up for your live site',
          why: `This is how ${P} tells your app "they paid". Without it, people pay and get nothing.`,
          how: stripe ? [
            'Stripe → Developers → Webhooks → Add endpoint.',
            `For the URL, use your live site's webhook address. Ask ${B}: "What's my Stripe webhook URL?"`,
            info.payType === 'subscription'
              ? 'Pick the events checkout.session.completed, customer.subscription.updated and customer.subscription.deleted.'
              : 'Pick the event checkout.session.completed.',
            'Copy the signing secret (starts with whsec_) into your live settings as STRIPE_WEBHOOK_SECRET.',
            `Ask ${B} to confirm the webhook checks that signature before unlocking anything.`,
          ] : [
            'Lemon Squeezy → Settings → Webhooks → add a webhook.',
            `For the URL, use your live site's webhook address. Ask ${B}: "What's my Lemon Squeezy webhook URL?"`,
            'Pick the order and subscription events your app uses, and set a signing secret.',
            'Put the same signing secret in your live settings.',
            `Ask ${B} to confirm the webhook checks that signature before unlocking anything.`,
          ],
        },
      ];
      if (stripe && info.payType === 'marketplace') {
        pay.push({
          id: 'pay-connect', title: 'Sellers can connect and get paid',
          why: 'Marketplace payouts use Stripe Connect, which needs its own setup.',
          how: [
            'In Stripe, turn on Connect and finish the platform profile.',
            'Create a test seller account in your app and connect it.',
            'Make a test sale: the seller\'s share should show in their balance, and your fee in yours.',
          ],
        });
      }
      pay.push({
        id: 'pay-live', title: 'Payments are switched to live mode',
        why: 'The last step before real money moves.',
        how: stripe ? [
          'Finish activating your Stripe account (business details and bank account).',
          'Switch off "Test mode" and copy the live keys (pk_live_ and sk_live_).',
          'Replace the test keys in your live site\'s settings, and add a live webhook the same way as the test one.',
          'Make one small real purchase, then refund it from the Stripe dashboard.',
        ] : [
          'Activate your store in Lemon Squeezy (they\'ll check your identity).',
          'Switch off "Test mode", then create a live API key and webhook.',
          'Replace the test values in your live site\'s settings.',
          'Make one small real purchase, then refund it.',
        ],
      });
      groups.push({ id: 'payments', title: 'Payments', icon: 'coin', lead: 'Test every money path with fake cards first, then switch to real ones.', items: pay });
    }

    // --- Test it like a user
    const test = [];
    if (hasAuth) {
      test.push({
        id: 'test-signup', title: 'Sign up as a brand-new user',
        how: [
          'Open your live site in a private (incognito) window.',
          'Sign up with an email address you haven\'t used before.',
          'Check the confirmation email arrives (look in spam too) and its link works.',
          'Log out, log back in, and try "Forgot password".',
        ],
      });
    } else {
      test.push({
        id: 'test-visit', title: 'Use every page as a first-time visitor',
        how: ['Open your live site in a private (incognito) window.', 'Click every button and link.', 'Nothing should lead to a blank page or an error.'],
      });
    }
    if (hasAuth && hasDb) {
      test.push({
        id: 'test-privacy', title: 'A second account can\'t see the first one\'s private stuff',
        why: 'This is exactly how most data leaks in AI-built apps are found.',
        how: [
          'Create two test accounts (use two private windows, or two different browsers).',
          'Add something private with the first account.',
          'Log in as the second account: you should not be able to see or change it.',
          `If you can, stop and ask ${B} to fix the database rules before anyone signs up.`,
        ],
      });
    }
    test.push({
      id: 'test-phone', title: 'It works on a phone',
      how: ['Open the live link on your phone.', 'Do the main thing people will come for, start to finish.', 'Check the text is readable and buttons are easy to tap.'],
    });
    test.push({
      id: 'test-break', title: 'Try to break it',
      how: [
        'Submit forms empty, with very long text, and with emoji.',
        'Double-click buttons that save or pay.',
        'Refresh the page halfway through doing something.',
        'You should see friendly messages, never a blank page or a wall of error text.',
      ],
    });
    if (has(needs, 'storage')) {
      test.push({
        id: 'test-uploads', title: 'Uploads cope with big and wrong files',
        how: ['Upload a normal photo: it should appear.', 'Try a very large file and a non-image file: you should get a clear message.', hasAuth ? 'Log in as another account: private files shouldn\'t be visible.' : 'Check uploads can\'t be deleted by strangers.'],
      });
    }
    if (has(needs, 'email')) {
      test.push({
        id: 'test-email', title: 'Emails arrive, and don\'t land in spam',
        how: [
          byCat('email') === 'resend' ? 'In Resend, verify your own domain (add the DNS records it shows you). Until you do, emails can only go to your own address.' : 'Verify your sending domain with your email service.',
          'Trigger each email your app sends and check it arrives.',
          'Check it isn\'t in spam, and the links inside work.',
        ],
      });
    }
    if (has(needs, 'ai')) {
      test.push({
        id: 'test-ai', title: 'The AI feature copes with heavy use',
        how: [
          'Use the AI feature normally: you should see a loading message, then a useful answer.',
          'Click it many times quickly: you should get a polite "slow down" message.',
          hasAuth ? 'Log out and try it: it should ask you to log in first.' : 'Check it can\'t be used from outside your app\'s pages.',
        ],
      });
    }
    test.push({
      id: 'test-friend', title: 'Watch one person use it without helping',
      how: ['Ask a friend to try the main task while you watch.', 'Don\'t explain anything. Note where they hesitate or get stuck.', `Fix the biggest confusion with one small prompt in ${B}.`],
    });
    groups.push({ id: 'test', title: 'Test it like a user', icon: 'user', lead: 'Ten minutes of trying to break it yourself saves an embarrassing launch.', items: test });

    // --- Go live
    const live = [];
    const publishSteps = info.builtInHost && PUBLISH[builder.id]
      ? PUBLISH[builder.id]
      : builder.id === 'v0' && info.hostId === 'vercel'
        ? PUBLISH.v0
        : info.hostId === 'netlify'
          ? ['Make sure your latest work is saved to GitHub.', 'In Netlify, click Add new site → Import an existing project, and pick your repository.', 'Add every key under Site configuration → Environment variables.', 'Deploy, then open the netlify.app link in a private browser window.']
          : ['Make sure your latest work is saved to GitHub.', 'In Vercel, click Add New → Project and import your GitHub repository.', 'Before the first deploy, add every key under Environment Variables.', 'Click Deploy, then open the vercel.app link in a private browser window.'];
    live.push({
      id: 'publish',
      title: info.builtInHost ? `Publish from ${B}` : `Publish on ${info.hostName || 'your host'}`,
      how: publishSteps,
    });
    if (info.mobile) {
      live.push({
        id: 'app-stores', title: 'Send the phone app to the app stores',
        why: 'Optional if a web link is enough for now.',
        how: [
          'Create an Apple Developer account ($99/year) and/or a Google Play developer account ($25 once).',
          `Ask ${B}: "Set up Expo EAS to build my app for iPhone and Android, and walk me through submitting it."`,
          'Fill in the store listing: name, icon, screenshots, description and a privacy policy link.',
          'Submit for review. Apple usually takes a day or two; Google can take longer for new accounts.',
        ],
      });
    }
    if (hasAuth || payId || has(needs, 'analytics')) {
      const dataNames = info.services.filter((s) => s.id !== 'github' && s.id !== 'vercel' && s.id !== 'netlify').map((s) => s.name);
      live.push({
        id: 'legal', title: payId ? 'Add a privacy policy and terms' : 'Add a privacy policy',
        why: 'Required once you collect emails or take payments, and app stores ask for it.',
        how: [
          'Use a free privacy policy generator and answer its questions honestly.',
          `Ask ${B}: "Add a /privacy page${payId ? ' and a /terms page' : ''} with this text, linked in the footer."`,
          dataNames.length ? `Mention the services that handle people's data: ${listJoin(dataNames)}.` : 'Mention any outside services that handle people\'s data.',
        ],
      });
    }
    live.push({
      id: 'domain', title: 'Add a custom domain, or decide to skip it for now',
      why: 'Optional. The free address works fine for launch. Tick this once you\'ve decided.',
      how: [
        'Buy a domain (like yourapp.com) from a registrar such as Cloudflare, Namecheap or Porkbun. It\'s usually $10–15 a year.',
        info.builtInHost ? `In ${B}'s project settings, open Domains and add it.` : `In ${info.hostName || 'your host'}, open Domains and add it.`,
        'Copy the DNS records it shows you into your registrar\'s DNS settings.',
        hasAuth ? 'Update your login redirect settings to the new domain (see "Login links" above).' : 'Update any links that point to the old address.',
        'Give it up to an hour, then check the site loads with https.',
      ],
    });
    groups.push({ id: 'golive', title: 'Go live', icon: 'rocket', lead: 'Put it online and make it official.', items: live });

    // --- After launch
    const after = [];
    after.push({
      id: 'backups', title: hasDb ? 'Your data is backed up' : 'Your code is backed up',
      how: (hasDb && BACKUPS[dbId]) ? BACKUPS[dbId] : [
        builder.versionControl ? `${builder.versionControl}.` : 'Save your code to GitHub.',
        'Make sure you know how to go back to an earlier version if a change breaks something.',
      ],
    });
    after.push({
      id: 'monitoring', title: 'You\'ll hear about errors before your users tell you',
      how: has(info.ids, 'sentry')
        ? ['Trigger a test error in the live app (ask your builder how).', 'Check it shows up in Sentry → Issues.', 'Turn on email alerts for new issues.']
        : ['Add Sentry\'s free plan.', `Ask ${B}: "Add Sentry error monitoring. Put the DSN in an environment variable."`, 'Trigger a test error and check it shows up in Sentry.'],
    });
    after.push({
      id: 'usage', extra: 'links', title: 'You know where to watch usage and costs',
      how: ['Bookmark the usage or billing page for each service (links below).', 'Check them once a week for the first month.', 'Set up billing alerts wherever the service offers them.'],
    });
    if (aiIds.length) {
      after.push({
        id: 'ai-limits', title: `Spending limits are set on ${listJoin(aiIds.map(nameOf))}`,
        why: 'An AI feature without a cap is the fastest way to a surprise bill.',
        how: aiIds.map((id) => AI_LIMITS[id]).filter(Boolean).concat(['Pick a number you\'d be fine paying if something went wrong.']),
      });
    }
    if (has(info.ids, 'supabase') && info.budget === 'free') {
      after.push({
        id: 'supabase-pause', title: 'You know free Supabase projects pause when idle',
        how: ['Free Supabase projects pause after about a week with no activity, and your app stops working until you restore it in the dashboard.', 'Once people use the app every day, this won\'t happen. Until then, open it now and then, or upgrade when you launch properly.'],
      });
    }
    after.push({
      id: 'leak-plan', title: 'You know what to do if a key leaks',
      how: [
        'Open that service\'s dashboard and roll (regenerate) the key. The old one stops working.',
        'Paste the new key into your live site\'s settings and your builder, then publish again.',
        'Check the service\'s usage page for anything you don\'t recognise.',
        'Run the safety scan to find how it leaked, and fix that too.',
      ],
    });
    groups.push({ id: 'after', title: 'After launch', icon: 'life', lead: 'Launching is the start. These keep small problems small.', items: after });

    return groups;
  }

  const allItems = (groups) => groups.reduce((acc, g) => acc.concat(g.items), []);
  const checkedMap = (p) => (p && p.ship && p.ship.checked) || {};

  /* ------------------------------------------------------------------ *
   * Rendering
   * ------------------------------------------------------------------ */
  function scanExtra(project) {
    const s = arr(project.scans)[0];
    if (!s) {
      return html`<div class="row sm" style="margin-top:8px">${VC.ui.badge('Not scanned yet', 'gray')}<a class="btn sm" href="#/scan">${VC.icon('shield', 14)} Open Safety Scan</a></div>`;
    }
    const good = s.grade === 'A' || s.grade === 'B';
    const color = good ? 'green' : s.grade === 'C' ? 'yellow' : 'red';
    const serious = ((s.counts && s.counts.critical) || 0) + ((s.counts && s.counts.high) || 0);
    return html`<div class="row sm" style="margin-top:8px">
      <span class="badge ${color}">Latest scan: ${s.grade}${typeof s.score === 'number' ? ` (${s.score}/100)` : ''}</span>
      ${s.createdAt ? html`<span class="tiny muted">${VC.formatDate(s.createdAt)}</span>` : ''}
      ${!good && serious ? html`<span class="tiny muted">${serious} serious ${serious === 1 ? 'issue' : 'issues'} to fix</span>` : ''}
      <a class="btn sm" href="#/scan">${good ? 'Scan again' : 'Fix & rescan'}</a>
    </div>`;
  }

  function envExtra(info, onlySecret) {
    const rows = [];
    info.services.forEach((s) => arr(s.keys).forEach((k) => {
      if (onlySecret && k.visibility !== 'secret') return;
      const name = info.envName(k);
      if (name && !rows.some((r) => r.name === name)) rows.push({ name, secret: k.visibility === 'secret', service: s.name });
    }));
    if (!rows.length) return '';
    return html`<div class="row sm" style="margin-top:8px;gap:6px">
      ${rows.map((r) => html`<code class="row sm" style="gap:5px;display:inline-flex;align-items:center" title="${r.service}: ${r.secret ? 'secret, server only' : 'public'}"><span class="dot ${r.secret ? 'red' : 'green'}"></span>${r.name}</code>`)}
    </div>`;
  }

  function linksExtra(info) {
    const list = info.services.filter((s) => s.dashboardUrl && /^https?:\/\//i.test(s.dashboardUrl));
    if (!list.length) return '';
    return html`<div class="row sm" style="margin-top:8px">
      ${list.map((s) => html`<a class="btn sm" href="${s.dashboardUrl}" target="_blank" rel="noopener noreferrer">${s.name} ${VC.icon('external', 12)}</a>`)}
    </div>`;
  }

  function itemView(item, done, project, info) {
    let extra = '';
    if (item.extra === 'scan') extra = scanExtra(project);
    else if (item.extra === 'env') extra = envExtra(info, false);
    else if (item.extra === 'secrets') extra = envExtra(info, true);
    else if (item.extra === 'links') extra = linksExtra(info);
    return html`<li id="ship-item-${item.id}">
      <div class="check ${done ? 'is-done' : ''}" data-item="${item.id}" style="cursor:default">
        <input type="checkbox" id="ship-${item.id}" data-check="${item.id}" ${done ? 'checked' : ''}>
        <div class="grow" style="min-width:0">
          <label for="ship-${item.id}" class="check-title bold" style="cursor:pointer;display:block">${item.title}</label>
          ${item.why ? html`<div class="small text-2">${item.why}</div>` : ''}
          ${extra}
          ${arr(item.how).length ? html`<details style="margin-top:6px">
            <summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600;width:max-content">How?</summary>
            <ol class="small text-2" style="margin:8px 0 2px;padding-left:1.25em">${item.how.filter(Boolean).map((s) => html`<li>${s}</li>`)}</ol>
          </details>` : ''}
        </div>
      </div>
    </li>`;
  }

  function progressCard(total, doneCount, next) {
    const pct = total ? (doneCount / total) * 100 : 0;
    return html`<section class="card pad-lg stack" id="ship-progress">
      <div class="spread" style="align-items:flex-end">
        <div class="stat">
          <span class="stat-value"><span data-done-count>${doneCount}</span> <span class="muted" style="font-weight:600;font-size:1.1rem">of ${total}</span></span>
          <span class="stat-label">launch steps done</span>
        </div>
        <div class="small text-2" data-next style="text-align:right;max-width:100%">${next ? html`Up next: <button class="btn ghost sm" data-action="jump" data-target="${next.id}" style="white-space:normal;text-align:left">${next.title} ${VC.icon('arrow', 14)}</button>` : ''}</div>
      </div>
      ${VC.ui.meter(pct, doneCount === total ? 'green' : '')}
    </section>`;
  }

  function celebration(project, name) {
    return html`<section class="card pad-lg center stack" style="border-color:var(--green);box-shadow:0 0 0 3px var(--green-soft), var(--shadow);align-items:center">
      <span style="width:68px;height:68px;border-radius:20px;background:var(--green-soft);color:var(--green);display:grid;place-items:center">${VC.icon('rocket', 34)}</span>
      <h2 class="mb-0" style="font-size:1.6rem">${name} is ready for the world</h2>
      <p class="text-2 mb-0" style="max-width:52ch">Every launch step is done: keys are safe, the database is locked, and you've tested it like a real user. That puts you ahead of most apps out there.</p>
      <div class="row" style="justify-content:center">
        <a class="btn primary" href="#/scan">${VC.icon('shield', 16)} Scan after big changes</a>
        <a class="btn" href="#/prompts">${VC.icon('prompt', 16)} Keep building</a>
      </div>
    </section>`;
  }

  VC.registerView({
    id: 'ship',
    title: 'Launch',
    navTitle: 'Launch',
    icon: 'rocket',
    nav: { group: 'journey', order: 6 },
    status(project) {
      if (!project || !project.kit) return 'todo';
      const items = allItems(buildChecklist(project));
      const checked = checkedMap(project);
      return items.length && items.every((i) => checked[i.id]) ? 'done' : 'todo';
    },

    render(el, ctx) {
      const p = ctx.project;
      const info = kitInfo(p);
      if (!p || !info) {
        const hasDirection = !!(p && p.chosenDirection);
        VC.mount(el, html`
          ${VC.ui.pageHead({ eyebrow: 'Step 6 · Launch', title: 'Launch checklist', lead: 'A checklist made for your exact tools, so nothing gets missed on launch day.' })}
          ${VC.ui.empty({
            icon: 'rocket',
            title: 'Build your kit first',
            body: 'The launch checklist is tailored to the builder and services in your build kit: which keys to switch, where settings go, and what to test.',
            actionLabel: hasDirection ? 'Open your build kit' : 'Start with your idea',
            actionHref: hasDirection ? '#/kit' : '#/idea',
          })}`);
        return;
      }

      const groups = buildChecklist(p);
      const items = allItems(groups);
      const checked = checkedMap(p);
      const doneCount = items.filter((i) => checked[i.id]).length;
      const allDone = items.length > 0 && doneCount === items.length;
      const next = items.find((i) => !checked[i.id]);
      const name = (p.chosenDirection && p.chosenDirection.name) || p.name || 'Your app';
      const stack = [info.builder.name].concat(info.services.filter((s) => s.id !== 'github').map((s) => s.name)).slice(0, 4);

      VC.mount(el, html`
        ${VC.ui.pageHead({
          eyebrow: 'Step 6 · Launch',
          title: 'Launch ' + name,
          lead: html`A checklist made for ${listJoin(stack)}. Tick things off as you go, and open <strong>How?</strong> for the exact steps.`,
          actions: doneCount ? html`<button class="btn ghost sm" data-action="reset">${VC.icon('refresh', 14)} Start over</button>` : '',
        })}
        ${allDone ? celebration(p, name) : progressCard(items.length, doneCount, next)}
        ${groups.map((g) => {
          const gDone = g.items.filter((i) => checked[i.id]).length;
          return html`<section class="section" id="grp-${g.id}" aria-labelledby="grp-h-${g.id}">
            <div class="section-head">
              <div>
                <h2 id="grp-h-${g.id}" class="row sm">${VC.icon(g.icon, 20)} ${g.title}</h2>
                <p class="small text-2 mb-0">${g.lead}</p>
              </div>
              <span class="badge ${gDone === g.items.length ? 'green' : 'gray'}" data-group-count="${g.id}">${gDone} / ${g.items.length}</span>
            </div>
            <ul class="checklist">${g.items.map((it) => itemView(it, !!checked[it.id], p, info))}</ul>
          </section>`;
        })}
        ${allDone ? '' : html`<p class="small muted center">Ticks are saved in this browser as you go.</p>`}
      `);

      /* ---------- Events ---------- */
      // Keep the page in sync without a full re-render (so open "How?" panels stay open).
      function refresh() {
        const now = checkedMap(VC.store.active());
        const count = items.filter((i) => now[i.id]).length;
        if ((count === items.length) !== allDone) { ctx.rerender(); return; }
        const c = el.querySelector('[data-done-count]');
        if (c) c.textContent = String(count);
        const bar = el.querySelector('#ship-progress .meter');
        if (bar) {
          const pct = Math.round((count / items.length) * 100);
          bar.setAttribute('aria-valuenow', String(pct));
          const fill = bar.querySelector('span');
          if (fill) fill.style.width = pct + '%';
        }
        groups.forEach((g) => {
          const n = g.items.filter((i) => now[i.id]).length;
          const badge = el.querySelector(`[data-group-count="${g.id}"]`);
          if (badge) { badge.textContent = `${n} / ${g.items.length}`; badge.className = 'badge ' + (n === g.items.length ? 'green' : 'gray'); }
        });
        const nextItem = items.find((i) => !now[i.id]);
        const nextBox = el.querySelector('[data-next]');
        if (nextBox) {
          VC.mount(nextBox, nextItem
            ? html`Up next: <button class="btn ghost sm" data-action="jump" data-target="${nextItem.id}" style="white-space:normal;text-align:left">${nextItem.title} ${VC.icon('arrow', 14)}</button>`
            : html``);
        }
      }

      VC.delegate(el, 'change', 'input[data-check]', (e, input) => {
        const id = input.getAttribute('data-check');
        const on = input.checked;
        VC.store.update((q) => {
          q.ship = q.ship && typeof q.ship === 'object' ? q.ship : { checked: {} };
          q.ship.checked = q.ship.checked || {};
          if (on) q.ship.checked[id] = true;
          else delete q.ship.checked[id];
        });
        const box = input.closest('.check');
        if (box) box.classList.toggle('is-done', on);
        refresh();
      });

      // Clicking anywhere on an item's empty space toggles it (links, "How?" and the label keep their own behaviour).
      VC.delegate(el, 'click', '[data-item]', (e, box) => {
        if (e.target.closest('input, label, a, button, details, summary, select, code')) return;
        const input = box.querySelector('input[data-check]');
        if (input) input.click();
      });

      VC.delegate(el, 'click', '[data-action]', async (e, b) => {
        const act = b.getAttribute('data-action');
        if (act === 'jump') {
          const target = el.querySelector('#ship-item-' + b.getAttribute('data-target'));
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            const d = target.querySelector('details');
            if (d) d.open = true;
          }
        } else if (act === 'reset') {
          const ok = await VC.ui.confirm('Start the checklist over?', 'This unticks every launch step for this project.', 'Start over');
          if (!ok) return;
          VC.store.update((q) => { q.ship = { checked: {} }; });
          ctx.rerender();
        }
      });
    },
  });
})();
