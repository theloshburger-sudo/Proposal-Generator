/* Vibe Check — Safety Scan engine (VC.engine.scanner).
   Reads a dropped folder or .zip, runs VC.data.scanRules against it entirely
   offline (no Worker: the app must run from a file:// URL), and returns a
   plain-English report card. Yields to the browser on a time budget so big
   projects don't freeze the tab.
   See docs/ARCHITECTURE.md → Engines → VC.engine.scanner, and Scanner types. */
(function () {
  'use strict';
  const VC = window.VC;
  VC.engine = VC.engine || {};

  const arr = (v) => (Array.isArray(v) ? v : []);
  const uniq = (a) => a.filter((v, i) => v != null && a.indexOf(v) === i);

  /* ------------------------------------------------------------------ *
   * Limits
   * ------------------------------------------------------------------ */
  const MAX_FILE_BYTES = 1.5 * 1024 * 1024;
  const MAX_FILES = 5000;
  const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
  const YIELD_MS = 12;
  const MAX_PER_RULE = 25;
  const MAX_FINDINGS = 300;
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', '.nuxt', '.svelte-kit', '.output', '.vercel', '.netlify', '.turbo', '.cache', 'coverage', '__pycache__', '.venv', 'venv', 'vendor', 'bower_components', '.expo', 'Pods', '.idea', '__MACOSX']);
  const TEXT_EXT = /\.(?:[mc]?[jt]sx?|vue|svelte|astro|html?|css|scss|sass|less|json|jsonc|ya?ml|toml|md|mdx|txt|sql|py|rb|go|php|java|kt|swift|dart|rs|sh|prisma|graphql|gql|rules|xml|ini|conf|cfg|env)$/i;
  const TEXT_NAMES = /^(?:\.env(?:\..+)?|\.gitignore|Dockerfile|Procfile|Makefile|\.npmrc|_headers|_redirects)$/;
  const SKIP_FILES = /^(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Gemfile\.lock|poetry\.lock|\.DS_Store)$|\.min\.map$|\.map$/;

  /* ------------------------------------------------------------------ *
   * Small utilities
   * ------------------------------------------------------------------ */
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
  }
  let lastYield = 0;
  async function maybeYield() {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (now - lastYield > YIELD_MS) { await VC.nextFrame(); lastYield = (typeof performance !== 'undefined' ? performance.now() : Date.now()); }
  }
  function fillTemplate(str, vars) {
    return String(str == null ? '' : str).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
  }
  function render(tmpl, vars) { return typeof tmpl === 'function' ? tmpl(vars) : fillTemplate(tmpl, vars); }
  function isMinified(f) {
    if (/\.min\.(?:js|css)$/i.test(f.path)) return true;
    const lines = f.text.split('\n').length;
    return f.text.length > 20000 && f.text.length / lines > 400;
  }

  /* ------------------------------------------------------------------ *
   * Reading the input: a dropped folder, a .zip, or a webkitdirectory FileList
   * ------------------------------------------------------------------ */
  function accept(path, size, meta) {
    const base = path.split('/').pop() || path;
    if (path.split('/').some((seg) => SKIP_DIRS.has(seg))) {
      const dir = path.split('/').find((seg) => SKIP_DIRS.has(seg));
      meta.ignoredDirs.add(dir);
      if (dir === '.git') meta.sawGit = true;
      return false;
    }
    if (SKIP_FILES.test(base)) { meta.skippedCount++; return false; }
    if (!TEXT_EXT.test(base) && !TEXT_NAMES.test(base)) { meta.skippedCount++; return false; }
    if (size > MAX_FILE_BYTES) { meta.skippedCount++; return false; }
    if (meta.count >= MAX_FILES) { meta.truncated = true; return false; }
    return true;
  }

  function cleanText(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const sample = text.slice(0, 8000);
    if (sample.indexOf('\u0000') !== -1) return null;
    let bad = 0;
    for (let i = 0; i < sample.length; i++) if (sample.charCodeAt(i) === 0xfffd) bad++;
    if (sample.length && bad / sample.length > 0.01) return null;
    return text.replace(/\r\n/g, '\n');
  }

  async function walk(entry, meta, out, depth) {
    if (depth > 30) return;
    if (entry.isDirectory) {
      if (SKIP_DIRS.has(entry.name)) { meta.ignoredDirs.add(entry.name); if (entry.name === '.git') meta.sawGit = true; return; }
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        for (let i = 0; i < batch.length; i++) { await walk(batch[i], meta, out, depth + 1); await maybeYield(); }
      } while (batch.length);
    } else if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (!file) return;
      const path = entry.fullPath.replace(/^\//, '');
      if (path.split('/').indexOf('.git') !== -1) { meta.sawGit = true; }
      if (!accept(path, file.size, meta)) return;
      const text = cleanText(await file.text().catch(() => ''));
      if (text == null) { meta.skippedCount++; return; }
      meta.count++;
      meta.totalBytes += file.size;
      out.push({ path, size: file.size, text });
    }
  }

  async function readZip(file, meta, out) {
    if (!window.JSZip) throw new Error('ZIP support didn\'t load. Unzip the file and drop the folder instead.');
    let zip;
    try { zip = await window.JSZip.loadAsync(file); } catch (e) { throw new Error('That .zip couldn\'t be opened. Try unzipping it and dropping the folder instead.'); }
    const names = Object.keys(zip.files);
    for (let i = 0; i < names.length; i++) {
      const entry = zip.files[names[i]];
      if (entry.dir) continue;
      const path = entry.name.replace(/^\.?\//, '');
      /* ponytail: JSZip has no public sync size accessor; _data.uncompressedSize is
         an internal field used only as a cheap pre-read estimate (0 if ever renamed).
         Real bytes are measured below once a file is read, so the 50MB budget still
         holds even when the estimate is wrong. */
      const estSize = (entry._data && entry._data.uncompressedSize) || 0;
      meta.totalBytes += estSize;
      if (meta.totalBytes > MAX_TOTAL_BYTES) { meta.truncated = true; break; }
      if (path.split('/').indexOf('.git') !== -1) meta.sawGit = true;
      if (!accept(path, estSize, meta)) continue;
      let raw;
      try { raw = await entry.async('string'); } catch (e) { meta.skippedCount++; continue; }
      const text = cleanText(raw);
      if (text == null) { meta.skippedCount++; continue; }
      const size = estSize || new Blob([raw]).size;
      if (size !== estSize) {
        meta.totalBytes += size - estSize;
        if (meta.totalBytes > MAX_TOTAL_BYTES) { meta.truncated = true; break; }
      }
      meta.count++;
      out.push({ path, size, text });
      await maybeYield();
    }
  }

  function commonPrefix(paths) {
    if (!paths.length) return '';
    const first = paths[0].split('/')[0];
    return paths.every((p) => p.split('/')[0] === first) ? first : '';
  }

  async function readInput(input) {
    const meta = { ignoredDirs: new Set(), sawGit: false, skippedCount: 0, totalBytes: 0, count: 0, truncated: false, projectName: '', source: 'files' };
    const out = [];

    let items = null;
    if (input && input.items) {
      const fileItems = Array.prototype.slice.call(input.items).filter((i) => i.kind === 'file');
      const dropped = fileItems.length === 1 ? fileItems[0].getAsFile() : null;
      if (dropped && /\.zip$/i.test(dropped.name)) {
        meta.source = 'zip';
        await readZip(dropped, meta, out);
        meta.projectName = dropped.name.replace(/\.zip$/i, '');
      } else {
        items = fileItems.map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null) || { isFile: true, file: (cb) => cb(i.getAsFile()), fullPath: '/' + (i.getAsFile() ? i.getAsFile().name : 'file') });
      }
    } else if (input instanceof FileList || Array.isArray(input)) {
      const files = Array.prototype.slice.call(input);
      if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
        meta.source = 'zip';
        await readZip(files[0], meta, out);
        meta.projectName = files[0].name.replace(/\.zip$/i, '');
      } else {
        meta.source = 'folder';
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
          if (path.split('/').indexOf('.git') !== -1) meta.sawGit = true;
          if (!accept(path, f.size, meta)) continue;
          const text = cleanText(await f.text().catch(() => ''));
          if (text == null) { meta.skippedCount++; continue; }
          meta.count++;
          meta.totalBytes += f.size;
          out.push({ path, size: f.size, text });
          await maybeYield();
        }
      }
    } else if (input instanceof File) {
      if (/\.zip$/i.test(input.name)) {
        meta.source = 'zip';
        await readZip(input, meta, out);
        meta.projectName = input.name.replace(/\.zip$/i, '');
      } else {
        items = [{ isFile: true, file: (cb) => cb(input), fullPath: '/' + input.name }];
      }
    }

    if (items) {
      meta.source = meta.source === 'files' ? 'folder' : meta.source;
      for (let i = 0; i < items.length; i++) await walk(items[i], meta, out, 0);
    }

    /* A zip made from a project folder ("repo-main/" inside the archive, the
       GitHub download and Finder "Compress" shape) has one wrapper dir; strip
       it so paths read like the folder input's and route rules still match. */
    const prefix = commonPrefix(out.map((f) => f.path));
    if (prefix) { out.forEach((f) => { f.path = f.path.slice(prefix.length + 1) || f.path; }); meta.projectName = prefix; }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    out.meta = meta;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * File context: env / server / client / other
   * ------------------------------------------------------------------ */
  function fileCtx(f, stack) {
    const base = f.path.split('/').pop() || f.path;
    if (/^\.env(?:\.[\w.-]+)?$/.test(base) && !/\.(?:example|sample|template|dist|defaults)$/i.test(base)) return 'env';
    const head = f.text.slice(0, 2000);
    if (/(?:^|\/)(?:api|server|backend|functions|lambda|workers?)\/|(?:^|\/)pages\/api\/|(?:^|\/)app\/(?:.*\/)?route\.[jt]s$|\.server\.[jt]sx?$|(?:^|\/)middleware\.[jt]s$|(?:^|\/)supabase\/functions\/|(?:^|\/)netlify\/functions\/|\.(?:py|rb|go|php|java|kt|rs|cs)$/.test(f.path)) return 'server';
    if (/^\s*["']use server["']|from\s+["'](?:express|fastify|koa|hono|next\/server|server-only|firebase-admin[^"']*|firebase-functions[^"']*)["']|require\(\s*["'](?:express|fastify|koa|firebase-admin|firebase-functions)["']\)|\bDeno\.serve\s*\(|\bserve\(\s*async/m.test(head)) return 'server';
    if (/^\s*["']use client["']/m.test(head)) return 'client';
    if (stack && stack.frameworks.indexOf('Next.js') !== -1 && /(?:^|\/)app\//.test(f.path)) return 'other';
    if (/\.(?:html?|vue|svelte|astro)$|(?:^|\/)(?:public|static)\/|(?:^|\/)src\//.test(f.path)) return 'client';
    if (/import\.meta\.env\.VITE_|from\s+["']react-dom/.test(f.text)) return 'client';
    return 'other';
  }

  function lineOf(f, idx) {
    if (!f._lineStarts) {
      const starts = [0];
      for (let i = 0; i < f.text.length; i++) if (f.text[i] === '\n') starts.push(i + 1);
      f._lineStarts = starts;
    }
    const starts = f._lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    const n = lo + 1;
    const end = f.text.indexOf('\n', starts[lo]);
    return { n, text: f.text.slice(starts[lo], end === -1 ? f.text.length : end) };
  }
  function around(f, idx, nLines) {
    const start = Math.max(0, idx - 200 * nLines);
    const end = Math.min(f.text.length, idx + 200 * nLines);
    return f.text.slice(start, end);
  }

  /* ------------------------------------------------------------------ *
   * .gitignore
   * ------------------------------------------------------------------ */
  function globToRegex(pattern) {
    let neg = false;
    let p = pattern.trim();
    if (!p || p[0] === '#') return null;
    if (p[0] === '!') { neg = true; p = p.slice(1); }
    const dirOnly = /\/$/.test(p);
    if (dirOnly) p = p.slice(0, -1);
    const anchored = p.indexOf('/') !== -1 && p[0] !== '*';
    let re = p.replace(/[.+^${}()|[\]\\*?/]/g, '\\$&').replace(/\\\*\\\*/g, '.*').replace(/\\\*/g, '[^/]*').replace(/\\\?/g, '[^/]');
    re = anchored ? '^' + re.replace(/^\\\//, '') + (dirOnly ? '/' : '(?:/|$)') : '(?:^|/)' + re + (dirOnly ? '/' : '(?:/|$)');
    let compiled = null;
    try { compiled = new RegExp(re); } catch (e) { compiled = null; }
    return compiled ? { re: compiled, neg } : null;
  }
  function parseGitignores(files) {
    return files.filter((f) => /(?:^|\/)\.gitignore$/.test(f.path)).map((f) => ({
      dir: f.path.replace(/\.gitignore$/, '').replace(/\/$/, ''),
      patterns: f.text.split('\n').map(globToRegex).filter(Boolean),
    }));
  }
  function gitignoreCovers(gitignores, path) {
    let covered = false;
    gitignores.forEach((g) => {
      if (g.dir && path.indexOf(g.dir + '/') !== 0) return;
      const rel = g.dir ? path.slice(g.dir.length + 1) : path;
      g.patterns.forEach((p) => { if (p.re.test(rel)) covered = !p.neg; });
    });
    return covered;
  }

  /* ------------------------------------------------------------------ *
   * SQL: tables, RLS and policies
   * ------------------------------------------------------------------ */
  function tableName(raw) {
    let n = String(raw || '').replace(/"/g, '').toLowerCase();
    if (n.indexOf('.') !== -1) {
      const parts = n.split('.');
      if (parts[0] !== 'public') return null;
      n = parts[1];
    }
    return n || null;
  }
  function analyzeSql(files) {
    const tables = {};
    const used = {};
    const sqlFiles = files.filter((f) => /\.sql$/i.test(f.path)).sort((a, b) => (a.path < b.path ? -1 : 1));
    sqlFiles.forEach((f) => {
      const clean = f.text.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      let offset = 0;
      clean.split(';').forEach((stmt) => {
        const at = offset;
        offset += stmt.length + 1;
        const line = lineOf(f, at).n;
        let m;
        if ((m = stmt.match(/^\s*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/i))) {
          const t = tableName(m[1]);
          if (t && !tables[t]) tables[t] = { name: t, created: { file: f.path, line }, rls: false, rlsAt: null, policies: [] };
        } else if ((m = stmt.match(/^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?\w+"?\.)?"?\w+"?)\s+(enable|disable)\s+row\s+level\s+security/i))) {
          const t = tableName(m[1]);
          if (t) { tables[t] = tables[t] || { name: t, created: { file: f.path, line }, rls: false, policies: [] }; tables[t].rls = /enable/i.test(m[2]); tables[t].rlsAt = { file: f.path, line }; }
        } else if ((m = stmt.match(/^\s*create\s+policy\s+(?:"([^"]+)"|(\w+))\s+on\s+((?:"?\w+"?\.)?"?\w+"?)([\s\S]*)/i))) {
          const t = tableName(m[3]);
          if (t) {
            tables[t] = tables[t] || { name: t, created: { file: f.path, line }, rls: false, policies: [] };
            const body = m[4] || '';
            const cmdM = body.match(/\bfor\s+(all|select|insert|update|delete)\b/i);
            const cmd = cmdM ? cmdM[1].toLowerCase() : 'all';
            const open = /\busing\s*\(\s*\(?\s*true\s*\)?\s*\)|\bwith\s+check\s*\(\s*\(?\s*true\s*\)?\s*\)/i.test(body);
            tables[t].policies.push({ name: m[1] || m[2], cmd, open, file: f.path, line });
          }
        } else if ((m = stmt.match(/^\s*drop\s+policy\s+(?:if\s+exists\s+)?(?:"([^"]+)"|(\w+))\s+on\s+((?:"?\w+"?\.)?"?\w+"?)/i))) {
          const t = tableName(m[3]);
          const name = m[1] || m[2];
          if (t && tables[t]) tables[t].policies = tables[t].policies.filter((p) => p.name !== name);
        } else if ((m = stmt.match(/^\s*drop\s+table\s+(?:if\s+exists\s+)?((?:"?\w+"?\.)?"?\w+"?)/i))) {
          const t = tableName(m[1]);
          if (t) delete tables[t];
        }
      });
    });
    const fromRe = /(?<!storage\s*\.?\s*)\.from\(\s*["'`]([A-Za-z0-9_.-]+)["'`]\s*\)/g;
    files.forEach((f) => {
      if (/\.sql$/i.test(f.path)) return;
      let m;
      fromRe.lastIndex = 0;
      while ((m = fromRe.exec(f.text))) {
        const before = f.text.slice(Math.max(0, m.index - 60), m.index);
        if (/storage\s*\.?\s*$/.test(before)) continue;
        const n = m[1].toLowerCase();
        used[n] = used[n] || [];
        if (used[n].indexOf(f.path) === -1) used[n].push(f.path);
      }
    });
    return { tables, used };
  }

  /* ------------------------------------------------------------------ *
   * Stack + app map detection
   * ------------------------------------------------------------------ */
  const FRAMEWORKS = [
    ['Next.js', /^next$/, /(?:^|\/)next\.config\./],
    ['Remix', /^@remix-run\//, null],
    ['Astro', /^astro$/, /astro\.config\./],
    ['SvelteKit', /^@sveltejs\/kit$/, /svelte\.config\./],
    ['Nuxt', /^nuxt$/, /nuxt\.config\./],
    ['Angular', /^@angular\/core$/, /(?:^|\/)angular\.json$/],
    ['Expo', /^expo$/, null],
    ['React Native', /^react-native$/, null],
    ['Vue', /^vue$/, null],
    ['Svelte', /^svelte$/, null],
    ['React', /^react$/, null],
    ['Vite', /^vite$/, /vite\.config\./],
    ['Express', /^express$/, null],
    ['Fastify', /^fastify$/, null],
    ['Hono', /^hono$/, null],
    ['Tailwind CSS', /^tailwindcss$/, /tailwind\.config\./],
  ];
  const SERVICES = [
    ['supabase', /^@supabase\//, /@supabase\/|\.supabase\.co\b|SUPABASE_/],
    ['firebase', /^firebase(?:-admin|-functions)?$/, /firebase\/(?:app|firestore|auth|storage)|firebaseapp\.com|firebaseConfig|firebase-admin/],
    ['clerk', /^@clerk\//, /@clerk\/|CLERK_/],
    ['stripe', /^(?:stripe|@stripe\/.+)$/, /api\.stripe\.com|js\.stripe\.com|STRIPE_|from\s+["']stripe["']/],
    ['lemonsqueezy', /^@lemonsqueezy\//, /lemonsqueezy|LEMON_?SQUEEZY/i],
    ['anthropic', /^@anthropic-ai\/|^@ai-sdk\/anthropic$/, /@anthropic-ai\/|api\.anthropic\.com|ANTHROPIC_/],
    ['openai', /^openai$|^@ai-sdk\/openai$/, /from\s+["']openai["']|api\.openai\.com|OPENAI_/],
    ['replicate', /^replicate$/, /api\.replicate\.com|REPLICATE_/],
    ['elevenlabs', /^(?:elevenlabs|@elevenlabs\/.+)$/, /api\.elevenlabs\.io|ELEVEN(?:LABS)?_/],
    ['resend', /^resend$/, /api\.resend\.com|RESEND_|from\s+["']resend["']/],
    ['cloudinary', /cloudinary/, /res\.cloudinary\.com|CLOUDINARY_/],
    ['uploadthing', /uploadthing/, /UPLOADTHING_|uploadthing/],
    ['mapbox', /^(?:mapbox-gl|react-map-gl|@mapbox\/.+)$/, /api\.mapbox\.com|MAPBOX_|mapbox-gl/],
    ['google-maps', /^(?:@react-google-maps\/api|@googlemaps\/.+)$/, /maps\.googleapis\.com|GOOGLE_MAPS_/],
    ['twilio', /^twilio$/, /api\.twilio\.com|TWILIO_/],
    ['posthog', /^posthog-(?:js|node)$/, /posthog|POSTHOG_/i],
    ['sentry', /^@sentry\//, /@sentry\/|SENTRY_|ingest\.sentry\.io/],
    ['vercel', /^@vercel\//, /(?:^|\/)vercel\.json$/],
    ['netlify', null, /netlify\.toml$|(?:^|\/)netlify\/functions\//],
    ['github', null, null],
  ];
  const LANG_EXT = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', py: 'Python', sql: 'SQL', go: 'Go', rb: 'Ruby', php: 'PHP', dart: 'Dart', swift: 'Swift', kt: 'Kotlin', rs: 'Rust', html: 'HTML', css: 'CSS', scss: 'CSS' };

  function readDeps(files) {
    const deps = {};
    files.filter((f) => /(?:^|\/)package\.json$/.test(f.path)).forEach((f) => {
      try {
        const j = JSON.parse(f.text);
        Object.assign(deps, j.dependencies || {}, j.devDependencies || {});
      } catch (e) { /* ignore */ }
    });
    return deps;
  }

  function detectStack(files) {
    const deps = readDeps(files);
    const depNames = Object.keys(deps);
    const frameworks = FRAMEWORKS.filter((fw) => depNames.some((d) => fw[1] && fw[1].test(d)) || (fw[2] && files.some((f) => fw[2].test(f.path)))).map((fw) => fw[0]);
    const pyText = files.filter((f) => /requirements\.txt$|pyproject\.toml$/i.test(f.path)).map((f) => f.text).join(' ');
    if (/\bfastapi\b/i.test(pyText)) frameworks.push('FastAPI');
    if (/\bflask\b/i.test(pyText)) frameworks.push('Flask');
    if (/\bdjango\b/i.test(pyText)) frameworks.push('Django');
    if (files.some((f) => /^supabase\/functions\//.test(f.path))) frameworks.push('Supabase Edge Functions');

    const services = SERVICES.map((svc) => {
      const id = svc[0];
      const depRe = svc[1];
      const textRe = svc[2];
      const hasDep = !!(depRe && depNames.some((d) => depRe.test(d)));
      /* A file "uses" a service when its text mentions it. The package.json that
         declares the dependency is a fallback so dep-only projects still detect. */
      const matchFiles = files.filter((f) => (textRe && textRe.test(f.text)) || (id === 'github' && /^\.github\//.test(f.path)));
      if (hasDep) files.filter((f) => /(?:^|\/)package\.json$/.test(f.path) && matchFiles.indexOf(f) === -1).forEach((f) => matchFiles.push(f));
      return matchFiles.length ? { id, files: matchFiles.slice(0, 20).map((f) => f.path) } : null;
    }).filter(Boolean);

    const langCount = {};
    files.forEach((f) => {
      const ext = (f.path.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
      const lang = LANG_EXT[ext];
      if (lang) langCount[lang] = (langCount[lang] || 0) + 1;
    });
    const languages = Object.keys(langCount).sort((a, b) => langCount[b] - langCount[a]);

    return { frameworks: uniq(frameworks), services: services.map((s) => s.id), serviceFiles: services, languages };
  }

  function seg(route) {
    return route.split('/').filter((s) => s && !/^\(.*\)$/.test(s) && s[0] !== '@' && s[0] !== '_').join('/');
  }

  function buildMap(files, stack, db) {
    const pages = [];
    const apiRoutes = [];

    files.forEach((f) => {
      let m;
      if ((m = f.path.match(/^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/))) pages.push({ route: '/' + seg(m[1]), file: f.path });
      else if ((m = f.path.match(/^(?:src\/)?pages\/(?!api\/)(.+)\.[jt]sx?$/)) && !/_app$|_document$|_error$|^404$/.test(m[1])) {
        pages.push({ route: '/' + (m[1] === 'index' ? '' : m[1]), file: f.path });
      } else if (stack.frameworks.indexOf('Expo') !== -1 && (m = f.path.match(/^app\/(.+)\.[jt]sx$/)) && !/^_layout$|^\+/.test(m[1])) {
        pages.push({ route: '/' + seg(m[1]), file: f.path });
      } else if ((m = f.path.match(/^src\/routes\/(.*?)\/?\+page\.svelte$/))) pages.push({ route: '/' + seg(m[1]), file: f.path });

      if ((m = f.path.match(/^(?:src\/)?app\/(.*?)\/?route\.[jt]s$/))) {
        const methods = uniq(Array.from(f.text.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)).map((x) => x[1]));
        apiRoutes.push({ route: '/' + seg(m[1]), file: f.path, methods: methods.length ? methods : ['ANY'] });
      } else if ((m = f.path.match(/^(?:src\/)?pages\/api\/(.+)\.[jt]s$/))) {
        const methods = uniq(Array.from(f.text.matchAll(/req\.method\s*===?\s*["'](\w+)["']/g)).map((x) => x[1]));
        apiRoutes.push({ route: '/api/' + m[1], file: f.path, methods: methods.length ? methods : ['ANY'] });
      } else if ((m = f.path.match(/^supabase\/functions\/([^/_][^/]*)\/index\.[jt]s$/))) {
        apiRoutes.push({ route: '/functions/v1/' + m[1], file: f.path, methods: ['ANY'] });
      } else if ((m = f.path.match(/^netlify\/functions\/([^/]+?)(?:\/index)?\.[jt]s$/))) {
        apiRoutes.push({ route: '/.netlify/functions/' + m[1], file: f.path, methods: ['ANY'] });
      } else if ((m = f.path.match(/^api\/(.+?)(?:\/index)?\.[jt]s$/))) {
        apiRoutes.push({ route: '/api/' + m[1], file: f.path, methods: ['ANY'] });
      } else {
        Array.from(f.text.matchAll(/\b(?:app|router|server|api|fastify)\.(get|post|put|patch|delete|all)\(\s*["'`](\/[^"'`]*)["'`]/gi)).forEach((mm) => {
          let r = apiRoutes.find((x) => x.route === mm[2] && x.file === f.path);
          if (!r) { r = { route: mm[2], file: f.path, methods: [] }; apiRoutes.push(r); }
          r.methods = uniq(r.methods.concat(mm[1].toUpperCase()));
        });
      }
    });

    const tableNames = uniq(Object.keys(db.tables).concat(Object.keys(db.used)));
    const tables = tableNames.map((name) => {
      const t = db.tables[name];
      const usedFiles = db.used[name] || [];
      return { name, rls: t ? t.rls : null, file: (t && t.created && t.created.file) || usedFiles[0] || '' };
    });

    const envVars = {};
    const envRe = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*["']([A-Z0-9_]+)["']\s*\]|import\.meta\.env\.([A-Z][A-Z0-9_]*)|Deno\.env\.get\(\s*["']([A-Z0-9_]+)["']|os\.environ(?:\.get)?[[(]\s*["']([A-Z0-9_]+)["']|os\.getenv\(\s*["']([A-Z0-9_]+)["']/g;
    const EXCLUDE_ENV = new Set(['NODE_ENV', 'MODE', 'DEV', 'PROD', 'SSR', 'BASE_URL', 'PORT']);
    files.forEach((f) => {
      const isEnvFile = /^\.env(?:\..+)?$/.test(f.path.split('/').pop());
      let m;
      if (isEnvFile) {
        const re2 = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/gm;
        while ((m = re2.exec(f.text))) {
          const name = m[1];
          if (EXCLUDE_ENV.has(name)) continue;
          envVars[name] = envVars[name] || { name, files: [], public: VC.data.scanHelpers.PUBLIC_PREFIX.test(name) };
          if (envVars[name].files.indexOf(f.path) === -1 && envVars[name].files.length < 20) envVars[name].files.push(f.path);
        }
      } else {
        envRe.lastIndex = 0;
        while ((m = envRe.exec(f.text))) {
          const name = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
          if (!name || EXCLUDE_ENV.has(name)) continue;
          envVars[name] = envVars[name] || { name, files: [], public: VC.data.scanHelpers.PUBLIC_PREFIX.test(name) };
          if (envVars[name].files.indexOf(f.path) === -1 && envVars[name].files.length < 20) envVars[name].files.push(f.path);
        }
      }
    });

    return {
      pages: uniqByRoute(pages),
      apiRoutes: uniqByRoute(apiRoutes),
      tables,
      services: stack.services.map((id) => ({ id, name: (VC.data.serviceById && VC.data.serviceById(id) && VC.data.serviceById(id).name) || id, files: (stack.serviceFiles.find((s) => s.id === id) || {}).files || [] })),
      envVars: Object.keys(envVars).sort().map((k) => envVars[k]),
    };
  }
  function uniqByRoute(list) {
    const seen = new Set();
    return list.filter((x) => { if (seen.has(x.route)) return false; seen.add(x.route); return true; });
  }

  /* ------------------------------------------------------------------ *
   * Scoring
   * ------------------------------------------------------------------ */
  const W = { critical: 30, high: 15, medium: 6, low: 2, info: 0 };
  function scoreAndGrade(findings) {
    const byRule = {};
    findings.forEach((f) => { (byRule[f.ruleId] = byRule[f.ruleId] || []).push(f); });
    let penalty = 0;
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    findings.forEach((f) => { counts[f.severity] = (counts[f.severity] || 0) + 1; });
    Object.keys(byRule).forEach((id) => {
      const list = byRule[id].slice().sort((a, b) => (W[b.severity] || 0) - (W[a.severity] || 0));
      list.forEach((f, k) => { penalty += (W[f.severity] || 0) * (k === 0 ? 1 : k <= 2 ? 0.5 : 0); });
    });
    let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
    if (counts.critical) score = Math.min(score, 49);
    else if (counts.high) score = Math.min(score, 79);
    const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
    return { score, grade, counts };
  }

  /* ------------------------------------------------------------------ *
   * scan()
   * ------------------------------------------------------------------ */
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const CAT_RANK = { secrets: 0, database: 1, config: 2, deps: 3, code: 4 };

  function mask(s) {
    if (s.length < 16) return '••••••';
    const m = s.match(/^[A-Za-z0-9]{2,6}[_\-.](?:(?:live|test|proj|ant|secret|publishable)[_-])?/);
    return (m ? m[0] : s.slice(0, 4)) + '••••' + s.slice(-4);
  }

  function makeSnippet(f, idx, secretVal) {
    const line = lineOf(f, idx);
    let text = line.text;
    if (secretVal) text = text.split(secretVal).join(mask(secretVal));
    try { if (VC.engine.prompts && VC.engine.prompts.redact) text = VC.engine.prompts.redact(text); else if (VC.ai && VC.ai.redact) text = VC.ai.redact(text); } catch (e) { /* ignore */ }
    text = text.replace(/\r/g, '').replace(/\s+/g, ' ').trim();
    return text.length > 160 ? text.slice(0, 157) + '…' : text;
  }

  const WHERE_SHORT = { client: 'in browser code', server: 'hardcoded in server code', env: 'in an unprotected .env file', envIgnored: 'in your local .env file', other: 'in a project file' };
  const WHERE = {
    client: 'in code that runs in your visitors’ browsers', server: 'typed straight into your server code',
    env: 'in a .env file that .gitignore doesn’t protect, so it will be uploaded with your code',
    envIgnored: 'in your .env file (it’s protected by .gitignore, which is correct)', other: 'typed straight into a project file',
  };

  function resolveSeverity(ruleSeverity, fctxKey, override) {
    if (override != null) return override;
    if (typeof ruleSeverity === 'string') return ruleSeverity;
    if (ruleSeverity && typeof ruleSeverity === 'object') return ruleSeverity[fctxKey] != null ? ruleSeverity[fctxKey] : undefined;
    return 'medium';
  }

  function makeFinding(rule, file, idx, sev, checkVars, key, secretVal, ctx, dupCounter, fcHint) {
    const line = idx >= 0 && file ? lineOf(file, idx).n : 0;
    const fc = fcHint != null ? fcHint : (file ? ctx.fileCtx(file) : 'other');
    const envIgnored = fc === 'env' && ctx.gitignoreCovers(file ? file.path : '');
    const fctxKey = envIgnored ? 'envIgnored' : fc;
    const vars = Object.assign({
      file: file ? file.path : '', line,
      label: rule.label, env: rule.env, rotate: rule.rotate,
      where: WHERE[fctxKey] || WHERE.other, whereShort: WHERE_SHORT[fctxKey] || WHERE_SHORT.other,
    }, checkVars || {});

    let title = render(rule.title, vars);
    let plain = render(rule.plain, vars);
    let risk = render(rule.risk, vars);
    let fix = arr(rule.fix).map((s) => render(s, vars));
    let fixPrompt = render(rule.fixPrompt, vars);

    if (rule.category === 'secrets' && envIgnored && sev === 'info') {
      const label = vars.label ? render(vars.label, vars) : 'This value';
      title = label + ' — safely stored';
      plain = label + ' is in ' + vars.file + '. That’s the right place — it’s protected by .gitignore. Just don’t share this project folder or zip with anyone.';
      risk = '';
      fix = [];
      fixPrompt = '';
    }

    const dupKey = rule.id + ':' + (file ? file.path : '') + ':' + (key != null ? key : '');
    const h = hash(dupKey);
    dupCounter[h] = (dupCounter[h] || 0) + 1;
    const id = rule.id + ':' + h + (dupCounter[h] > 1 ? '#' + dupCounter[h] : '');

    return {
      id, ruleId: rule.id, severity: sev, category: rule.category,
      title, plain, risk, fix, fixPrompt,
      file: vars.file, line, snippet: (line > 0 && file) ? makeSnippet(file, idx, secretVal || '') : undefined,
    };
  }

  async function scan(vfiles, onProgress) {
    if (!vfiles || !vfiles.length) throw new Error('We didn’t find any code files in there. Drop your project folder (the one with package.json in it) or a .zip of it.');
    const meta = vfiles.meta || {};
    const files = vfiles.slice();
    const fileHashes = {};
    files.forEach((f) => { fileHashes[f.path] = hash(f.text); });

    const gitignores = parseGitignores(files);
    const db = analyzeSql(files);
    const stack = detectStack(files);
    const map = buildMap(files, stack, db);
    const helpers = VC.data.scanHelpers || {};
    const jwtRoleOf = (value) => {
      try {
        const parts = String(value).split('.');
        if (parts.length !== 3) return null;
        let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4) b64 += '=';
        const payload = JSON.parse(atob(b64));
        return payload && typeof payload.role === 'string' ? payload.role : null;
      } catch (e) { return null; }
    };

    const findings = [];
    const dupCounter = {};
    const onceSeen = {};
    const ctx = {
      files, meta, stack, map, db, findings,
      jwtRole: jwtRoleOf,
      fileCtx: (f) => fileCtx(f, stack),
      isEnvFile: (f) => /^\.env(?:\.[\w.-]+)?$/.test(f.path.split('/').pop()) && !/\.(?:example|sample|template|dist|defaults)$/i.test(f.path),
      gitignoreCovers: (path) => gitignoreCovers(gitignores, path),
      lineOf: (f, idx) => lineOf(f, idx),
      lineText: (f, n) => f.text.split('\n')[n - 1] || '',
      around: (f, idx, n) => around(f, idx, n),
    };
    const authMiddlewareFile = files.find((f) => /^(?:src\/)?middleware\.[jt]s$/.test(f.path) && helpers.AUTH_RE.test(f.text));
    ctx.authMiddleware = !!authMiddlewareFile;

    const perFileRules = (VC.data.scanRules || []).filter((r) => r.re).map((r) => Object.assign({}, r, {
      _re: new RegExp(r.re.source, r.re.flags.indexOf('g') === -1 ? r.re.flags + 'g' : r.re.flags),
    }));
    const projectRules = (VC.data.scanRules || []).filter((r) => r.run);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const minified = isMinified(f);
      for (let r = 0; r < perFileRules.length; r++) {
        const rule = perFileRules[r];
        if (rule.when && !rule.when(f, ctx)) continue;
        if (minified && rule.category !== 'secrets') continue;
        const re = rule._re;
        re.lastIndex = 0;
        let m;
        let n = 0;
        const claimed = [];
        while ((m = re.exec(f.text))) {
          if (m[0] === '') { re.lastIndex++; continue; }
          if (rule.skipComments) {
            const lt = lineOf(f, m.index).text;
            if (/^\s*(?:\/\/|#|\*|\/\*)/.test(lt)) continue;
          }
          const result = rule.check ? rule.check(m, f, ctx) : true;
          if (!result) continue;
          const resObj = typeof result === 'object' ? result : {};
          let secretVal = resObj.secret;
          if (secretVal === undefined && typeof rule.secret === 'function') secretVal = rule.secret(m, f, ctx);
          if (secretVal === undefined) secretVal = m[1] != null ? m[1] : m[0];

          if (rule.category === 'secrets' && secretVal) {
            const start = m.index + (m[0].lastIndexOf(secretVal) !== -1 ? m[0].lastIndexOf(secretVal) : 0);
            const end = start + secretVal.length;
            if (claimed.some((c) => start < c[1] && end > c[0])) continue;
            claimed.push([start, end]);
          }

          const fc = ctx.fileCtx(f);
          const envIgnored = fc === 'env' && ctx.gitignoreCovers(f.path);
          const fctxKey = envIgnored ? 'envIgnored' : fc;
          const sev = resolveSeverity(rule.severity, fctxKey, resObj.severity);
          if (sev == null) continue;
          if (rule.once) { if (onceSeen[rule.id]) continue; onceSeen[rule.id] = true; }

          const key = resObj.key != null ? resObj.key : (secretVal || m[0].trim());
          findings.push(makeFinding(rule, f, m.index, sev, resObj.vars, key, rule.category === 'secrets' ? secretVal : '', ctx, dupCounter, fc));
          if (++n >= (minified ? 3 : rule.max || 5)) break;
        }
      }
      if (onProgress) onProgress({ done: i + 1, total: files.length });
      await maybeYield();
    }

    function indexForLine(f, n) {
      if (!n) return -1;
      lineOf(f, 0); // ensures f._lineStarts is populated
      return f._lineStarts[n - 1] != null ? f._lineStarts[n - 1] : -1;
    }
    projectRules.forEach((rule) => {
      let items = [];
      try { items = rule.run(ctx) || []; } catch (e) { console.error(e); items = []; }
      items.forEach((p) => {
        const f = files.find((x) => x.path === p.file) || null;
        const idx = f ? indexForLine(f, p.line) : -1;
        const sev = p.severity || rule.severity || 'medium';
        findings.push(makeFinding(rule, f, idx, sev, Object.assign({ file: p.file, line: p.line || 0 }, p.vars), p.key, '', ctx, dupCounter));
      });
    });

    const byRule = {};
    let capped = findings.filter((f) => { byRule[f.ruleId] = (byRule[f.ruleId] || 0) + 1; return byRule[f.ruleId] <= MAX_PER_RULE; });
    capped.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || ((CAT_RANK[a.category] || 9) - (CAT_RANK[b.category] || 9)) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || (a.line - b.line));
    if (capped.length > MAX_FINDINGS) capped = capped.slice(0, MAX_FINDINGS);

    const sg = scoreAndGrade(capped);
    return {
      id: VC.uid('scan'), createdAt: Date.now(), projectName: meta.projectName || 'Your project',
      fileCount: files.length, skippedCount: meta.skippedCount || 0, totalBytes: meta.totalBytes || files.reduce((n, f) => n + f.size, 0),
      findings: capped, score: sg.score, grade: sg.grade, counts: sg.counts,
      stack: { frameworks: stack.frameworks, services: stack.services, languages: stack.languages },
      map, fileHashes,
      limits: { truncated: !!meta.truncated, ignoredDirs: Array.from(meta.ignoredDirs || []), source: meta.source || 'files' },
    };
  }

  /* ------------------------------------------------------------------ *
   * summarize / diff / report
   * ------------------------------------------------------------------ */
  function summarize(r) {
    return { id: r.id, createdAt: r.createdAt, grade: r.grade, score: r.score, counts: r.counts, fileCount: r.fileCount };
  }

  function diff(prev, next) {
    if (!prev) return { added: next.findings.slice(), fixed: [], filesChanged: 0, filesAdded: Object.keys(next.fileHashes || {}).length, filesRemoved: 0 };
    const prevIds = new Set(prev.findings.map((f) => f.id));
    const nextIds = new Set(next.findings.map((f) => f.id));
    const added = next.findings.filter((f) => !prevIds.has(f.id));
    const fixed = prev.findings.filter((f) => !nextIds.has(f.id));
    const prevHashes = prev.fileHashes || {};
    const nextHashes = next.fileHashes || {};
    const allPaths = uniq(Object.keys(prevHashes).concat(Object.keys(nextHashes)));
    let filesChanged = 0;
    let filesAdded = 0;
    let filesRemoved = 0;
    allPaths.forEach((p) => {
      const inPrev = Object.prototype.hasOwnProperty.call(prevHashes, p);
      const inNext = Object.prototype.hasOwnProperty.call(nextHashes, p);
      if (inPrev && inNext) { if (prevHashes[p] !== nextHashes[p]) filesChanged++; } else if (inNext) filesAdded++; else filesRemoved++;
    });
    return { added, fixed, filesChanged, filesAdded, filesRemoved };
  }

  const VERDICT = { A: 'Looks solid. Nothing serious found.', B: 'Pretty good. A few small things worth fixing.', C: 'Fix the high-priority items before sharing your link widely.', D: 'Several real risks. Fix these before launch.', F: 'Stop and fix the critical items first. Someone could misuse your accounts or data right now.' };

  function report(r) {
    const lines = [];
    lines.push('# Safety scan: ' + r.projectName);
    lines.push(VC.formatDate(r.createdAt) + ' · ' + r.fileCount + ' files checked · Grade **' + r.grade + '** (' + r.score + '/100)');
    lines.push('');
    lines.push('> ' + (VERDICT[r.grade] || ''));
    lines.push('');
    lines.push('| Critical | High | Medium | Low | Good to know |');
    lines.push('|---|---|---|---|---|');
    lines.push('| ' + [r.counts.critical, r.counts.high, r.counts.medium, r.counts.low, r.counts.info].map((n) => n || 0).join(' | ') + ' |');
    lines.push('');

    const bySev = (min, max) => r.findings.filter((f) => SEV_RANK[f.severity] >= min && SEV_RANK[f.severity] <= max);
    const section = (title, list) => {
      if (!list.length) return;
      lines.push('## ' + title);
      list.forEach((f, i) => {
        lines.push('### ' + (i + 1) + '. ' + f.title + ' (' + f.severity + ')');
        lines.push('**Where:** `' + f.file + (f.line ? ':' + f.line : '') + '` · ' + f.plain + (f.risk ? ' · **Why it matters:** ' + f.risk : ''));
        if (f.fix && f.fix.length) lines.push('**How to fix:** ' + f.fix.map((s, j) => (j + 1) + '. ' + s).join(' '));
        if (f.fixPrompt) lines.push('**Prompt for your AI builder:**\n```text\n' + f.fixPrompt + '\n```');
        lines.push('');
      });
    };
    section('Fix these first', bySev(0, 1));
    section('Worth fixing', bySev(2, 3));
    const info = bySev(4, 4);
    if (info.length) { lines.push('## Good to know'); info.forEach((f) => lines.push('- ' + f.title + ' (' + f.file + ')')); lines.push(''); }

    lines.push('## Your app at a glance');
    if (r.stack.frameworks.length) lines.push('- Framework: ' + r.stack.frameworks.join(', '));
    if (r.stack.languages.length) lines.push('- Language: ' + r.stack.languages.join(', '));
    if (r.stack.services.length) {
      const names = r.stack.services.map((id) => (VC.data.serviceById && VC.data.serviceById(id) && VC.data.serviceById(id).name) || id);
      lines.push('- Services: ' + names.join(', '));
    }
    lines.push('- ' + r.map.pages.length + ' page' + (r.map.pages.length === 1 ? '' : 's') + ', ' + r.map.apiRoutes.length + ' API route' + (r.map.apiRoutes.length === 1 ? '' : 's'));
    if (r.map.tables.length) lines.push('- Tables: ' + r.map.tables.map((t) => t.name + ' (RLS ' + (t.rls === true ? '✓' : t.rls === false ? '✗' : '?') + ')').join(', '));
    const pub = r.map.envVars.filter((e) => e.public).length;
    const priv = r.map.envVars.length - pub;
    if (r.map.envVars.length) lines.push('- Env vars: ' + pub + ' public, ' + priv + ' private');
    lines.push('');

    lines.push('## What this scan can’t check');
    lines.push('- Settings inside your dashboards (Supabase, Stripe, Firebase), whether RLS policies are *correct*, bugs in packages you use, or logic bugs.');
    const ignored = r.limits.ignoredDirs.length ? 'Ignored: ' + r.limits.ignoredDirs.join(', ') + '. ' : '';
    const skipped = r.skippedCount ? 'Skipped ' + r.skippedCount + ' files (images, very large or unreadable). ' : '';
    const trunc = r.limits.truncated ? 'This is a big project, so only the first 5,000 files were scanned.' : '';
    const extra = (ignored + skipped + trunc).trim();
    if (extra) lines.push('- ' + extra);
    lines.push('');
    lines.push('_Made offline by Vibe Check. Your code never left your computer._');

    let out = lines.join('\n');
    try { if (VC.engine.prompts && VC.engine.prompts.redact) out = VC.engine.prompts.redact(out); } catch (e) { /* ignore */ }
    return out;
  }

  VC.engine.scanner = { readInput, scan, summarize, diff, report };
})();
