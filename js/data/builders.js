/* Vibe Check — knowledge base: the AI app builders Vibe Check can plan and prompt for.
   Same spirit as services.js: checked against each tool's own docs/settings pages in
   September 2026. Where an exact click-path couldn't be confirmed, the wording says
   where to LOOK rather than inventing one.
   See docs/ARCHITECTURE.md → "Data contracts" → Builders. */
(function () {
  'use strict';
  const VC = window.VC;
  VC.data = VC.data || {};

  VC.data.builders = [
    {
      id: 'lovable',
      name: 'Lovable',
      url: 'https://lovable.dev',
      tagline: 'Describe your app in chat and watch a working web app appear',
      bestFor: 'Non-technical builders who want a polished web app fast, without ever opening code.',
      skill: 'beginner',
      pricing: 'Free to try (limited monthly credits); paid plans from about $25/mo for more credits.',
      framework: 'vite',
      defaultStack: 'React + Vite + Tailwind + Supabase',
      nativeIntegrations: ['supabase', 'stripe', 'github'],
      secrets: {
        publicKeys: [
          'Click "Supabase" in the top toolbar and connect (or create) a Supabase project. Lovable adds the project URL and public key for you — you never type them in.',
        ],
        secretKeys: [
          'Project → Settings (gear icon) → Manage secrets (this is where Edge Function secrets live, like a Stripe or Claude secret key). Add the name and value; Lovable never shows it back to you.',
        ],
        envFile: false,
        envFileName: null,
        deployVars: [
          'Lovable\'s own hosting reads the same secrets you set in Manage secrets — there\'s no separate step for the built-in domain.',
          'If you connect a custom domain or export to GitHub and deploy elsewhere, set the same keys again on that host.',
        ],
      },
      contextFile: {
        name: 'Knowledge',
        filename: null,
        how: 'Project → Settings → Knowledge. Paste your project brief into the custom knowledge box — Lovable includes it with every prompt automatically.',
      },
      tokenTips: [
        'Lovable spends one credit per prompt message, edit or not — batch small tweaks (copy, colors) into one message instead of one message each.',
        'Turn on "chat mode" (ask questions without editing code) when you\'re unsure what to ask for, then switch to build mode once you know.',
        'Use the visual edit tool for simple text/color/spacing tweaks — it doesn\'t cost a full prompt credit the way a chat message does.',
      ],
      strengths: [
        'Fastest path from an idea to a good-looking, working web app.',
        'Built-in Supabase and Stripe connections mean almost no manual key-copying.',
        'Visual edit mode for small tweaks without spending a prompt.',
      ],
      weaknesses: [
        'Web apps only — no real iPhone/Android app.',
        'Less room to fine-tune code by hand than Cursor or Claude Code.',
        'Credits run out faster on big, sweeping requests.',
      ],
      versionControl: 'Lovable keeps its own edit history you can revert to at any time. Turn on GitHub sync (Settings → GitHub) to also keep every version in a real GitHub repo you own.',
    },
    {
      id: 'bolt',
      name: 'Bolt',
      url: 'https://bolt.new',
      tagline: 'Builds and runs your app instantly in the browser, with the real code alongside it',
      bestFor: 'Builders who want to see and lightly edit real project files while an AI does most of the work.',
      skill: 'beginner',
      pricing: 'Free to try (limited monthly tokens); paid plans from about $20/mo for more tokens.',
      framework: 'vite',
      defaultStack: 'React + Vite + Tailwind + Supabase',
      nativeIntegrations: ['supabase', 'stripe', 'netlify', 'github'],
      secrets: {
        publicKeys: [
          'Click "Connect Supabase" in the top bar and sign in — Bolt creates the project and writes the public URL/key into your `.env` for you.',
        ],
        secretKeys: [
          'Open the file tree and add secret values straight into `.env` (never in the chat). For anything that must run on a server, use a Supabase Edge Function or Netlify Function and set the value in that service\'s own secret settings instead.',
        ],
        envFile: true,
        envFileName: '.env',
        deployVars: [
          'Click "Deploy" → Netlify (or your connected host) → Site settings → Environment variables, and add each key exactly as it\'s named in `.env`.',
        ],
      },
      contextFile: {
        name: 'Project instructions',
        filename: null,
        how: 'Paste your project brief as the very first message in a new chat, or pin it at the top of the project if your plan shows a "Project instructions" panel — Bolt keeps everything in the same chat as context.',
      },
      tokenTips: [
        'Bolt charges by tokens, not messages — long back-and-forth chats burn tokens fast, so start a fresh chat per milestone.',
        'Ask it to change only the files you name; letting it "look around" the whole project first costs extra tokens.',
        'Use the built-in terminal to run quick checks yourself (e.g. `npm run build`) instead of asking the AI to verify things it can already show you.',
      ],
      strengths: [
        'Real project files and a real terminal, right in the browser — nothing to install.',
        'One-click Netlify deploy and one-click Supabase connection.',
        'Good middle ground: AI does the heavy lifting, but the code is never hidden from you.',
      ],
      weaknesses: [
        'Tokens disappear quickly in long chats — needs disciplined, short prompts.',
        'Web apps by default; a real phone app takes an Expo-aware prompt and more manual setup than Lovable-style tools.',
      ],
      versionControl: 'Bolt keeps checkpoints you can roll back to in the chat history. Connect GitHub (top bar → GitHub) so every version is also backed up to a repo you own.',
    },
    {
      id: 'replit',
      name: 'Replit',
      url: 'https://replit.com',
      tagline: 'A full online coding workspace with an AI agent that builds, runs and deploys for you',
      bestFor: 'Apps that need real backend code (servers, databases, scheduled jobs) built and hosted in one place.',
      skill: 'beginner',
      pricing: 'Free to try (limited monthly credits); paid "Core" plan from about $20/mo for more agent usage and deployments.',
      framework: 'node',
      defaultStack: 'Node.js + React + Replit\'s built-in Postgres database',
      nativeIntegrations: ['github'],
      secrets: {
        publicKeys: [
          'Tools panel → Secrets. Even "public" values are simplest to store the same way here; the Agent reads them into your app automatically.',
        ],
        secretKeys: [
          'Tools panel → Secrets (the padlock icon). Add the name and value — Replit injects it as an environment variable and never shows it in your code or chat.',
        ],
        envFile: false,
        envFileName: null,
        deployVars: [
          'Secrets you set in the Secrets panel carry over to Replit Deployments automatically — there\'s no separate production step unless you deploy elsewhere.',
        ],
      },
      contextFile: {
        name: 'Replit.md',
        filename: 'replit.md',
        how: 'Create (or let the Agent create) a `replit.md` file in the project root. The Agent reads it automatically at the start of every session, so keep your brief there.',
      },
      tokenTips: [
        'Replit\'s Agent charges by effort/complexity, not per message — small, precisely-scoped asks cost less than open-ended ones like "make it better".',
        'Use Assistant mode (cheaper, for small edits and questions) and save Agent mode for real feature builds.',
        'Let the Agent finish and verify one checkpoint before asking for the next — interrupting mid-task wastes the work already spent.',
      ],
      strengths: [
        'Real servers and databases, hosted and deployed from the same place you build.',
        'Good for apps that need background jobs, cron tasks, or a custom backend.',
        'Can build real Expo/React Native mobile apps, not just web.',
      ],
      weaknesses: [
        'A little more technical-feeling than Lovable/Bolt for a first-timer.',
        'Free tier usage runs out faster on agent-heavy workflows.',
      ],
      versionControl: 'Replit auto-saves checkpoints you can roll back to from the History panel. Connect GitHub (top bar → Git) for a full backup you own outside Replit.',
    },
    {
      id: 'v0',
      name: 'v0',
      url: 'https://v0.dev',
      tagline: 'Vercel\'s AI tool for turning a prompt (or a screenshot) into polished Next.js UI',
      bestFor: 'Landing pages, dashboards and content-heavy sites where great-looking design matters most.',
      skill: 'beginner',
      pricing: 'Free to try (limited monthly credits); paid plans from about $20/mo for more generations.',
      framework: 'next',
      defaultStack: 'Next.js + Tailwind + shadcn/ui, deployed on Vercel',
      nativeIntegrations: ['vercel', 'supabase'],
      secrets: {
        publicKeys: [
          'Add a Supabase integration from the project\'s Integrations panel, or paste the public URL/key into `.env.local` yourself if you\'re working from the downloaded code.',
        ],
        secretKeys: [
          'Keep secret values out of the generated UI code entirely. Once you export/deploy to Vercel, add them in Vercel → Project → Settings → Environment Variables and read them only from server components or API routes.',
        ],
        envFile: true,
        envFileName: '.env.local',
        deployVars: [
          'Vercel dashboard → your project → Settings → Environment Variables (v0 projects deploy straight to Vercel).',
        ],
      },
      contextFile: {
        name: 'Project instructions',
        filename: null,
        how: 'Paste your project brief as the first message in a new chat, or into the project\'s instructions field if your workspace shows one — v0 carries it into every generation in that chat.',
      },
      tokenTips: [
        'v0 spends a generation per request — describe the whole screen in one detailed prompt instead of many tiny follow-ups.',
        'Attach a screenshot or Figma link when you have one; matching a picture is cheaper than describing a look in words over several tries.',
        'Once a screen looks right, move to Cursor or Claude Code (or plain Vercel deploys) for wiring up data — v0 is at its best for UI, not app logic.',
      ],
      strengths: [
        'Best-in-class visual polish with very little effort.',
        'One-click deploy to Vercel, made by the same company.',
        'Great for landing pages, marketing sites and dashboards.',
      ],
      weaknesses: [
        'Not built for complex app logic, backend work, or mobile apps.',
        'Best paired with another tool (or hand-written code) once the UI is right.',
      ],
      versionControl: 'v0 keeps a version history per chat you can revert to. Push the exported code to a GitHub repo (via the Vercel integration or manually) for a real backup.',
    },
    {
      id: 'cursor',
      name: 'Cursor',
      url: 'https://cursor.com',
      tagline: 'A code editor (like VS Code) with AI built deeply into every file',
      bestFor: 'People with a little coding comfort who want more control than a pure chat-to-app tool gives.',
      skill: 'intermediate',
      pricing: 'Free tier with limited usage; Pro plan from about $20/mo for more AI usage.',
      framework: 'any',
      defaultStack: 'Whatever you scaffold — commonly React + Vite or Next.js, chosen when you start the project.',
      nativeIntegrations: [],
      secrets: {
        publicKeys: [
          'Create a `.env.local` (or `.env`) file in the project root and add the value there, using the exact variable name your framework expects.',
        ],
        secretKeys: [
          'Same `.env` file, server-only. Never let it appear in a file that ships to the browser (check that only server/API code reads it), and never paste it into the chat panel.',
        ],
        envFile: true,
        envFileName: '.env.local',
        deployVars: [
          'Set the same keys again in your host\'s dashboard when you deploy (Vercel/Netlify → Project → Environment Variables, or your platform\'s equivalent).',
        ],
      },
      contextFile: {
        name: 'Cursor rules',
        filename: '.cursor/rules/project.mdc',
        how: 'Create `.cursor/rules/project.mdc` with `alwaysApply: true` in its front matter. Cursor attaches it to every AI request automatically, so you never have to repeat the brief.',
      },
      tokenTips: [
        'Use Cursor\'s cheaper/fast model for small, obvious edits and its top model only for planning or gnarly bugs.',
        '@-mention only the specific files a task needs instead of letting it search the whole repo.',
        'Turn on your rules file once — it\'s the single biggest way to stop re-explaining the project on every request.',
      ],
      strengths: [
        'Full control of the codebase, with AI help everywhere you need it.',
        'Works with any framework or stack, including ones the pure "vibe" tools don\'t support.',
        'Rules files make it easy to keep the AI consistent across a long project.',
      ],
      weaknesses: [
        'You do need to run and deploy the app yourself (or with its terminal/agent mode) — a bit more setup than a one-click builder.',
        'Expects some comfort reading file names and folders, even if you never write code by hand.',
      ],
      versionControl: 'Cursor is a normal code editor over a normal folder — use real Git: `git init`, commit often, and push to a GitHub repo as your backup and history.',
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      url: 'https://claude.com/claude-code',
      tagline: 'A command-line AI collaborator that reads, writes and runs your whole codebase',
      bestFor: 'People who\'ve shipped something before and want the most capable, most controllable AI builder.',
      skill: 'advanced',
      pricing: 'Included in Claude subscriptions (Pro/Max) with usage limits, or pay-as-you-go via the API.',
      framework: 'any',
      defaultStack: 'Whatever you scaffold — Claude Code can start any framework, including Next.js, Vite, Expo or a plain backend.',
      nativeIntegrations: [],
      secrets: {
        publicKeys: [
          'Create a `.env.local` (or `.env`) file in the project root and add the value there, using the exact variable name your framework expects.',
        ],
        secretKeys: [
          'Same `.env` file, server-only. Ask Claude Code to double-check that no secret ever gets committed or printed to the terminal, and never paste one into the chat.',
        ],
        envFile: true,
        envFileName: '.env.local',
        deployVars: [
          'Set the same keys again in your host\'s dashboard when you deploy (Vercel/Netlify → Project → Environment Variables, or your platform\'s equivalent).',
        ],
      },
      contextFile: {
        name: 'CLAUDE.md',
        filename: 'CLAUDE.md',
        how: 'Create `CLAUDE.md` in the project root. Claude Code reads it automatically at the start of every session in that folder, so your brief and rules are always in context.',
      },
      tokenTips: [
        'Keep `CLAUDE.md` current — it\'s read every session for free context, so it\'s the cheapest way to avoid re-explaining anything.',
        'Start a fresh session per milestone (or use `/clear`) instead of one long, ever-growing conversation.',
        'Ask for a plan on big or risky changes before letting it edit files, so you approve the approach before spending on the implementation.',
      ],
      strengths: [
        'The most capable and controllable option: full terminal, full codebase awareness, real Git usage.',
        'No platform lock-in — the code is just your code, deployable anywhere.',
        'Excellent at large, multi-file changes and stubborn bugs.',
      ],
      weaknesses: [
        'No free tier without a Claude subscription or API billing.',
        'Assumes real comfort with a terminal and basic Git — the steepest learning curve here.',
      ],
      versionControl: 'Claude Code works directly with real Git. Commit after each working milestone and push to a GitHub repo as your backup and history.',
    },
  ];
})();
