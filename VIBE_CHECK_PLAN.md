# Vibe Check — Product Plan

> Drag in your app. Find out if it's safe, understand what you built, and get the exact prompt to fix it.

## Who it's for

People building apps with AI tools (Lovable, Bolt, Replit, v0, Cursor, Claude Code) who **can't read the code** they're shipping.

## The problem (researched)

| Pain | Evidence |
|---|---|
| Open databases | 170 of 1,645 Lovable apps (10.3%) exposed user data because Row Level Security was off (CVE-2025-48757). Moltbook leaked ~1.5M API tokens days after launch, and its founder "didn't write one line of code." |
| Leaked secrets at scale | Escape.tech scanned 5,600 vibe-coded apps: 2,000+ vulnerabilities, 400+ exposed secrets, 175 cases of exposed personal data. |
| Insecure AI code | Veracode: 45% of AI-generated code samples failed OWASP Top 10 tests. |
| Lost work | Replit's agent deleted SaaStr's production database during a code freeze (Jul 2025). |
| Cost blowups | Replit users reported ~$1,000/week bills; unprotected AI endpoints can be drained by anyone. |
| Doom loop | "Fix one bug, get two." The top dev frustration (66%, Stack Overflow 2025) is AI output that's "almost right." |

**Gaps in existing tools:** secret scanners (gitleaks, TruffleHog) are command-line tools for engineers. Platform scanners only cover their own platform. External scanners only see the deployed site and are paid. Nothing is local, nothing explains findings in context, and nothing is written for non-developers.

## Principles

1. **Nothing leaves your computer.** The scan runs in the browser; your secrets never get uploaded.
2. **No jargon.** Every finding answers: *What's wrong? What could someone do with it? How do I fix it?*
3. **Fixes are prompts.** Every issue has a "Copy fix prompt" button to paste into your AI tool.
4. **Help people build better, not just scan.** Guide them before, during and after the build.

## Features

### Phase 1 — Safety scan (MVP, no backend, no API key)
1. **Drag-and-drop folder scan** (or a .zip file). Skips `node_modules` and build output.
2. **Secret detector.** Platform-aware rules for Supabase (service_role vs anon), Stripe `sk_live`, OpenAI, Anthropic, AWS, Firebase and GitHub tokens, plus a check for random-looking strings. Knows the difference between "public by design" and "a disaster," and flags secrets in files that run in the browser.
3. **Database lock check.** Reads Supabase SQL/migrations to find tables without RLS or policies, and Firebase rules for `allow read, write: if true`.
4. **Launch-readiness checks.** Missing `.gitignore`, `.env` files that would be committed, no version control, no lockfile, AI/paid endpoints without auth or rate limits, `dangerouslySetInnerHTML`/`eval`, and CORS open to everyone (`*`).
5. **Report card.** An A–F grade with red/yellow/green findings, plain-English explanations and a fix prompt for each.

### Phase 2 — Understand your app
6. **Visual app map.** Pages, API routes, database tables and outside services (Stripe, Supabase, OpenAI…) detected and drawn as a diagram, not a file tree.
7. **"What your app does" summary.** Built from what the scan detects; an optional AI key makes it richer.
8. **Glossary tooltips.** Hover over "RLS," "API key," "env var" and get a one-sentence explanation.

### Phase 3 — Build better (escape the doom loop)
9. **Snapshots and diff.** Scan before and after an AI change: "The AI changed 38 files and added 2 new risks."
10. **Blueprint builder.** Before building, answer 6 simple questions (users? logins? payments? data?) and get a project brief plus a starter prompt with security built in: RLS on, keys in env vars, rate limits.
11. **Stuck? mode.** Paste the error and what you asked for; get a structured prompt that breaks the loop (reset context, smaller step, verify first).
12. **Export report.** Markdown/PDF to hand to a developer or paste into the AI tool.

### Optional AI key (called directly from the browser, secrets removed first)
- Deeper file-by-file explanations
- Chat with your app map ("where does the login happen?")
- Smarter, project-specific fix prompts

## Tech
- A single static web page (HTML/JS). It runs offline and can be hosted free on GitHub Pages.
- File System Access API / `webkitdirectory` to read the folder, and JSZip to open .zip files.
- The scan runs in a Web Worker so the UI stays smooth.
- Scan history (for snapshots) is stored locally in the browser with IndexedDB.

## Success metric
A non-technical person can go from "drag folder" to "fixed my worst issue" in **under 5 minutes** without looking anything up.
