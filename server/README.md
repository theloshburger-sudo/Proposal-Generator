# Vibe Check — AI backend

A small proxy so Vibe Check's AI features (directions, prompts, scan explanations)
work for everyone without each person needing their own Claude API key. It holds
**one** shared key server-side, rate-limits requests by IP, and stops calling
Claude once a daily spend cap is reached.

Nobody's Claude key ever needs to touch a browser for this to work. People who
want unlimited, unshared use can still paste their own key in Vibe Check's
Settings — that path calls Anthropic directly from their browser instead, same
as before.

## What it does

- `POST /v1/complete` — takes `{ system?, prompt, schema?, maxTokens?, effort?, model? }`,
  calls Claude with the server's own key, returns `{ text }` (or `{ error }` with
  a friendly, non-technical message).
- `GET /health` — for uptime checks / Render's health check.
- Blocks a request before it costs anything if:
  - this IP has already made `RATE_LIMIT_PER_DAY` requests today (default 20), or
  - the shared `DAILY_SPEND_CAP_USD` has been reached (default $5) — tracked from
    the real `usage` tokens Claude reports back, priced per model (see
    `.env.example` to correct the placeholder rates).
- Both limits reset at UTC midnight. No database, no cron job — just an
  in-memory counter (see the `ponytail:` note in `lib/dailyBucket.js` for the
  one tradeoff that comes with that: counts reset early if the process restarts).

## Run it locally

```bash
cd server
npm install
cp .env.example .env
# edit .env and paste your real ANTHROPIC_API_KEY
npm start
```

Then `curl http://localhost:8787/health` should return `{"ok":true}`.

Run the offline self-check any time (no API key needed, no network calls):

```bash
npm test
```

## Deploy on Render

1. Push this repo to GitHub (the `server/` folder can live right alongside the
   Vibe Check frontend — they don't need to be separate repos).
2. In Render: **New +** → **Web Service** → connect the repo.
3. **Root Directory**: `server`
4. **Build Command**: `npm install`
5. **Start Command**: `npm start`
6. **Environment** → add:
   - `ANTHROPIC_API_KEY` — your real key. Render's env vars are encrypted at
     rest and never appear in your repo or build logs.
   - Optionally `RATE_LIMIT_PER_DAY`, `DAILY_SPEND_CAP_USD`, `ALLOWED_ORIGIN`
     (set this to your deployed frontend's exact origin once you have one,
     e.g. `https://yourname.github.io` — tighter than the `*` default).
7. Deploy. Render gives you a URL like `https://your-service.onrender.com`.
8. Paste that URL into Vibe Check's Settings → "AI backend URL" (or hardcode
   it as `DEFAULT_BACKEND_URL` in `js/ai.js` before you publish the frontend,
   so it works for visitors with no setup).

**Free-tier note:** Render's free web services spin down after 15 minutes of
no traffic and take ~30-50s to wake back up on the next request. The frontend
already falls back to the offline built-in library if a request errors or
times out, so this degrades gracefully — it just won't feel instant on a cold
start. A paid instance (or a cheap always-on ping) avoids that if it matters
to you.

## Never commit a real key

`.env` is gitignored. `.env.example` only ever holds placeholder values. If a
real key ever ends up in git history, treat it as leaked: roll it in the
Anthropic console immediately, then update `ANTHROPIC_API_KEY` wherever it's
deployed.
