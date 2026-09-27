/* Vibe Check — knowledge base: the rules the Safety Scan runs against a project.
   Platform-aware: knows "public by design" from "disaster", in plain English,
   with a paste-ready fix prompt for the user's AI builder on every rule.
   See docs/ARCHITECTURE.md → "5. Check (Safety Scan)" and Engines → scanner. */
(function () {
  'use strict';
  const VC = window.VC;
  VC.data = VC.data || {};

  /* ------------------------------------------------------------------ *
   * Shared helpers (VC.data.scanHelpers) — pure, no DOM.
   * ------------------------------------------------------------------ */
  const SEV = {
    SECRET: { client: 'critical', server: 'high', other: 'high', env: 'critical', envIgnored: 'info' },
    TESTKEY: { client: 'high', server: 'medium', other: 'medium', env: 'high', envIgnored: 'info' },
    PUBLIC: { client: 'info', server: 'info', other: 'info', env: 'info', envIgnored: null },
    RESTRICT: { client: 'low', server: 'info', other: 'low', env: 'info', envIgnored: null },
    GENERIC: { client: 'high', server: 'medium', other: 'medium', env: 'high', envIgnored: 'info' },
  };
  const PLACEHOLDER = /x{5,}|X{5,}|\*{3,}|•|…|\.{3}|your[_-]?|example|placeholder|dummy|change[_-]?me|replace[_-]?me|insert[_-]?|<[^>]*>|\[[^\]]*\]|fake|sample|redacted|test[_-]?key|0{8,}|1234567890/i;
  const REFERENCE = /^(?:process\.|import\.meta|Deno\.|os\.|env\.|\$\{?|\{\{|%|true$|false$|null$|undefined$|none$|[A-Za-z_$][\w$]*\(|[a-z_$][\w$]*\.[a-z_$])/i;
  function entropy(s) {
    const freq = {};
    for (let i = 0; i < s.length; i++) freq[s[i]] = (freq[s[i]] || 0) + 1;
    let bits = 0;
    Object.keys(freq).forEach((c) => { const p = freq[c] / s.length; bits -= p * Math.log2(p); });
    return bits;
  }
  const isPlaceholder = (s) => PLACEHOLDER.test(s);
  const looksRandom = (s) => /\d/.test(s) && /[A-Za-z]/.test(s) && !isPlaceholder(s);
  const AI_RE = /@anthropic-ai\/sdk|new\s+Anthropic\s*\(|api\.anthropic\.com|from\s+["']openai["']|require\(\s*["']openai["']\s*\)|new\s+OpenAI\s*\(|api\.openai\.com|chat\.completions\.create|responses\.create|generativelanguage\.googleapis\.com|GoogleGenerativeAI|@google\/genai|replicate\.run\s*\(|api\.replicate\.com|new\s+Replicate\s*\(|api\.elevenlabs\.io|ElevenLabsClient|\b(?:generateText|streamText|generateObject|streamObject)\s*\(|openrouter\.ai|api\.groq\.com|api\.mistral\.ai/;
  const PAY_RE = /\bstripe\.(?:checkout\.sessions|paymentIntents|charges|subscriptions|invoices|transfers|payouts|refunds)\.create\s*\(|api\.stripe\.com\/v1\/(?:checkout|payment_intents|charges|transfers|refunds)|lemonsqueezy\.com\/v1\/checkouts|\bcreateCheckout\s*\(/;
  const SEND_RE = /\bresend\.emails\.send\s*\(|api\.resend\.com\/emails|api\.twilio\.com|sgMail\.send\s*\(|\.sendMail\s*\(|api\.sendgrid\.com|api\.postmarkapp\.com/;
  const AUTH_RE = /\.auth\.getUser\s*\(|\.auth\.getClaims\s*\(|\bgetUser\s*\(|\bgetSession\s*\(|getServerSession\s*\(|\bauth\s*\(\s*\)|currentUser\s*\(|getAuth\s*\(\s*req|getToken\s*\(|verifyIdToken\s*\(|jwt\.verify\s*\(|jwtVerify\s*\(|clerkMiddleware|authMiddleware|requireAuth|withAuth|isAuthenticated|ensureAuth|passport\.authenticate|req\.user\b|req(?:uest)?\.headers\.get\(\s*["']authorization["']\s*\)|req\.headers\.authorization|req\.headers\[\s*["']authorization["']\s*\]|constructEvent(?:Async)?\s*\(|verifyWebhook|x-api-key|Depends\(\s*get_current_user|@login_required|context\.auth\b|request\.auth\b/i;
  const RATE_RE = /rate[\s_-]?limit|ratelimit|@upstash\/ratelimit|express-rate-limit|\blimiter\b|slowDown|throttle|slowapi|\bLimiter\s*\(|quota|usage_?count|credits?_?(?:left|remaining|balance)|daily_?limit|max_?requests/i;
  const PUBLIC_PREFIX = /^(?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_)/;

  VC.data.scanHelpers = { SEV, PLACEHOLDER, REFERENCE, entropy, isPlaceholder, looksRandom, AI_RE, PAY_RE, SEND_RE, AUTH_RE, RATE_RE, PUBLIC_PREFIX };

  /* ------------------------------------------------------------------ *
   * Secret rules: one factory for the common "leaked API key" shape.
   * ------------------------------------------------------------------ */
  function secretRule(spec) {
    return Object.assign({
      category: 'secrets',
      severity: SEV.SECRET,
      title: '{label} {whereShort}',
      plain: '{envIgnoredNote}We found your {label} {where} ({file}, line {line}). This key is meant to stay private.',
      risk: spec.risk,
      fix: [
        'Treat the key as stolen and rotate it now: {rotate}.',
        'Store the new key as a server-only secret named {env} in your builder\'s secrets or environment settings. Never give it a VITE_, NEXT_PUBLIC_ or EXPO_PUBLIC_ prefix.',
        'Delete the key from {file} and scan again.',
      ],
      fixPrompt: 'Security fix: my {label} is hardcoded in {file} (line {line}). Please:\n1. Remove the key from the code completely and read it from the server-side environment variable {env} instead (no VITE_, NEXT_PUBLIC_ or EXPO_PUBLIC_ prefix).\n2. If this code runs in the browser, move it into a server function (a Supabase Edge Function or an API route) and have the frontend call that function instead.\n3. Search the whole project for any other copies of this key and remove them too.\n4. Never print, log or echo the key. I\'ll rotate it and add the new value to {env} myself.\nList every file you changed.',
    }, spec);
  }

  const JWT_RE = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

  const secretRules = [
    secretRule({
      id: 'secret.clerk-secret', label: 'Clerk secret key', env: 'CLERK_SECRET_KEY',
      re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}/g,
      check: (m, f, ctx) => /clerk/i.test(ctx.around(f, m.index, 3)),
      rotate: 'Clerk dashboard → API Keys → roll the secret key',
      risk: 'Anyone can manage your users: read their emails, create or delete accounts, and sign in as anyone.',
    }),
    secretRule({
      id: 'secret.supabase-service-role', label: 'Supabase service_role key', env: 'SUPABASE_SERVICE_ROLE_KEY',
      re: JWT_RE, check: (m, f, ctx) => ctx.jwtRole(m[0]) === 'service_role',
      rotate: 'Supabase dashboard → Project Settings → API Keys → rotate/disable the legacy keys',
      risk: 'It skips every Row Level Security rule. Whoever has it can read, change or delete every row in every table and every stored file.',
    }),
    secretRule({
      id: 'secret.supabase-public', label: 'Supabase public key', env: '', category: 'secrets', severity: SEV.PUBLIC, once: true,
      re: /\bsb_publishable_[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      check: (m, f, ctx) => m[0].indexOf('sb_') === 0 || ctx.jwtRole(m[0]) === 'anon',
      title: 'Supabase public key found (that\'s expected)',
      plain: 'This key is designed to be inside your app. It\'s only safe if Row Level Security is on for every table — see the database results below.',
      risk: 'If any table has RLS off, anyone can use this public key to read or change it.',
      fix: ['Nothing to hide here. Just make sure every table has Row Level Security turned on (Supabase dashboard → Table Editor).'],
      fixPrompt: 'List every Supabase table this app uses and confirm Row Level Security is enabled on each, with policies that only let users touch their own rows. Fix any table that isn\'t protected, using a new migration.',
      rotate: '', fixPromptDefault: '',
    }),
    secretRule({
      id: 'secret.supabase-secret', label: 'Supabase secret key', env: 'SUPABASE_SECRET_KEY',
      re: /\bsb_secret_[A-Za-z0-9_-]{10,}/g, check: (m) => !isPlaceholder(m[0]),
      rotate: 'Supabase dashboard → Project Settings → API Keys → Secret keys → delete it and create a new one',
      risk: 'It skips every Row Level Security rule, same as the service_role key. Whoever has it can read, change or delete every row in every table.',
    }),
    secretRule({
      id: 'secret.stripe-live', label: 'Stripe live secret key', env: 'STRIPE_SECRET_KEY',
      re: /\b[sr]k_live_[A-Za-z0-9]{10,}/g, check: (m, f, ctx) => !/clerk/i.test(ctx.around(f, m.index, 3)) && looksRandom(m[0]),
      rotate: 'Stripe Dashboard → Developers → API keys → Roll key',
      risk: 'Anyone can charge cards, issue refunds, read customer details and move money out of your Stripe account.',
    }),
    secretRule({
      id: 'secret.stripe-test', label: 'Stripe test secret key', env: 'STRIPE_SECRET_KEY', severity: SEV.TESTKEY,
      re: /\b[sr]k_test_[A-Za-z0-9]{10,}/g, check: (m, f, ctx) => !/clerk/i.test(ctx.around(f, m.index, 3)) && looksRandom(m[0]),
      rotate: 'Stripe Dashboard (test mode) → Developers → API keys → Roll key',
      risk: 'Test keys can\'t move real money, but they expose your test data, and the live key usually ends up in the same place.',
    }),
    secretRule({
      id: 'secret.stripe-webhook', label: 'Stripe webhook signing secret', env: 'STRIPE_WEBHOOK_SECRET',
      re: /\bwhsec_[A-Za-z0-9]{10,}/g, check: (m) => looksRandom(m[0]),
      rotate: 'Stripe Dashboard → Developers → Webhooks → your endpoint → Roll secret',
      risk: 'Someone could fake a "payment succeeded" message and unlock paid features for free.',
    }),
    secretRule({
      id: 'secret.stripe-publishable', label: 'Stripe publishable key', env: '', severity: SEV.PUBLIC, once: true,
      re: /\bpk_(?:live|test)_[A-Za-z0-9]{10,}/g,
      title: 'Stripe publishable key found (that\'s fine)',
      plain: 'Publishable keys (pk_) are made for your website. Just keep the sk_ secret key off it.',
      risk: '', fix: [], fixPrompt: '', rotate: '',
    }),
    secretRule({
      id: 'secret.anthropic', label: 'Claude (Anthropic) API key', env: 'ANTHROPIC_API_KEY',
      re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, check: (m) => !isPlaceholder(m[0]),
      rotate: 'console.anthropic.com → API Keys → delete it and create a new one',
      risk: 'Anyone can run Claude on your bill. Bots scan websites and GitHub for these keys and can run up hundreds of dollars in hours.',
    }),
    secretRule({
      id: 'secret.openai', label: 'OpenAI API key', env: 'OPENAI_API_KEY',
      re: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g,
      when: (f) => !/\.(?:css|scss|less)$/i.test(f.path),
      check: (m) => { const body = m[0].replace(/^sk-(?:proj-|svcacct-|admin-)?/, ''); return /\d/.test(body) && /[A-Z]/.test(body) && /[a-z]/.test(body) && !isPlaceholder(m[0]); },
      rotate: 'platform.openai.com → API keys → revoke it and create a new one',
      risk: 'Anyone can run OpenAI models on your bill. Bots scan websites and GitHub for these keys.',
    }),
    secretRule({
      id: 'secret.gemini', label: 'Google Gemini API key', env: 'GEMINI_API_KEY',
      re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
      check: (m, f, ctx) => /gemini|generativelanguage|GoogleGenerativeAI|@google\/genai|GEMINI_/i.test(ctx.around(f, m.index, 3)),
      rotate: 'Google AI Studio → API keys → delete it and create a new one',
      risk: 'Anyone can run Gemini on your Google Cloud bill.',
    }),
    secretRule({
      id: 'secret.firebase-web-config', label: 'Firebase web config', env: '', severity: SEV.PUBLIC, once: true,
      re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
      check: (m, f, ctx) => /authDomain|firebaseapp\.com|firebaseConfig|initializeApp/.test(ctx.around(f, m.index, 6)),
      title: 'Firebase web config found (that\'s expected)',
      plain: 'The Firebase config (apiKey, authDomain…) is meant to be in your app. What protects your data is your Firebase security rules.',
      risk: '', fix: ['Check your Firestore and Storage rules (see the database results).'],
      fixPrompt: 'Review my firestore.rules and storage.rules. Make sure no rule says "if true", and that users can only read and write their own documents (match request.auth.uid). Show me the updated rules.',
      rotate: '',
    }),
    secretRule({
      id: 'secret.google-key-restrict', label: 'Google API key', env: '', severity: SEV.RESTRICT,
      re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
      title: 'Google API key: make sure it\'s restricted',
      plain: 'Browser keys for Google Maps are meant to be in your app, but an unrestricted key can be copied and used on other sites, on your bill.',
      risk: 'Someone could burn through your Google Maps quota and you\'d pay for it.',
      fix: ['Google Cloud console → APIs & Services → Credentials → click this key.', 'Under Application restrictions choose Websites and add your domain.', 'Under API restrictions allow only the APIs you use (e.g. Maps JavaScript API).'],
      fixPrompt: '', rotate: '',
    }),
    secretRule({
      id: 'secret.aws-access-key', label: 'AWS access key', env: 'AWS_ACCESS_KEY_ID',
      re: /\bAKIA[0-9A-Z]{16}\b/g, check: (m) => !/EXAMPLE/.test(m[0]),
      rotate: 'AWS console → IAM → Users → Security credentials → deactivate and delete it, then create a new one',
      risk: 'Depending on its permissions, anyone could start servers on your bill or read your storage buckets.',
    }),
    secretRule({
      id: 'secret.aws-secret', label: 'AWS secret access key', env: 'AWS_SECRET_ACCESS_KEY',
      re: /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY|secretAccessKey)["']?\s*[=:]\s*["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/g,
      check: (m) => !/EXAMPLEKEY/.test(m[1]), secret: (m) => m[1],
      rotate: 'AWS console → IAM → Users → Security credentials → deactivate and delete it, then create a new one',
      risk: 'Depending on its permissions, anyone could start servers on your bill or read your storage buckets.',
    }),
    secretRule({
      id: 'secret.firebase-service-account', label: 'Firebase/Google service-account key', env: 'FIREBASE_SERVICE_ACCOUNT',
      re: /"private_key"\s*:\s*"-----BEGIN/g, when: (f) => /\.json$/i.test(f.path),
      check: (m, f) => /"type"\s*:\s*"service_account"/.test(f.text), secret: (m) => m[0],
      rotate: 'Google Cloud console → IAM & Admin → Service Accounts → your account → Keys → delete this key and create a new one',
      risk: 'Full admin access to your Firebase project: every record, every file, every user, with no security rules applied.',
    }),
    secretRule({
      id: 'secret.github', label: 'GitHub token', env: 'GITHUB_TOKEN',
      re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g,
      rotate: 'github.com → Settings → Developer settings → Personal access tokens → delete it',
      risk: 'Access to your GitHub code, possibly including private repos and pushing changes.',
    }),
    secretRule({
      id: 'secret.private-key', label: 'private key', env: 'PRIVATE_KEY',
      re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g,
      check: (m, f, ctx) => !/\.\.\.|your|example/i.test(ctx.around(f, m.index + m[0].length, 80)),
      rotate: 'Create a new key pair wherever this one came from and revoke the old one',
      risk: 'Whoever has it can impersonate your server or sign things as you.',
    }),
    secretRule({
      id: 'secret.resend', label: 'Resend API key', env: 'RESEND_API_KEY',
      re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}/g, check: (m) => /\d/.test(m[0]),
      rotate: 'resend.com → API Keys → delete it and create a new one',
      risk: 'Anyone can send email as your domain. Spam and phishing sent that way get your domain blocklisted.',
    }),
    secretRule({
      id: 'secret.replicate', label: 'Replicate API token', env: 'REPLICATE_API_TOKEN',
      re: /\br8_[A-Za-z0-9]{30,}/g,
      rotate: 'replicate.com → Account → API tokens → delete it and create a new one',
      risk: 'Anyone can run image, video and audio models on your bill, and those costs add up fast.',
    }),
    secretRule({
      id: 'secret.elevenlabs', label: 'ElevenLabs API key', env: 'ELEVENLABS_API_KEY',
      re: /\bsk_[a-f0-9]{48}\b/gi,
      rotate: 'elevenlabs.io → Developers → API Keys → delete it and create a new one',
      risk: 'Anyone can generate voice audio on your credits and clone voices under your account.',
    }),
    secretRule({
      id: 'secret.twilio-auth', label: 'Twilio auth token', env: 'TWILIO_AUTH_TOKEN',
      re: /(?:TWILIO_AUTH_TOKEN|authToken|auth_token)["']?\s*[=:,]\s*["']?([a-f0-9]{32})\b/g,
      check: (m, f, ctx) => /twilio/i.test(ctx.around(f, m.index, 5)), secret: (m) => m[1],
      rotate: 'Twilio Console → Account → API keys & tokens → rotate the auth token',
      risk: 'Anyone can send texts and make calls on your balance. SMS fraud can cost thousands in one night.',
    }),
    secretRule({
      id: 'secret.mapbox-secret', label: 'Mapbox secret token', env: 'MAPBOX_SECRET_TOKEN',
      re: /\bsk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      rotate: 'account.mapbox.com → Tokens → delete it',
      risk: 'Can edit your Mapbox styles, tokens and data, and run up usage.',
    }),
    secretRule({
      id: 'secret.mapbox-public', label: 'Mapbox public token', env: '', severity: SEV.PUBLIC, once: true,
      re: /\bpk\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
      title: 'Mapbox public token found (that\'s fine)',
      plain: 'Mapbox public tokens (pk.) are made to be in your app.',
      risk: '', fix: ['Optional: account.mapbox.com → Tokens → add URL restrictions so only your site can use it.'],
      fixPrompt: '', rotate: '',
    }),
    secretRule({
      id: 'secret.db-url', label: 'database password (connection string)', env: 'DATABASE_URL',
      re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/[^\s"'`:@/]+:([^\s"'`@/]+)@([^\s"'`/:]+)/gi,
      check: (m) => !/^(?:\[.*\]|<.*>|\$\{.*|\$[A-Z_]+|password|pass|postgres|root|secret|changeme|\*+)$/i.test(m[1]) && !/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|db|postgres|mysql|mongo|redis|host\.docker\.internal)$/i.test(m[2]),
      secret: (m) => m[1],
      rotate: 'Change the database password (Supabase: Project Settings → Database → Reset database password)',
      risk: 'Direct access to your whole database, skipping your app and every security rule.',
    }),
    secretRule({
      id: 'secret.slack', label: 'Slack token', env: 'SLACK_TOKEN',
      re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
      rotate: 'api.slack.com/apps → your app → reinstall or revoke the token',
      risk: 'Can read or post messages in your Slack workspace.',
    }),
    secretRule({
      id: 'secret.public-env-name', label: '{name}', env: '{serverName}', category: 'secrets',
      re: /\b(?:NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_|NUXT_PUBLIC_|PUBLIC_)[A-Z0-9_]*?(?:SERVICE_ROLE|SECRET|PRIVATE|PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY|CLAUDE_API_KEY|GEMINI_API_KEY|RESEND_API_KEY|REPLICATE_API_TOKEN|ELEVENLABS_API_KEY|TWILIO_AUTH_TOKEN|DATABASE_URL|AWS_SECRET)[A-Z0-9_]*\b/g,
      check: (m, f) => ({ severity: /\.env\.(?:example|sample|template)$/.test(f.path) ? 'high' : 'critical', vars: { name: m[0], serverName: m[0].replace(PUBLIC_PREFIX, '') }, key: m[0], secret: '' }),
      title: 'Secret stored in a public variable: {name}',
      plain: 'Anything starting with VITE_, NEXT_PUBLIC_, EXPO_PUBLIC_ or REACT_APP_ gets copied into the website code every visitor downloads. {name} sounds like a secret, so it\'s being published.',
      risk: 'Anyone can open their browser\'s developer tools and copy it.',
      fix: ['Rename it to {serverName} (no public prefix) in your builder\'s secrets settings.', 'Move the code that uses it into a server function and have the app call that instead.', 'If the app was ever published with the old name, rotate the key.'],
      fixPrompt: 'Security fix: {name} holds a secret, but its public prefix puts it in the browser bundle. Rename it to {serverName} everywhere, move every piece of code that uses it into a server function (a Supabase Edge Function or an API route), and have the frontend call that function instead. Don\'t log the value. List every file you changed.',
      rotate: '',
    }),
    secretRule({
      id: 'secret.generic', label: '{name}', env: '{name}', category: 'secrets', severity: SEV.GENERIC,
      re: /(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Za-z0-9_]*["']?\s*[=:]\s*["'`]?([^\s"'`,;)]{8,})/gi,
      when: (f) => !/\.env\.(?:example|sample|template)$/.test(f.path),
      check: (m, f, ctx) => {
        const v = m[1];
        if (REFERENCE.test(v) || isPlaceholder(v)) return false;
        // Already covered (and named more specifically) by a dedicated rule above — don't double-report.
        if (/^(?:sk-ant-|sk-(?:proj-|svcacct-|admin-)?|sk_(?:live|test)_|sb_(?:secret|publishable)_|whsec_|re_|r8_|gh[pousr]_|github_pat_|xox[abpr]-|AKIA|AIza|pk[._]|sk\.eyJ|eyJ)/.test(v)) return false;
        const fc = ctx.fileCtx(f);
        if (fc !== 'env' && !/[=:]\s*["'`]/.test(m[0])) return false;
        if (!(v.length >= (fc === 'env' ? 12 : 16) && entropy(v) >= 3.5 && looksRandom(v))) return false;
        const before = f.text.slice(0, m.index);
        const nameMatch = before.match(/([A-Za-z0-9_]+)$/);
        return { vars: { name: (nameMatch ? nameMatch[1] : 'this value') }, secret: v };
      },
      title: 'Possible secret: {name}',
      plain: 'We found a long, random-looking value next to {name} in {file}, line {line}. It looks like a password or key.',
      risk: 'If this is a real password or key, anyone who reads the code can use it.',
      rotate: 'Wherever this value came from, create a new one',
    }),
  ];

  /* ------------------------------------------------------------------ *
   * Database rules
   * ------------------------------------------------------------------ */
  const dbRules = [
    {
      id: 'db.supabase-rls-off', category: 'database', severity: 'high',
      run(ctx) {
        return Object.keys(ctx.db.tables).map((name) => {
          const t = ctx.db.tables[name];
          if (!t.created || t.rls !== false) return null;
          const loc = t.rlsAt || t.created;
          const sev = ctx.stack.services.indexOf('supabase') !== -1 ? 'critical' : 'high';
          return { file: loc.file, line: loc.line, key: name, vars: { table: name }, severity: sev };
        }).filter(Boolean);
      },
      title: 'Table "{table}" has no Row Level Security',
      plain: 'Your SQL creates the {table} table but never turns Row Level Security on. With RLS off, the public key inside your app can read and change every row.',
      risk: 'Anyone can grab your public Supabase key from the page and download, edit or delete everything in {table}, including other people\'s data.',
      fix: [
        'Supabase dashboard → Table Editor → {table} → enable RLS, or run: ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;',
        'Add policies that say who can read and write each row (usually: only the row\'s owner).',
        'Test while logged out and as a second account: you shouldn\'t see anyone else\'s rows.',
      ],
      fixPrompt: 'Security fix: the Supabase table public.{table} doesn\'t have Row Level Security enabled. Create a new migration that (1) runs ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY; (2) adds policies so signed-in users can only select, insert, update and delete their own rows, matching auth.uid() to the owner column (tell me which column you used; if there isn\'t one, propose adding user_id uuid references auth.users); (3) keeps truly public data read-only. Never use USING (true) for insert, update or delete. Then tell me how to test it with two accounts.',
    },
    {
      id: 'db.supabase-policy-open-write', category: 'database', severity: 'high',
      run(ctx) {
        const out = [];
        Object.keys(ctx.db.tables).forEach((name) => {
          (ctx.db.tables[name].policies || []).forEach((p) => {
            if (p.open && (p.cmd === 'all' || p.cmd === 'insert' || p.cmd === 'update' || p.cmd === 'delete')) {
              out.push({ file: p.file, line: p.line, key: name + ':' + p.name, vars: { table: name, policy: p.name, op: p.cmd } });
            }
          });
        });
        return out;
      },
      title: 'Anyone can change "{table}"',
      plain: 'The policy "{policy}" on {table} allows {op} for everyone (it says USING/WITH CHECK (true)). For that action, it\'s the same as having no security.',
      risk: 'Any visitor could edit or delete other people\'s rows in {table}.',
      fix: ['Change the policy\'s condition from true to something like auth.uid() = user_id.', 'Or limit it to specific roles with TO authenticated plus an ownership check.'],
      fixPrompt: 'Security fix: the RLS policy "{policy}" on public.{table} uses (true) for {op}, so anyone can do it. Replace it in a new migration with a policy that only lets the row\'s owner do this (auth.uid() = the owner column). Keep read access as it is unless it\'s also (true) on private data.',
    },
    {
      id: 'db.supabase-policy-open-read', category: 'database', severity: 'low',
      run(ctx) {
        const out = [];
        Object.keys(ctx.db.tables).forEach((name) => {
          (ctx.db.tables[name].policies || []).forEach((p) => {
            if (p.open && p.cmd === 'select') out.push({ file: p.file, line: p.line, key: name + ':' + p.name + ':read', vars: { table: name } });
          });
        });
        return out;
      },
      title: 'Everyone can read "{table}"',
      plain: 'A policy lets anyone read every row in {table}. That\'s fine for public content like blog posts, and a leak if it holds emails, messages or anything personal.',
      risk: 'If {table} has private data, anyone can download all of it.',
      fix: ['If {table} is private, change USING (true) to an ownership check.'],
      fixPrompt: 'Check whether public.{table} holds anything personal. If it does, replace its USING (true) select policy with one that only returns the user\'s own rows. If it\'s meant to be public, tell me and leave it.',
    },
    {
      id: 'db.supabase-rls-no-policies', category: 'database', severity: 'low',
      run(ctx) {
        return Object.keys(ctx.db.tables).map((name) => {
          const t = ctx.db.tables[name];
          if (t.rls === true && (!t.policies || !t.policies.length)) return { file: t.created.file, line: t.created.line, key: name + ':nopolicy', vars: { table: name } };
          return null;
        }).filter(Boolean);
      },
      title: '"{table}" is locked, even for your app',
      plain: 'RLS is on for {table} (good), but there are no policies, so your app can\'t read or write it.',
      risk: 'No security risk. Features using this table will just show nothing.',
      fix: [], fixPrompt: 'public.{table} has Row Level Security on but no policies. Add policies so signed-in users can read and write only their own rows (auth.uid() = owner column).',
    },
    {
      id: 'db.supabase-rls-unknown', category: 'database', severity: 'medium',
      run(ctx) {
        if (ctx.stack.services.indexOf('supabase') === -1) return [];
        const names = Object.keys(ctx.db.used).filter((n) => !ctx.db.tables[n]);
        if (!names.length) return [];
        const shown = names.slice(0, 8);
        return [{ file: ctx.db.used[names[0]][0], line: 0, key: 'agg', vars: { tables: shown.join(', '), count: names.length } }];
      },
      title: 'We can\'t see the security rules for {count} table(s)',
      plain: 'Your code uses {tables}, but no SQL file we received creates them (they were probably made in the dashboard), so we can\'t check their Row Level Security.',
      risk: 'If any of them has RLS off, anyone can read or change it with your public key.',
      fix: ['Supabase dashboard → Table Editor: no table should be marked as having RLS disabled.', 'Or open the Security Advisor in the dashboard, which lists unprotected tables.'],
      fixPrompt: 'Please list every Supabase table this app uses and, for each one, say whether Row Level Security is enabled and what its policies allow. Then write one migration that enables RLS on any table missing it and adds owner-only policies (auth.uid() = owner column). Don\'t weaken any existing policy.',
    },
    {
      id: 'db.firebase-open-rules', category: 'database',
      re: /\ballow\s+([a-z]+(?:\s*,\s*[a-z]+)*)\s*(?::\s*if\s+true\s*)?;/g,
      when: (f) => /(?:^|\/)(?:firestore|storage)\.rules$|\.rules$/.test(f.path),
      check: (m) => ({ severity: /write|create|update|delete/.test(m[1]) ? 'critical' : 'high', vars: { ops: m[1] } }),
      title: 'Firebase rules let anyone {ops}',
      plain: '{file} line {line} allows "{ops}" with no login check.',
      risk: 'Anyone on the internet can {ops} your data, no account needed.',
      fix: ['Replace the open rule with a check like: if request.auth != null && request.auth.uid == userId', 'Deploy the rules (Firebase console → Firestore → Rules → Publish).'],
      fixPrompt: 'Security fix: {file} has "allow {ops}" open to everyone. Rewrite the rules so users can only read and write documents they own (compare request.auth.uid to the document\'s owner field or path), and deny everything else by default. Show me the full new rules file.',
    },
    {
      id: 'db.firebase-test-mode', category: 'database', severity: 'high',
      re: /request\.time\s*<\s*timestamp\.date\(\s*(\d{4})\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})\s*\)/g,
      when: (f) => /(?:^|\/)(?:firestore|storage)\.rules$|\.rules$/.test(f.path),
      check: (m) => ({ vars: { date: m[1] + '-' + m[2] + '-' + m[3] } }),
      title: 'Firebase is still in test mode',
      plain: 'Your rules are wide open until {date}. After that date, everything gets blocked and your app stops working.',
      risk: 'Until then, anyone can read and change all your data.',
      fix: ['Write real rules before that date: owner-only access, deny by default.'],
      fixPrompt: 'Security fix: {file} is still using Firebase\'s test-mode rules (open until {date}). Rewrite the rules so users can only read and write documents they own, and deny everything else by default. Show me the full new rules file.',
    },
    {
      id: 'db.firebase-rtdb-open', category: 'database',
      re: /"\.(read|write)"\s*:\s*(?:true|"true")/g,
      when: (f) => /database\.rules\.json$/.test(f.path),
      check: (m) => ({ severity: m[1] === 'write' ? 'critical' : 'high', vars: { ops: m[1] } }),
      title: 'Firebase Realtime Database rules let anyone {ops}',
      plain: '{file} line {line} sets ".{ops}": true, with no login check.',
      risk: 'Anyone on the internet can {ops} your data, no account needed.',
      fix: ['Replace true with a rule like "auth != null && auth.uid == $uid".'],
      fixPrompt: 'Security fix: {file} has ".{ops}": true, open to everyone. Rewrite the rules so users can only read and write their own data, and deny everything else by default. Show me the full new rules file.',
    },
    {
      id: 'db.firebase-rules-missing', category: 'database', severity: 'medium',
      run(ctx) {
        const uses = ctx.files.some((f) => /firebase\/(?:firestore|storage|database)|getFirestore\s*\(|getStorage\s*\(|getDatabase\s*\(/.test(f.text));
        const hasRules = ctx.files.some((f) => /\.rules$|database\.rules\.json$/.test(f.path));
        if (!uses || hasRules) return [];
        const f = ctx.files.find((x) => /firebase\/(?:firestore|storage|database)|getFirestore\s*\(|getStorage\s*\(|getDatabase\s*\(/.test(x.text));
        return [{ file: f ? f.path : 'firestore.rules', line: 0, key: 'agg' }];
      },
      title: 'We can\'t see your Firebase security rules',
      plain: 'Your app uses Firebase\'s database or storage, but there\'s no firestore.rules file here, so we can\'t check who is allowed in.',
      risk: 'If the rules are still the defaults, anyone can read or write everything.',
      fix: ['Firebase console → Firestore Database → Rules: make sure no rule says "if true".'],
      fixPrompt: 'Add firestore.rules (and storage.rules if I use Storage) to this project with owner-only rules (request.auth.uid must match the document owner), deny-by-default, and tell me how to deploy them.',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Config rules
   * ------------------------------------------------------------------ */
  const configRules = [
    {
      id: 'config.env-file', category: 'config',
      run(ctx) {
        return ctx.files.filter((f) => ctx.isEnvFile(f)).map((f) => {
          const covered = ctx.gitignoreCovers(f.path);
          const hasRealValue = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*\S/m.test(f.text);
          const sev = covered ? 'info' : (hasRealValue ? 'high' : 'low');
          return { file: f.path, line: 0, key: f.path, severity: sev, vars: { status: covered ? 'protected' : 'not protected' } };
        });
      },
      title: (v) => (v.status === 'protected' ? 'Your .env file is protected' : 'Your .env file would be uploaded with your code'),
      plain: (v) => (v.status === 'protected'
        ? v.file + ' is listed in .gitignore, so git won’t upload it. Just don’t share this folder or zip.'
        : v.file + ' has real settings in it, and nothing stops git from uploading it to GitHub with the rest of your code.'),
      risk: 'Anyone who can see the repo gets every key in that file.',
      fix: ['Add `.env*` and `!.env.example` to .gitignore.', 'If the project is already on GitHub, rotate every secret key that was in this file.'],
      fixPrompt: 'My {file} file holds real secrets and isn\'t covered by .gitignore. Add `.env*` and `!.env.example` to .gitignore, create .env.example with the same variable names and empty values, and if the project is already in git, give me the exact command to stop tracking {file} (git rm --cached) without deleting my local copy.',
    },
    {
      id: 'config.no-gitignore', category: 'config',
      run(ctx) {
        if (ctx.files.some((f) => f.path === '.gitignore')) return [];
        const hasEnv = ctx.files.some((f) => ctx.isEnvFile(f));
        const hasSecretFinding = ctx.findings.some((fnd) => fnd.category === 'secrets' && (fnd.severity === 'critical' || fnd.severity === 'high'));
        return [{ file: '.gitignore', line: 0, key: 'agg', severity: (hasEnv || hasSecretFinding) ? 'high' : 'medium' }];
      },
      title: 'No .gitignore file',
      plain: 'A .gitignore tells git which files must never be uploaded (like .env with your keys). Your project doesn\'t have one.',
      risk: 'Your secrets and thousands of junk files can end up on GitHub.',
      fix: ['Create a file named .gitignore in the project\'s top folder with: node_modules, dist, .env*, !.env.example'],
      fixPrompt: 'Create a .gitignore in the project root that ignores node_modules, build output (dist, build, .next, out), .DS_Store, and all env files (.env*), but keeps .env.example. If any .env file is already tracked by git, give me the command to untrack it without deleting it.',
    },
    {
      id: 'config.gitignore-no-env', category: 'config', severity: 'medium',
      run(ctx) {
        const gi = ctx.files.find((f) => f.path === '.gitignore');
        if (!gi) return [];
        if (ctx.gitignoreCovers('.env') && ctx.gitignoreCovers('.env.local')) return [];
        return [{ file: '.gitignore', line: 0, key: 'agg', vars: { missing: '.env files' } }];
      },
      title: '.gitignore doesn\'t cover .env files',
      plain: 'Your .gitignore exists but doesn\'t block {missing}. (A `*.local` or `.env*.local` line protects .env.local but not a plain .env.)',
      risk: 'The next time you add keys to .env, they\'ll be uploaded.',
      fix: ['Add a line `.env*` and a line `!.env.example` to .gitignore.'],
      fixPrompt: 'Update .gitignore so it ignores every env file (.env, .env.local, .env.production…) using `.env*`, and keeps `!.env.example`.',
    },
    {
      id: 'config.no-git', category: 'config',
      run(ctx) {
        if (ctx.meta.sawGit) return [];
        return [{ file: '(project root)', line: 0, key: 'agg', severity: ctx.meta.source === 'folder' ? 'low' : 'info' }];
      },
      title: 'No version history found',
      plain: 'We didn\'t see a .git folder, so there may be no way to undo changes. If your builder syncs to GitHub or has checkpoints, you\'re fine.',
      risk: 'One bad AI edit could break the app with no way back.',
      fix: ['Connect the project to GitHub from your builder\'s settings, or run `git init` and commit.'],
      fixPrompt: 'Set up git for this project: initialize a repo, make sure .gitignore excludes node_modules and .env*, and make a first commit. Explain in one line each how I save a checkpoint and undo to one.',
    },
    {
      id: 'config.cors-wildcard', category: 'config', max: 1,
      re: /Access-Control-Allow-Origin["']?\s*[:,=]\s*["']\*["']|\bcors\(\s*\)|\bcors\(\s*\{[^}]{0,300}?\borigin\s*:\s*(?:true|["']\*["'])|allow_origins\s*=\s*\[\s*["']\*["']\s*\]|\bCORS\(\s*app\s*\)|"key"\s*:\s*"Access-Control-Allow-Origin"\s*,\s*"value"\s*:\s*"\*"/gi,
      when: (f) => /\.(?:[mc]?[jt]sx?|py|json|toml)$/i.test(f.path) || /vercel\.json|netlify\.toml|_headers$/.test(f.path),
      check: (m, f) => {
        const text = f.text;
        let sev = 'low';
        if (/Access-Control-Allow-Credentials["']?\s*[:,=]\s*["']?true|credentials\s*:\s*true|allow_credentials\s*=\s*True/i.test(text)) sev = 'high';
        else if ((AI_RE.test(text) || PAY_RE.test(text) || SEND_RE.test(text)) && !AUTH_RE.test(text)) sev = 'medium';
        return { severity: sev };
      },
      title: 'Any website can call this endpoint (CORS: *)',
      plain: '{file} allows requests from every website. That\'s normal for public data, but risky for anything tied to logins, payments or AI.',
      risk: 'Another site could make your users\' browsers call your endpoint, or use your endpoint for free.',
      fix: ['Replace * with your real site address (e.g. https://yourapp.com).', 'Make sure the endpoint also checks who is logged in.'],
      fixPrompt: 'Security fix: {file} sets CORS to allow every origin. Change it to allow only my site\'s domain(s) (read them from an ALLOWED_ORIGINS environment variable, and include localhost for development), and make sure the endpoint verifies the logged-in user before doing anything.',
    },
    {
      id: 'config.scan-truncated', category: 'config', severity: 'info',
      run(ctx) {
        if (!ctx.meta.truncated) return [];
        return [{ file: '(project root)', line: 0, key: 'agg' }];
      },
      title: 'Big project: we scanned the first 5,000 files',
      plain: 'Anything past that wasn\'t checked. Scan your main app folder on its own for full results.',
      risk: '', fix: [], fixPrompt: '',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Code rules
   * ------------------------------------------------------------------ */
  const isCode = (p) => /\.(?:[mc]?[jt]sx?|vue|svelte|astro|html?|py|rb|go|php)$/i.test(p);
  const isTest = (p) => /(?:^|\/)(?:__tests__|tests?|spec|e2e|cypress|playwright)\//i.test(p) || /\.(?:test|spec)\.[jt]sx?$/i.test(p);
  const codeWhen = (f) => isCode(f.path) && !isTest(f.path);

  const codeRules = [
    {
      id: 'code.eval', category: 'code', skipComments: true, when: codeWhen,
      re: /(?<![\w$.])eval\s*\(/g,
      check: (m, f, ctx) => ({ severity: /req\.|request\.|params|query|searchParams|location\.|body|input|event\.target|message/.test(ctx.lineOf(f, m.index).text) ? 'high' : 'medium' }),
      title: 'Code runs text as a program (eval)',
      plain: '{file} line {line} uses eval(), which runs a piece of text as code.',
      risk: 'If any of that text comes from a user or an AI, they can run anything inside your app.',
      fix: ['Replace eval with JSON.parse (for data) or a normal function.'],
      fixPrompt: 'Security fix: {file} line {line} uses eval(). Replace it with a safe alternative (JSON.parse for data, or explicit logic) so no text is ever executed as code. Show the change.',
    },
    {
      id: 'code.new-function', category: 'code', severity: 'medium', skipComments: true, when: codeWhen,
      re: /\bnew\s+Function\s*\(/g,
      title: 'Code builds a function from text (new Function)',
      plain: '{file} line {line} uses new Function(), which turns a piece of text into runnable code.',
      risk: 'If any of that text comes from a user or an AI, they can run anything inside your app.',
      fix: ['Replace it with a normal function.'],
      fixPrompt: 'Security fix: {file} line {line} uses new Function(). Replace it with a normal function so no text is ever executed as code. Show the change.',
    },
    {
      id: 'code.raw-html', category: 'code', severity: 'medium', skipComments: true,
      when: (f) => codeWhen(f) && !/(?:^|\/)components\/ui\//.test(f.path),
      re: /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*([^}]{1,200})\}|\bv-html\s*=\s*"([^"]{1,200})"|\{@html\s+([^}]{1,200})\}/g,
      check: (m) => {
        const e = (m[1] || m[2] || m[3] || '').trim();
        if (/\b(?:DOMPurify\.sanitize|sanitize(?:Html)?|purify|xss|escapeHtml)\s*\(/.test(e)) return false;
        if (/^["'][^"'$]*["']$/.test(e)) return false;
        return { vars: { expr: e.slice(0, 40) } };
      },
      title: 'Raw HTML inserted into the page',
      plain: '{file} line {line} puts `{expr}` into the page as raw HTML without cleaning it first.',
      risk: 'If that text comes from a user or an AI, someone can inject a script that steals your visitors\' logins (called XSS).',
      fix: ['Render it as normal text, or clean it first with DOMPurify.sanitize().'],
      fixPrompt: 'Security fix: {file} line {line} renders `{expr}` as raw HTML. Render it as plain text instead, or if HTML is really needed (e.g. markdown), sanitize it with DOMPurify first. Apply the same fix anywhere else raw HTML is rendered.',
    },
    {
      id: 'code.innerhtml', category: 'code', severity: 'medium', skipComments: true, when: codeWhen,
      re: /\.(?:innerHTML|outerHTML)\s*\+?=\s*(?:`[^`]*?\$\{|[^;\n]*?\+\s*[A-Za-z_$])|\binsertAdjacentHTML\s*\(\s*["'][^"']+["']\s*,\s*`[^`]*?\$\{|\bdocument\.write(?:ln)?\s*\(/g,
      check: (m, f, ctx) => !/escape|sanitize|DOMPurify/i.test(ctx.lineOf(f, m.index).text),
      title: 'Page HTML built from changing text',
      plain: '{file} line {line} sets innerHTML (or writes to the page) using text that isn\'t hard-coded.',
      risk: 'If that text comes from a user or an AI, someone can inject a script that steals your visitors\' logins (called XSS).',
      fix: ['Use textContent, or build elements with createElement, instead of innerHTML.'],
      fixPrompt: 'Security fix: {file} line {line} sets innerHTML (or uses document.write) with text that isn\'t hard-coded. Use textContent, or build elements with createElement/appendChild, so no text is ever parsed as HTML. Apply the same fix anywhere else this happens.',
    },
    {
      id: 'code.sql-injection', category: 'code', severity: 'high', skipComments: true, when: codeWhen,
      re: /(?<![\w$])`\s*(?:SELECT\b[^`]{0,500}?\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)[^`]{0,500}?\$\{|["']\s*(?:SELECT\b[^"'\n]{0,300}\bFROM\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b)[^"'\n]{0,300}["']\s*\+\s*[A-Za-z_$]|\.(?:query|execute|executemany|raw)\(\s*f["']|\.execute\(\s*["'][^"']*["']\s*%\s*[\w(]|\$(?:queryRaw|executeRaw)Unsafe\s*\(/gi,
      title: 'Database query built by gluing text together',
      plain: '{file} line {line} builds a SQL query by pasting values straight into the text.',
      risk: 'Someone can type specially crafted text into a form and read or delete your whole database (SQL injection).',
      fix: ['Use your database library\'s placeholders ($1, ?, or a sql`` tag) instead of pasting values in.'],
      fixPrompt: 'Security fix: {file} line {line} builds SQL by inserting values into the query string. Rewrite it (and any similar queries) to use parameterized queries / placeholders from the library already in use, so user input is never part of the SQL text.',
    },
    {
      id: 'code.supabase-filter-injection', category: 'code', severity: 'medium', skipComments: true,
      when: (f, ctx) => codeWhen(f) && ctx.stack.services.indexOf('supabase') !== -1,
      re: /\.(?:or|filter|textSearch)\(\s*`[^`]{0,300}?\$\{/g,
      title: 'Search filter built from raw user text',
      plain: '{file} line {line} puts a variable straight into a Supabase .or()/.filter() string.',
      risk: 'A user can type commas and operators to change the filter and see rows they shouldn\'t (though RLS still applies).',
      fix: ['Use .eq()/.ilike() with the value as a separate argument, or strip commas, parentheses and dots from the input first.'],
      fixPrompt: 'In {file} line {line}, the Supabase filter string includes a raw variable. Use .eq()/.ilike() with the value as a separate argument, or strip commas, parentheses and dots from user input before building the filter.',
    },
    {
      id: 'code.tls-disabled', category: 'code', severity: 'medium', skipComments: true, when: codeWhen,
      re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\bverify\s*=\s*False\b/g,
      title: 'Security certificate checks are turned off',
      plain: '{file} line {line} skips the check that proves a server is who it says it is.',
      risk: 'Someone on the same network could read or change your app\'s traffic, including keys.',
      fix: ['Remove the setting that disables certificate verification and fix the underlying connection problem instead.'],
      fixPrompt: 'Remove the code in {file} line {line} that disables TLS certificate verification, and fix the underlying connection problem properly (tell me what it was).',
    },
  ];

  /* ------------------------------------------------------------------ *
   * Deps rules (paid/AI endpoints without auth or rate limits)
   * ------------------------------------------------------------------ */
  const depsRules = [
    {
      id: 'deps.paid-endpoint-no-auth', category: 'deps',
      run(ctx) {
        return ctx.files.filter((f) => ctx.fileCtx(f) === 'server').map((f) => {
          const kinds = [];
          if (AI_RE.test(f.text)) kinds.push('ai');
          if (SEND_RE.test(f.text)) kinds.push('send');
          if (PAY_RE.test(f.text)) kinds.push('pay');
          if (!kinds.length || AUTH_RE.test(f.text)) return null;
          const what = kinds.indexOf('ai') !== -1 ? 'calls a paid AI model' : kinds.indexOf('send') !== -1 ? 'sends email or texts' : 'creates payments';
          const sev = kinds.indexOf('ai') !== -1 || kinds.indexOf('send') !== -1 ? 'high' : 'medium';
          const route = (ctx.map.apiRoutes.find((r) => r.file === f.path) || {}).route || f.path;
          return { file: f.path, line: 0, key: f.path + ':auth', severity: sev, vars: { what, route } };
        }).filter(Boolean);
      },
      title: 'Endpoint that {what} doesn\'t check who\'s calling',
      plain: '{route} ({file}) {what}, but we couldn\'t find a login check in that file.',
      risk: 'Anyone who finds the URL can call it in a loop and run up your bill, or use it to spam people.',
      fix: ['Check the user\'s login at the top of the function and return 401 if there isn\'t one.', 'Then add a per-user limit (see the rate-limit finding).'],
      fixPrompt: 'Security fix: {route} in {file} {what} but doesn\'t verify the caller. At the very start of the handler, verify the logged-in user (for Supabase: read the Authorization header and call supabase.auth.getUser(); for Next.js: use the existing auth helper) and return 401 if there\'s no valid user. Don\'t change what the endpoint does otherwise.',
    },
    {
      id: 'deps.paid-endpoint-no-rate-limit', category: 'deps', severity: 'medium',
      run(ctx) {
        return ctx.files.filter((f) => ctx.fileCtx(f) === 'server').map((f) => {
          const isAiOrSend = AI_RE.test(f.text) || SEND_RE.test(f.text);
          if (!isAiOrSend || !AUTH_RE.test(f.text) || RATE_RE.test(f.text)) return null;
          const what = AI_RE.test(f.text) ? 'calls a paid AI model' : 'sends email or texts';
          const route = (ctx.map.apiRoutes.find((r) => r.file === f.path) || {}).route || f.path;
          return { file: f.path, line: 0, key: f.path + ':rate', vars: { what, route } };
        }).filter(Boolean);
      },
      title: 'No usage limit on {route}',
      plain: '{route} {what} for any logged-in user with no limit on how often.',
      risk: 'One user (or one stolen account) can call it thousands of times and drain your credits.',
      fix: ['Limit each user to a sensible number of calls per minute and per day.', 'Set a monthly spending cap in the AI provider\'s dashboard as a safety net.'],
      fixPrompt: 'Add rate limiting to {route} in {file}: allow each user at most 10 requests per minute and 200 per day (store counts in the database I already use, or Upstash if available), and return 429 with a friendly message when over the limit. Also tell me where to set a monthly spend limit with the provider.',
    },
    {
      id: 'deps.stripe-webhook-unverified', category: 'deps', severity: 'high',
      run(ctx) {
        return ctx.files.filter((f) => ctx.fileCtx(f) === 'server').map((f) => {
          if (!/["'](?:checkout\.session\.completed|customer\.subscription\.(?:created|updated|deleted)|invoice\.(?:paid|payment_succeeded)|payment_intent\.succeeded)["']/.test(f.text)) return null;
          if (/constructEvent(?:Async)?\s*\(/.test(f.text)) return null;
          return { file: f.path, line: 0, key: f.path + ':webhook' };
        }).filter(Boolean);
      },
      title: 'Stripe webhook doesn\'t verify it\'s really Stripe',
      plain: '{file} reacts to payment events but never checks Stripe\'s signature.',
      risk: 'Anyone can send a fake "payment succeeded" message and get paid features for free.',
      fix: ['Verify every event with stripe.webhooks.constructEvent (or constructEventAsync on Deno/Edge) using the raw request body and STRIPE_WEBHOOK_SECRET.'],
      fixPrompt: 'Security fix: the Stripe webhook in {file} doesn\'t verify signatures. Read the raw request body and the stripe-signature header, call stripe.webhooks.constructEventAsync (Edge/Deno) or constructEvent (Node) with STRIPE_WEBHOOK_SECRET, and return 400 if verification fails, before handling any event.',
    },
    {
      id: 'deps.client-controlled-price', category: 'deps', severity: 'high',
      when: (f, ctx) => ctx.fileCtx(f) === 'server' && PAY_RE.test(f.text),
      re: /\b(?:unit_amount|amount|price)\s*:\s*(?:Number\(|parseInt\(|parseFloat\()?\s*(?:req\.body|body|data|payload|params|input|json)\??\.(\w+)/g,
      check: (m) => !/price_?id/i.test(m[1]),
      title: 'Customers can set their own price',
      plain: '{file} line {line} takes the payment amount from what the browser sends.',
      risk: 'Anyone can edit the request and pay $0.01 for anything.',
      fix: ['Look up the price on the server (from your database or a Stripe Price ID) instead of trusting the browser.'],
      fixPrompt: 'Security fix: {file} line {line} uses an amount sent by the client. Change it so the client only sends a product/price ID, and the server looks up the real price (Stripe Price ID or my database) and rejects unknown IDs.',
    },
  ];

  VC.data.scanRules = [].concat(secretRules, dbRules, configRules, codeRules, depsRules);
})();
