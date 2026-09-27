# Vibe Check — Architecture & Contracts

This file is the **single source of truth** for how the app's parts fit together. Every module must follow it exactly.

## Ground rules

- **No build step, no ES modules.** Every file is a classic `<script>` wrapped in an IIFE: `(function(){ 'use strict'; const VC = window.VC; ... })();`. The app must work by double-clicking `index.html` (a `file://` URL), so do **not** use `import`/`export`, `fetch()` of local files, or Web Workers.
- Script load order is fixed in `index.html`: core → ai → data/* → engine/* → views/* → app. Data files must not depend on engines, and engines must not touch the DOM. Views may use everything. **Don't edit `index.html`.**
- Everything hangs off `window.VC`:
  - data → `VC.data.*`
  - engines → `VC.engine.*`
  - views → `VC.registerView(...)`
- **Audience: non-technical people.** Every screen uses plain English and explains jargon with `VC.ui.term('API key')`. Each step shows the one next action. Be friendly and short, not cutesy.
- **Security of the app itself:**
  - Render with `VC.html\`\``, which escapes every interpolation automatically.
  - Never put user, AI, or file content into `VC.raw()`. Use `VC.raw` only for strings you wrote yourself.
  - Never use `innerHTML` with unescaped strings. Use `VC.mount(el, html\`...\`)`.
- **API keys are never persisted in the project object.** The Setup wizard keeps pasted service keys in memory only (a module-level variable) and says so. The one exception is the user's own AI key: `VC.ai.setKey` stores it in `sessionStorage` by default, or `localStorage` only if the user explicitly checks "Remember on this device" in Settings — always disclosed, never silent, and still never written into a `project` object.
- **Offline first.** Every feature works without an AI key. When `VC.ai.enabled()`, the AI-powered paths are optional upgrades, and each falls back to the offline result if the AI call throws (show a toast with the error message).
- **Styling:** use only the classes in `css/styles.css` (vocabulary below) plus inline `style=""` for one-off spacing. Don't add stylesheets.

## Core API (js/core.js)

```js
VC.html`...`            // safe template → SafeHTML. Interpolate strings, numbers, arrays, nested html``.
VC.raw(str)             // trust a string you wrote (e.g. icons). NEVER user/AI/file content.
VC.mount(el, safeHtml)  // el.innerHTML = safe
VC.esc(str)
VC.delegate(root, 'click', '[data-action="save"]', (e, el) => {})   // event delegation
VC.uid('prefix'), VC.clone(obj), VC.debounce(fn, ms), VC.estimateTokens(text), VC.slug(s), VC.titleCase(s)
VC.formatDate(ts), VC.nextFrame(), VC.sleep(ms)
VC.copyText(text) -> Promise<bool>
VC.download(filename, textOrBlob, mime?)
VC.on(evt, fn) / VC.emit(evt, payload)
VC.storage.get/set/remove(key)    // localStorage, never throws
VC.db.get/set/del(key)            // IndexedDB key/value (async), memory fallback
VC.store.active()                 // active project or null
VC.store.create(idea)             // new project, becomes active
VC.store.update(p => { ... })     // mutate active project + persist
VC.store.projects(), VC.store.setActive(id), VC.store.remove(id), VC.store.settings(), VC.store.setSetting(k, v)
VC.store.exportAll() / importAll(json) / resetAll()
VC.icon(name, size?)   // SafeHTML <svg>. Names: home idea kit key prompt shield map rocket settings copy check x info warn
                       // danger success sparkles download upload folder file external arrow back plus trash refresh lock
                       // unlock eye menu bolt coin life wand list user db globe code
VC.glossary            // { 'api key': 'plain-English definition', ... }
VC.go('kit', {tab:'x'})   // navigate to #/kit?tab=x
VC.render()               // re-render the current view
```

### UI helpers (return SafeHTML)
```js
VC.ui.pageHead({eyebrow, title, lead, actions})
VC.ui.codeBlock(text, {title, filename, download, copyLabel, className})   // dark block with Copy (+ Download if filename)
VC.ui.copyButton(text, label?, cls?)
VC.ui.callout('info'|'success'|'warn'|'danger'|'accent', content, icon?)
VC.ui.badge(text, 'green'|'yellow'|'red'|'blue'|'accent'|'gray')
VC.ui.empty({title, body, actionLabel, actionHref, icon})
VC.ui.term('API key')          // dotted underline + hover definition from VC.glossary
VC.ui.spinner(label), VC.ui.meter(pct, color)
VC.ui.difficultyBadge('easy'|'medium'|'hard'), VC.ui.severityBadge('critical'|'high'|'medium'|'low'|'info')
VC.ui.visibilityBadge('public'|'secret')
VC.ui.toast(msg, 'success'|'error'?)
VC.ui.modal({title, body, actions:[{label, primary, danger, onClick(close) -> false keeps open}], wide}) -> {el, close}
VC.ui.confirm(title, message, okLabel) -> Promise<bool>
```

### Views
```js
VC.registerView({
  id: 'kit',                 // route #/kit
  title: 'Build Kit',        // page title and nav label (navTitle overrides the nav label)
  icon: 'kit',
  nav: { group: 'journey', order: 2 },   // 'journey' = numbered steps; 'tools' = secondary; omit for hidden
  status(project) { return project.kit ? 'done' : 'todo'; },
  render(el, ctx) { /* ctx = { project, params, go, rerender } */ },
});
```
`render` gets a **fresh** `el` every time (old listeners are discarded), so you can re-render freely with `ctx.rerender()` or call `VC.mount(el, …)` again. Attach listeners to `el` with `VC.delegate`. Data that should survive a re-render but must **not** be persisted (e.g. pasted API keys, current scan) goes in module-level variables.

Journey order: `idea`(1) → `kit`(2) → `setup`(3) → `prompts`(4) → `scan`(5) → `ship`(6). Tools: `map`(1), `settings`(9). `home` has no nav group; it's shown at the top automatically.

### AI (js/ai.js)
```js
VC.ai.enabled() -> bool
VC.ai.json({system, prompt, schema, maxTokens?, effort?}) -> Promise<object>  // schema = JSON Schema; objects auto-made strict
VC.ai.text({system, prompt, maxTokens?, effort?}) -> Promise<string>
VC.ai.redact(text)   // strips secrets (auto-applied to prompts)
```
Errors come back as friendly `Error` messages: show them with `VC.ui.toast(err.message, 'error')` and fall back to offline. For AI calls, show a spinner and disable the button.

JSON Schema limits for structured outputs: use `type`, `properties`, `items`, `enum`, and `description` only. Don't use `minItems`, `maxItems`, `pattern`, or `format`; state counts in the prompt instead.

## CSS vocabulary (css/styles.css)

- **Layout:** `.view` (set by the router) · `.view.narrow` (add via `el.classList.add('narrow')`) · `.page-head` · `.section` · `.section-head` · `.stack` (`.sm`/`.lg`) · `.row` (`.sm`, `.top`) · `.spread` · `.grow` · `.grid-2` · `.grid-3` · `.grid-4`
- **Text:** `.muted` · `.text-2` · `.small` · `.tiny` · `.bold` · `.mono` · `.break` · `.center` · `.mt` · `.mb` · `.mt-0` · `.mb-0` · `.gradient-text`
- **Cards:** `.card` (`.flat`, `.soft`, `.pad-lg`, `.selectable`, `.selected`) · `.card-head` · `.card-foot`
- **Buttons:** `.btn` (`.primary`, `.ghost`, `.danger`, `.sm`, `.lg`, `.block`)
- **Chips and badges:** `.chip` / `.chip.on` (toggle choices) · `.badge` (`.green`, `.yellow`, `.red`, `.blue`, `.accent`, `.gray`) · `.dot` (`.green`, `.yellow`, `.red`)
- **Forms:** `.field` > `label` + `input`/`textarea`/`select` + `.hint` · `input.big` · `input.mono` · `.input-ok` · `.input-bad` · `.check` (label wrapping a checkbox) · `.option-group`
- **Callouts:** `.callout` (`.success`, `.warn`, `.danger`, `.accent`); prefer `VC.ui.callout`
- **Code:** `.code` + `.code-head` + `pre`; prefer `VC.ui.codeBlock`
- **Navigation within a page:** `.tabs` > `button.tab` (`.active`) · `details.acc` > `summary` + `.acc-body`
- **Lists:** `ul.checklist` > `li` > `label.check` (`.is-done`) with `.check-title` · `ol.numbered` (circled step numbers) · `dl.kv` (key/value)
- **Data display:** `.meter` > `span` · `.grade.A`–`.grade.F` · `.stat` > `.stat-value` + `.stat-label` · `.table-wrap` > `table`
- **States:** `.empty` · `.loading` · `.spinner`
- **Scan and map:** `.dropzone` (`.over`) · `.diagram` (wraps an inline SVG) · `.term`
- **Wireframe sketch** (for direction cards): `.wire` containing `.wire-b` blocks (`.nav`, `.hero`, `.btn`, `.tall`, `.row` > `i`×N) and `.wire-label`
- **Home:** `.hero`

## Data contracts

### Categories — `VC.data.categories` (js/data/categories.js)
An array, in display order. Fixed IDs:

`hosting, database, auth, payments, ai, email, storage, maps, sms, analytics, monitoring, realtime, media`

```js
{ id: 'auth', name: 'Logins & accounts', icon: 'user', question: 'Do people need to sign up and log in?', plain: 'Lets people create an account, log in, and reset their password.' }
```

### Services — `VC.data.services` (js/data/services.js)
Fixed IDs (all of these must exist):

`supabase, firebase, clerk, stripe, lemonsqueezy, anthropic, openai, replicate, elevenlabs, resend, cloudinary, uploadthing, mapbox, google-maps, twilio, posthog, sentry, vercel, netlify, github`

```js
{
  id: 'supabase', name: 'Supabase', tagline: 'Database, logins and file storage in one place',
  categories: ['database', 'auth', 'storage', 'realtime'],     // categories it can cover
  website: 'https://supabase.com', signupUrl: '...', dashboardUrl: '...', docsUrl: '...',
  freeTier: 'Plain-English free-tier summary', paidFrom: '$25/mo',
  monthlyCost: { low: 0, high: 25 },                           // USD for a small new app
  difficulty: 'easy' | 'medium' | 'hard',
  bestFor: 'one sentence', whyPick: 'one sentence a beginner understands',
  builderSupport: { lovable: 'native'|'easy'|'manual', bolt: ..., replit: ..., v0: ..., cursor: ..., 'claude-code': ... },
  keys: [{
    id: 'anon', label: 'Anon (public) key',
    env: { vite: 'VITE_SUPABASE_ANON_KEY', next: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', node: 'SUPABASE_ANON_KEY', expo: 'EXPO_PUBLIC_SUPABASE_ANON_KEY' },
    visibility: 'public' | 'secret',
    format: { regex: '^eyJ...', example: 'eyJhbGciOi…', hint: 'Starts with eyJ and is very long' },   // regex = JS source string, no slashes
    where: 'Dashboard → Project Settings → API → anon public',
    note: 'Safe in your app ONLY if Row Level Security is on for every table.'
  }],
  steps: [{ title: 'Create a free account', detail: 'plain English', url: 'https://…' }],   // how to get the keys, 4–8 steps
  safety: ['Turn on Row Level Security for every table'],                                  // must-do rules
  gotchas: ['Common beginner mistake + how to avoid it'],
  promptSnippet: 'Use Supabase for auth and the database. Enable Row Level Security on every table…'   // pasted into build prompts
}
```

Rules for `env`:
- `vite` names use `VITE_`; `next` names use `NEXT_PUBLIC_` only for public keys; `expo` names use `EXPO_PUBLIC_` only for public keys.
- For **secret** keys, all four names are the plain server name (e.g. `STRIPE_SECRET_KEY`), because secrets must never get a public prefix.

### Builders — `VC.data.builders` (js/data/builders.js)
Fixed IDs: `lovable, bolt, replit, v0, cursor, claude-code`
```js
{
  id: 'lovable', name: 'Lovable', url: 'https://lovable.dev', tagline: '...',
  bestFor: 'one sentence', skill: 'beginner' | 'intermediate' | 'advanced',
  pricing: 'Free tier; paid from $X/mo',
  framework: 'vite' | 'next' | 'node' | 'expo' | 'any',  // selects keys[].env
  defaultStack: 'React + Vite + Tailwind + Supabase',
  nativeIntegrations: ['supabase', 'stripe', ...],        // service IDs with built-in connectors
  secrets: {
    publicKeys: ['step', 'step'],     // where public keys go in THIS tool
    secretKeys: ['step', 'step'],     // where secret keys go (e.g. Supabase Edge Function secrets for Lovable)
    envFile: true | false,            // does the user edit a .env file directly?
    envFileName: '.env.local' | '.env' | null,
    deployVars: ['where to set env vars when going live'],
  },
  contextFile: { name: 'Project Knowledge', filename: null | 'CLAUDE.md' | '.cursor/rules/project.mdc', how: 'Where to paste the project brief' },
  tokenTips: ['builder-specific ways to spend fewer credits'],
  strengths: [...], weaknesses: [...],
  versionControl: 'how to save/undo work in this tool (GitHub sync, checkpoints, git)',
}
```

### Archetypes — `VC.data.archetypes` (js/data/archetypes.js)
Offline templates used to turn an idea into directions. Aim for at least 16, covering: marketplace, saas-dashboard, social-community, booking-scheduling, ai-tool, ecommerce-store, tracker-crm, content-blog, education-course, portfolio-landing, directory-listing, chat-messaging, fitness-health, finance-budget, music-creator, event-ticketing, internal-tool, game-fun, job-board, recipe-food (more is fine).
```js
{
  id: 'tracker-crm', name: 'Tracker / CRM', keywords: ['track', 'log', 'crm', 'clients', 'leads', 'manage', ...],
  variants: [   // 3–4 distinct "directions" this archetype can take
    { key: 'simple', nameTemplate: '{Thing} Tracker', pitchTemplate: 'The simplest way to track {thing} — …',
      audience: '...', features: ['...', ...], difficulty: 'easy', needs: ['database', 'auth'],
      screens: [{ name: 'Dashboard', blocks: ['nav', 'hero', 'row3', 'list'] }],
      vibe: 'Clean, calm, lots of white space' }
  ]
}
```
Allowed wireframe `blocks`: `nav, hero, row2, row3, list, form, chart, table, chat, map, player, calendar, button, tall, grid`.

## Project data model (the object `VC.store.active()` returns)
```js
{
  id, name, idea, createdAt, updatedAt,
  answers: {
    builder: 'lovable'|'bolt'|'replit'|'v0'|'cursor'|'claude-code'|'unsure',
    accounts: 'yes'|'no'|'unsure',
    payments: 'none'|'one-time'|'subscription'|'marketplace',
    platform: 'web'|'mobile'|'both',
    budget: 'free'|'low'|'flexible',
    experience: 'never'|'some'|'shipped',
    ai: 'yes'|'no'|'unsure'      // does the app itself need AI features?
  },
  directions: [Direction],
  chosenDirection: Direction | null,
  kit: Kit | null,
  setup: { progress: { [serviceId]: { steps: { [index]: true }, done: bool } } },
  prompts: { done: { [milestoneId]: true } },
  scans: [ScanSummary],     // newest first, max 10
  ship: { checked: { [itemId]: true } },
}
```

### Direction
```js
{
  id: 'd_xxx', name: 'BeatVault', pitch: 'one line', audience: 'who it is for',
  features: ['5–7 short feature phrases'],
  difficulty: 'easy'|'medium'|'hard', monthlyCost: 'Free to start' | '~$25/mo',
  needs: ['database', 'auth', 'payments', ...],      // category IDs
  archetypeId: 'tracker-crm' | 'custom',
  screens: [{ name: 'Home', blocks: ['nav', 'hero', 'row3'] }],   // 2–4 screens
  vibe: 'look and feel in a few words',
  source: 'offline' | 'ai'
}
```
A "mix" is a Direction built by the idea view from the features the user picked. It gets `archetypeId` from its main direction and a merged `needs`.

### Kit — `VC.engine.kit.build(project) -> Kit`
```js
{
  builder: { id: 'lovable', reason: 'why this tool for THIS project', alternatives: ['bolt', 'cursor'] },
  framework: 'vite'|'next'|'node'|'expo',
  services: [{ category: 'auth', serviceId: 'supabase', reason: '...', required: true, alternatives: ['clerk', 'firebase'] }],
  milestones: [{ id: 'm1', title: 'Accounts & login', goal: 'plain English', features: ['...'], doneWhen: ['testable check', ...], services: ['supabase'], size: 'S'|'M'|'L' }],  // 5–8, in build order
  cost: { monthlyLow: 0, monthlyHigh: 45, lines: [{ label: 'Supabase', amount: 'Free', note: 'until ~50k users' }], buildNote: 'Expect ~X–Y prompts…' },
  safetyRules: ['...'],     // project-specific rules injected into every prompt
  generatedAt: ts
}
```
A service covering several categories (Supabase = database + auth + storage) appears once per category, with the same `serviceId`. Setup and prompts **dedupe by serviceId**.

## Engines

- `VC.engine.directions`:
  - `offline(idea, answers) -> Direction[]`: 3–4 directions.
  - `async generate(idea, answers) -> Direction[]`: uses AI if enabled, otherwise `offline`. Falls back to `offline` on error, then rethrows so the view can toast.
  - `ideaName(idea) -> string`: a short project name.
- `VC.engine.kit`:
  - `build(project) -> Kit`
  - `uniqueServices(kit) -> Service[]`: deduped, with data from `VC.data.services`.
  - `builder(kit) -> Builder`
  - `envName(key, framework) -> string`
- `VC.engine.prompts` (all offline, deterministic):
  - `brief(project) -> string`: the project brief / context file (markdown).
  - `contextFile(project) -> {filename, name, how, content}`
  - `starterPrompt(project) -> string`
  - `milestonePrompt(project, milestone) -> string`
  - `improve(text, project?) -> {improved, changes: [string], before: tokens, after: tokens}`
  - `async improveAI(text, project)`
  - `stuck({goal, error, tried}, project?) -> string`
  - `tokenTips(project?) -> [{title, detail}]`
- `VC.engine.scanner`:
  - `async readInput(dataTransferOrFileList) -> VFile[]`
  - `async scan(vfiles, onProgress) -> ScanResult`
  - `summarize(result) -> ScanSummary`
  - `diff(prevResult, nextResult) -> {added: Finding[], fixed: Finding[], filesChanged: n, filesAdded: n, filesRemoved: n}`
  - `report(result) -> markdown string`

### Scanner types
```js
VFile = { path: 'src/App.tsx', size: 1234, text: '...' }        // only text files ≤ 1.5 MB; binaries/skipped dirs excluded
ScanResult = {
  id, createdAt, projectName, fileCount, skippedCount, totalBytes,
  findings: [Finding], score: 0–100, grade: 'A'|'B'|'C'|'D'|'F',
  counts: { critical, high, medium, low, info },
  stack: { frameworks: ['Next.js'], services: ['supabase', 'stripe'], languages: ['TypeScript'] },
  map: { pages: [{route, file}], apiRoutes: [{route, file, methods}], tables: [{name, rls: true|false|null, file}], services: [{id, name, files: [..]}], envVars: [{name, files: [..], public: bool}] },
  fileHashes: { [path]: 'hash' }
}
Finding = {
  id, ruleId, severity: 'critical'|'high'|'medium'|'low'|'info', category: 'secrets'|'database'|'config'|'code'|'deps',
  title: 'Short plain-English title',
  plain: 'What is wrong, in one or two sentences',
  risk: 'What someone could do with it',
  fix: ['step', 'step'],
  fixPrompt: 'Paste-ready prompt for the AI builder',
  file: 'path', line: 12, snippet: 'redacted snippet'    // snippets must never contain the full secret
}
ScanSummary = { id, createdAt, grade, score, counts, fileCount }
```
Store full ScanResults in `VC.db` under `scan:<id>`, and the latest one under `scan:latest`. Store only the summaries in `project.scans`.
