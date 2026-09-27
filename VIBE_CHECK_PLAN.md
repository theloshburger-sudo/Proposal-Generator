# Vibe Check — Product Plan

> Tell it your idea. It shows you what it could be, gives you everything you need to build it, writes the prompts, and checks your work, so the hard parts of vibe coding stop being hard.

## Who it's for

People building apps with AI tools (Lovable, Bolt, Replit, v0, Cursor, Claude Code) who **aren't technical**. They have ideas, but they get stuck on API keys, environment setup, bad prompts, huge token bills and apps that aren't safe.

## The problem (researched)

| Pain | Evidence |
|---|---|
| Open databases | 170 of 1,645 Lovable apps (10.3%) exposed user data because Row Level Security was off (CVE-2025-48757). Moltbook leaked ~1.5M API tokens days after launch, and its founder "didn't write one line of code." |
| Leaked secrets at scale | Escape.tech scanned 5,600 vibe-coded apps: 2,000+ vulnerabilities, 400+ exposed secrets, 175 cases of exposed personal data. |
| Insecure AI code | Veracode: 45% of AI-generated code samples failed OWASP Top 10 tests. |
| Lost work | Replit's agent deleted SaaStr's production database during a code freeze (Jul 2025). |
| Cost blowups | Replit users reported ~$1,000/week bills; unprotected AI endpoints can be drained by anyone. |
| Doom loop | "Fix one bug, get two." The top dev frustration (66%, Stack Overflow 2025) is AI output that's "almost right." |
| Setup wall | Which API to use, how to get the key, what's free, where the key goes, which keys are public vs secret: the most common place non-technical builders quit. |

**Gaps in existing tools:** secret scanners are command-line tools for engineers. Platform scanners only cover their own platform. External scanners only see the deployed site. Nothing guides you from idea to setup to safe launch, and nothing is written for non-developers.

## Principles

1. **No jargon.** Every screen answers *what, why and exactly what to click next*.
2. **Fewer tokens, better product.** Plan once, build in small verified steps, never re-explain the project.
3. **Safe by default.** Security goes into the first prompt, not added after a breach.
4. **Nothing leaves your computer** unless you add your own AI key, and secrets are removed before anything is sent.

## The journey

```
 IDEA ──► DIRECTIONS ──► BUILD KIT ──► SETUP ──► BUILD ──► CHECK ──► SHIP
 "an app   3–4 example    what you     get keys   step-by-   scan for   launch
  for..."  versions to    need + the   & put them step       leaks &    checklist
           pick from      plan         in place   prompts    holes
```

### 1. Idea → Directions
- Type your idea in one sentence ("an app where producers track which artists have their beats").
- Get **3–4 example directions**, each shown as a card with: a name, a one-line pitch, who it's for, key features, a wireframe sketch, **difficulty** (easy/medium/hard) and **monthly cost** (free / ~$X).
- Choose one, or mix features from several ("take A but add payments from C").
- A few quick follow-up questions: Do users log in? Do you take payments? Mobile or web? Which AI builder are you using?

### 2. Build Kit
Once you pick a direction, you get:
- **What you need:** each service the app requires, why it needs it, the **recommended pick** for this app, and alternatives. Example: *Login and database → Supabase (free tier). Payments → Stripe. AI features → Claude API.*
- **Recommended builder tool** for this project (e.g. Lovable for quick web apps, Cursor/Claude Code for more control), with the reason.
- **Build plan:** the app broken into 5–8 small milestones in the right order (sign-up → database → core feature → payments → polish).
- **Cost estimate:** services and a rough token/credit budget for the build.

### 3. Setup Wizard (the hard part, made easy)
For every service in the kit, step-by-step walkthroughs:
- **Get the key:** "Go to this link → click this button → copy this value," with a checkbox for each step.
- **Public or secret?** Every key is labeled 🟢 *safe in your app* (e.g. Supabase anon key) or 🔴 *never put this in your app's frontend* (e.g. Stripe secret key, Supabase service_role).
- **Where it goes:** exact instructions for *your* tool: Lovable/Bolt secrets panel, Replit Secrets, `.env.local` for Cursor/Claude Code, Vercel/Netlify environment variables for launch.
- **`.env` file generator:** paste your keys into a form and it builds a correctly named `.env` file plus a `.gitignore` so the keys never get uploaded.
- **Key checker:** confirms the key *looks* right (correct prefix/format) and that it's in the right place. The key stays on your device.

### 4. Prompt Studio (best results, fewest tokens)
- **Project brief (context file):** a short spec generated once and saved in the project as `CLAUDE.md`, `.cursorrules` or pinned project knowledge, so the AI never needs the project re-explained.
- **One prompt per milestone:** each is scoped, has clear "done when…" checks, and has **safety rules built in** (keys in env vars, RLS on, input validation, rate limits on AI endpoints).
- **Token-saving habits built into every prompt:**
  - Ask for a plan before code on big steps.
  - Change only named files; don't rewrite what works.
  - One feature per prompt, then test.
  - Start a fresh chat per milestone, carrying over the brief instead of the history.
  - Use a cheaper/faster mode for small fixes, the strong model for architecture.
- **Prompt improver:** paste your own prompt and get a tighter, safer version, with an estimate of the tokens saved.
- **Stuck? mode:** paste the error and what you asked for, and get a structured "break the loop" prompt (reset, reproduce, smallest fix, verify).

### 5. Check (Safety Scan)
- Drag in your project folder or .zip. **It runs entirely in the browser; nothing is uploaded.**
- **Secret detector:** platform-aware rules (Supabase, Stripe, OpenAI, Anthropic, AWS, Firebase, GitHub) that know "public by design" from "disaster," and flag secrets in files that run in the browser.
- **Database lock check:** Supabase tables without RLS or policies, and Firebase `allow read, write: if true`.
- **Launch mistakes:** missing `.gitignore`, `.env` files that would be committed, no version control, AI/paid endpoints with no auth or rate limit, `eval`/unsafe HTML, and CORS open to everyone (`*`).
- **A–F report card** with plain-English explanations and a **"Copy fix prompt"** button for each issue.
- **Before/after snapshots:** "The AI changed 38 files and added 2 new risks."
- **Visual app map:** pages, API routes, database tables and outside services drawn as a diagram.

### 6. Ship
- A launch checklist tailored to the chosen stack (environment variables set on the host, test payment → live payment, custom domain, backups, error page).

## How the "brain" works
- **Built-in knowledge base (works offline, free):** a curated catalog of common services (auth, database, payments, AI, email, maps, file storage, hosting) with free tiers, key formats, public/secret labels and per-tool placement guides; app archetypes (marketplace, SaaS dashboard, social, booking, AI tool, e-commerce, tracker) for generating directions; prompt templates with safety and token rules.
- **Optional AI key (bring your own, e.g. Claude):** turns any idea into custom directions, writes prompts specific to the project, and explains scan findings in more depth. Calls go straight from the browser to the provider, and the key is stored only on your device.

## Tech
- A single static web page (HTML/JS). It runs offline and can be hosted free on GitHub Pages.
- File System Access API / `webkitdirectory` + JSZip to read project files, with scanning in a Web Worker.
- IndexedDB for saved projects, briefs and scan snapshots.

## Build order
1. **Idea → Directions → Build Kit** (knowledge base + optional AI).
2. **Setup Wizard + `.env` generator.**
3. **Prompt Studio.**
4. **Safety Scan + report card.**
5. App map, snapshots, Ship checklist.

## Success metric
A non-technical person goes from **"I have an idea"** to **"my app is built, set up correctly and passes the safety scan"** without searching for anything outside Vibe Check.
