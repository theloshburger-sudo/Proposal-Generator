/* Vibe Check — Prompt Studio (#/prompts): the project brief, one paste-ready prompt
   per build-plan step, a prompt improver, an "I'm stuck" break-the-loop prompt, and
   token-saving habits. All backed by the already-built VC.engine.prompts.
   See docs/ARCHITECTURE.md → "4. Prompt Studio" and Engines → VC.engine.prompts. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const PE = () => (VC.engine && VC.engine.prompts) || null;
  const LABEL = 'font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--muted);margin-bottom:6px';

  /* ------------------------------------------------------------------ *
   * Module state — UI-only, never persisted, reset only on page reload.
   * ------------------------------------------------------------------ */
  let activeTab = 'steps';
  let improverDraft = '';
  let improverResult = null;
  let improving = false;
  let stuckDraft = { situation: '', goal: '', error: '', tried: '' };
  let stuckResult = null;

  const TABS = [
    ['steps', 'Build prompts'],
    ['improve', 'Prompt improver'],
    ['stuck', 'I\'m stuck'],
    ['tips', 'Token tips'],
  ];

  function tabsBar() {
    return html`<div class="tabs" role="tablist">
      ${TABS.map(([id, label]) => html`<button class="tab ${activeTab === id ? 'active' : ''}" data-tab="${id}" role="tab" aria-selected="${String(activeTab === id)}">${label}</button>`)}
    </div>`;
  }

  /* ------------------------------------------------------------------ *
   * Tab: Build prompts
   * ------------------------------------------------------------------ */
  function stepItem(s, isDone) {
    return html`<li id="step-${s.id}">
      <div class="check ${isDone ? 'is-done' : ''}" style="cursor:default;align-items:flex-start">
        <input type="checkbox" id="step-check-${s.id}" data-action="toggle-step" data-id="${s.id}" ${isDone ? 'checked' : ''}>
        <div class="grow" style="min-width:0">
          <label for="step-check-${s.id}" class="check-title bold" style="cursor:pointer;display:block">${s.kind === 'starter' ? 'Start here' : 'Step ' + s.number}: ${s.title}</label>
          <div class="small text-2">${s.goal}</div>
          <div class="row sm" style="margin-top:6px">
            ${VC.ui.badge('~' + s.tokens + ' tokens', 'gray')}
            ${arr(s.services).map((id) => { const svc = VC.data.serviceById && VC.data.serviceById(id); return svc ? VC.ui.badge(svc.name, 'gray') : ''; })}
          </div>
          <details style="margin-top:8px">
            <summary class="small" style="cursor:pointer;color:var(--accent);font-weight:600;width:max-content">Show prompt</summary>
            <div style="margin-top:8px">${VC.ui.codeBlock(s.prompt, { title: 'Prompt', copyLabel: 'Copy prompt' })}</div>
          </details>
        </div>
      </div>
    </li>`;
  }

  function stepsTab(p) {
    if (!p || !p.kit) {
      return VC.ui.empty({
        icon: 'prompt', title: 'Build your kit first',
        body: 'Prompts are written from your build kit\'s plan, so they already know your stack, your services, and the safety rules to bake in.',
        actionLabel: 'Go to Build Kit', actionHref: '#/kit',
      });
    }
    const engine = PE();
    const cf = engine.contextFile(p);
    const steps = engine.steps(p);
    const done = (p.prompts && p.prompts.done) || {};
    const doneCount = steps.filter((s) => done[s.id]).length;
    return html`
      <section class="card pad-lg stack section" aria-labelledby="prompts-brief-h">
        <div class="spread"><h2 id="prompts-brief-h" class="mb-0">${cf.name}</h2>${VC.ui.badge('Paste once', 'accent')}</div>
        <p class="text-2 mb-0">${cf.how}</p>
        ${VC.ui.codeBlock(cf.content, { title: cf.filename || cf.name, filename: cf.filename || undefined, copyLabel: 'Copy brief' })}
      </section>
      <section class="section" aria-labelledby="prompts-steps-h">
        <div class="section-head">
          <div>
            <h2 id="prompts-steps-h">Prompts, in order</h2>
            <p class="small text-2 mb-0">Paste one at a time into a fresh chat. Test it, tick it off, then move to the next.</p>
          </div>
        </div>
        <div class="card stack sm" style="margin-bottom:14px">
          <div class="spread"><span class="small bold">${doneCount} of ${steps.length} done</span></div>
          ${VC.ui.meter((doneCount / (steps.length || 1)) * 100, doneCount === steps.length ? 'green' : '')}
        </div>
        <ul class="checklist">${steps.map((s) => stepItem(s, !!done[s.id]))}</ul>
      </section>
    `;
  }

  /* ------------------------------------------------------------------ *
   * Tab: Prompt improver
   * ------------------------------------------------------------------ */
  function improveResultView(r) {
    const saved = r.before - r.after;
    return html`<div class="stack" style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
      ${arr(r.warnings).map((w) => VC.ui.callout('danger', w))}
      ${VC.ui.codeBlock(r.improved, { title: 'Improved prompt', copyLabel: 'Copy improved prompt' })}
      <div class="row sm small muted">
        <span>${r.before} → ${r.after} tokens${saved > 0 ? ` (${Math.round((saved / (r.before || 1)) * 100)}% shorter)` : ''}</span>
        ${r.source === 'ai' ? VC.ui.badge(html`${VC.icon('sparkles', 11)} Written by AI`, 'blue') : ''}
      </div>
      ${r.aiError ? VC.ui.callout('warn', 'AI couldn\'t help this time (' + r.aiError + '), so here\'s the offline version.') : ''}
      ${arr(r.changes).length ? html`<div><div style="${LABEL}">What changed</div><ul class="small mb-0">${r.changes.map((c) => html`<li>${c}</li>`)}</ul></div>` : ''}
    </div>`;
  }

  function improveTab() {
    return html`<section class="card pad-lg stack" aria-labelledby="prompts-improve-h">
      <h2 id="prompts-improve-h" class="mb-0">Make any prompt tighter, safer and cheaper</h2>
      <p class="text-2 mb-0">Paste a prompt you were about to send to your AI builder. We'll tighten it into a clear goal, details, safety rules and a "done when" list — and strip out any secret you pasted by accident.</p>
      <div class="field">
        <label for="improve-input" class="small">Your prompt</label>
        <textarea id="improve-input" rows="6" placeholder="Paste your prompt here…">${improverDraft}</textarea>
      </div>
      <div class="row">
        <button class="btn primary" data-action="improve" ${improving ? 'disabled' : ''}>${improving ? html`<span class="spinner"></span> Working…` : html`${VC.icon('wand', 16)} Improve it`}</button>
        ${!improving && VC.ai.enabled() ? html`<span class="small muted row sm">${VC.icon('sparkles', 14)} Using AI</span>` : ''}
      </div>
      ${improverResult ? improveResultView(improverResult) : ''}
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Tab: I'm stuck
   * ------------------------------------------------------------------ */
  function situationsList() {
    const engine = PE();
    return (engine && engine.stuckSituations) || [];
  }

  function stuckResultView(r) {
    return html`<div class="stack" style="border-top:1px solid var(--border);padding-top:16px;margin-top:4px">
      ${arr(r.advice).length ? html`<div class="stack sm">${r.advice.map((a) => VC.ui.callout('info', html`<strong>${a.title}.</strong> ${a.detail}`))}</div>` : ''}
      ${VC.ui.codeBlock(r.prompt, { title: 'Paste this to your AI builder', copyLabel: 'Copy prompt' })}
    </div>`;
  }

  function stuckTab() {
    const situations = situationsList();
    return html`<section class="card pad-lg stack" aria-labelledby="prompts-stuck-h">
      <h2 id="prompts-stuck-h" class="mb-0">Break the "fix one bug, get two" loop</h2>
      <p class="text-2 mb-0">Tell us what's going wrong. We'll write a structured prompt that gets your AI builder to find the real cause instead of guessing again.</p>
      <div class="field">
        <label for="stuck-situation" class="small">What's going on? (optional)</label>
        <select id="stuck-situation">
          <option value="">Something else…</option>
          ${situations.map((s) => html`<option value="${s.id}" ${stuckDraft.situation === s.id ? 'selected' : ''}>${s.label}</option>`)}
        </select>
      </div>
      <div class="grid-2">
        <div class="field"><label for="stuck-goal" class="small">What you're trying to do</label><textarea id="stuck-goal" rows="2" placeholder="e.g. Let people log in">${stuckDraft.goal}</textarea></div>
        <div class="field"><label for="stuck-error" class="small">What happens instead (paste the exact error if you have one)</label><textarea id="stuck-error" rows="2" placeholder="e.g. Blank white screen">${stuckDraft.error}</textarea></div>
      </div>
      <div class="field"><label for="stuck-tried" class="small">What you've already tried (one per line)</label><textarea id="stuck-tried" rows="2">${stuckDraft.tried}</textarea></div>
      <div class="row"><button class="btn primary" data-action="stuck">${VC.icon('life', 16)} Write the prompt</button></div>
      ${stuckResult ? stuckResultView(stuckResult) : ''}
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * Tab: Token tips
   * ------------------------------------------------------------------ */
  function tipsTab(p) {
    const tips = (PE() && PE().tokenTips(p)) || [];
    return html`<section class="section" aria-labelledby="prompts-tips-h">
      <div class="section-head"><h2 id="prompts-tips-h">Habits that spend fewer tokens</h2></div>
      <div class="grid-2">
        ${tips.map((t) => html`<div class="card flat soft stack sm">
          <h3 class="mb-0" style="font-size:1rem">${t.title}${t.builder ? html` <span class="tiny muted" style="font-weight:500">— ${t.builder}</span>` : ''}</h3>
          ${t.detail ? html`<p class="small text-2 mb-0">${t.detail}</p>` : ''}
        </div>`)}
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * View
   * ------------------------------------------------------------------ */
  VC.registerView({
    id: 'prompts',
    title: 'Prompt Studio',
    navTitle: 'Prompts',
    icon: 'prompt',
    nav: { group: 'journey', order: 4 },
    status(project) {
      try {
        if (!project || !project.kit) return 'todo';
        const steps = PE().steps(project);
        if (!steps.length) return 'todo';
        const done = (project.prompts && project.prompts.done) || {};
        return steps.every((s) => done[s.id]) ? 'done' : 'todo';
      } catch (e) { return 'todo'; }
    },

    render(el, ctx) {
      const p = ctx.project;
      if (!PE()) {
        VC.mount(el, html`${VC.ui.pageHead({ eyebrow: 'Step 4 · Prompt Studio', title: 'Prompt Studio' })}${VC.ui.callout('danger', 'The prompt engine didn\'t load. Refresh the page to try again.')}`);
        return;
      }

      VC.mount(el, html`
        ${VC.ui.pageHead({
          eyebrow: 'Step 4 · Prompt Studio',
          title: 'Prompt Studio',
          lead: 'Paste-ready prompts for every step, plus tools to tighten your own prompts and break out of "fix one bug, get two" loops.',
        })}
        ${tabsBar()}
        ${activeTab === 'steps' ? stepsTab(p) : ''}
        ${activeTab === 'improve' ? improveTab() : ''}
        ${activeTab === 'stuck' ? stuckTab() : ''}
        ${activeTab === 'tips' ? tipsTab(p) : ''}
      `);

      /* ---------- Events ---------- */
      VC.delegate(el, 'click', '[data-tab]', (e, b) => { activeTab = b.getAttribute('data-tab'); ctx.rerender(); });

      VC.delegate(el, 'change', '[data-action="toggle-step"]', (e, input) => {
        const id = input.getAttribute('data-id');
        const on = input.checked;
        VC.store.update((q) => {
          q.prompts = q.prompts || { done: {} };
          q.prompts.done = q.prompts.done || {};
          if (on) q.prompts.done[id] = true; else delete q.prompts.done[id];
        });
        ctx.rerender();
      });

      VC.delegate(el, 'input', '#improve-input', (e, t) => { improverDraft = t.value; });
      VC.delegate(el, 'click', '[data-action="improve"]', async () => {
        const text = String(improverDraft || '').trim();
        if (!text) { VC.ui.toast('Paste a prompt first.', 'error'); return; }
        improving = true;
        ctx.rerender();
        try {
          improverResult = await PE().improveAI(text, ctx.project);
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t improve that prompt: ' + ((err && err.message) || err), 'error');
        } finally {
          improving = false;
          ctx.rerender();
        }
      });

      VC.delegate(el, 'input', '#stuck-goal', (e, t) => { stuckDraft.goal = t.value; });
      VC.delegate(el, 'input', '#stuck-error', (e, t) => { stuckDraft.error = t.value; });
      VC.delegate(el, 'input', '#stuck-tried', (e, t) => { stuckDraft.tried = t.value; });
      VC.delegate(el, 'change', '#stuck-situation', (e, sel) => {
        const sit = situationsList().find((s) => s.id === sel.value);
        stuckDraft.situation = sel.value;
        if (sit) {
          if (!stuckDraft.goal.trim() && sit.goal) stuckDraft.goal = sit.goal;
          if (!stuckDraft.error.trim() && sit.error) stuckDraft.error = sit.error;
        }
        ctx.rerender();
      });
      VC.delegate(el, 'click', '[data-action="stuck"]', () => {
        const input = { situation: stuckDraft.situation, goal: stuckDraft.goal, error: stuckDraft.error, tried: stuckDraft.tried };
        try {
          stuckResult = { prompt: PE().stuck(input, ctx.project), advice: PE().stuckAdvice(input, ctx.project) };
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t build that prompt: ' + ((err && err.message) || err), 'error');
          return;
        }
        ctx.rerender();
      });
    },
  });
})();
