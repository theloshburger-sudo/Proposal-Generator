/* Vibe Check — Idea → Directions (#/idea): turn one sentence into 3-4 buildable
   versions of the app, pick one (or mix features from a few), then head to the
   Build Kit. See docs/ARCHITECTURE.md → "1. Idea → Directions" and "Direction". */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const engine = () => (VC.engine && VC.engine.directions) || null;
  const DIFF_RANK = { easy: 1, medium: 2, hard: 3 };

  const EXAMPLES = [
    'An app where producers track which artists have their beats',
    'A marketplace where local bakers sell to neighbors',
    'A habit tracker with streaks and friendly reminders',
    'A booking app for a small yoga studio',
    'A tool that turns my notes into flashcards with AI',
    'A community board for my apartment building',
  ];

  /* ------------------------------------------------------------------ *
   * State that survives re-renders but isn't persisted: which direction
   * cards are checked for mixing. Reset whenever the direction set changes.
   * ------------------------------------------------------------------ */
  let selected = new Set();
  let selectedKey = '';
  let generating = false;

  function directionsKey(list) {
    return arr(list).map((d) => d && d.id).join(',');
  }

  function uniqBy(list, keyFn) {
    const seen = new Set();
    return list.filter((x) => {
      const k = keyFn(x);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /**
   * Combine 2+ chosen directions into one Direction. A single pick passes through unchanged.
   * The view only picks which whole cards go in; VC.engine.directions.mix works out the
   * needs, difficulty and cost so that logic lives in one place (see engine/directions.js).
   */
  function mixDirections(directions, ids) {
    const picks = ids.map((id) => directions.find((d) => d.id === id)).filter(Boolean);
    if (picks.length <= 1) return picks[0] || null;
    const primary = picks.slice().sort((a, b) => (DIFF_RANK[b.difficulty] || 2) - (DIFF_RANK[a.difficulty] || 2))[0];
    const features = uniqBy(picks.reduce((all, d) => all.concat(arr(d.features)), []), (f) => String(f).toLowerCase().trim());
    const screens = uniqBy(picks.reduce((all, d) => all.concat(arr(d.screens)), []), (s) => s && s.name).slice(0, 4);
    const D = engine();
    const mixed = D && D.mix ? D.mix(primary, features, directions) : Object.assign({}, primary, { id: VC.uid('d'), features });
    mixed.screens = screens.length ? screens : mixed.screens;
    mixed.mixOf = picks.map((d) => d.name);
    return mixed;
  }

  /* ------------------------------------------------------------------ *
   * Wireframe sketch (screens → .wire blocks)
   * ------------------------------------------------------------------ */
  const rowOf = (n) => html`<div class="wire-b row">${Array.from({ length: n }, () => html`<i></i>`)}</div>`;
  const bar = (h, w) => html`<div class="wire-b" style="height:${h}px${w ? ';width:' + w : ''}"></div>`;
  const BLOCKS = {
    nav: () => html`<div class="wire-b nav"></div>`,
    hero: () => html`<div class="wire-b hero"></div>`,
    button: () => html`<div class="wire-b btn"></div>`,
    tall: () => html`<div class="wire-b tall"></div>`,
    row2: () => rowOf(2),
    row3: () => rowOf(3),
    grid: () => rowOf(4),
    list: () => html`${bar(10)}${bar(10, '88%')}${bar(10, '72%')}`,
    table: () => html`<div class="wire-b" style="height:10px;background:var(--border-strong)"></div>${bar(10, '92%')}${bar(10, '92%')}`,
    form: () => html`${bar(14)}${bar(14, '80%')}<div class="wire-b btn"></div>`,
    chart: () => html`<div class="wire-b tall" style="background:linear-gradient(180deg,var(--surface-3),var(--accent-soft))"></div>`,
    map: () => html`<div class="wire-b tall" style="background:var(--surface-3)"></div>`,
    chat: () => html`${bar(14, '58%')}<div class="wire-b" style="height:14px;width:66%;margin-left:auto"></div>${bar(14, '46%')}`,
    player: () => html`${bar(34)}${rowOf(3)}`,
    calendar: () => html`${rowOf(4)}${rowOf(4)}`,
  };
  function wireframe(screen) {
    const blocks = arr(screen && screen.blocks).length ? screen.blocks : ['nav', 'hero'];
    return html`<div class="wire">${blocks.map((b) => (BLOCKS[b] || BLOCKS.tall)())}</div><div class="wire-label">${(screen && screen.name) || 'Screen'}</div>`;
  }

  /* ------------------------------------------------------------------ *
   * Sections
   * ------------------------------------------------------------------ */
  function ideaForm(project, opts) {
    opts = opts || {};
    const value = (project && project.idea) || '';
    return html`<section class="card pad-lg stack" aria-labelledby="idea-form-h">
      ${opts.compact ? '' : html`<h2 id="idea-form-h" class="mb-0">${opts.hasDirections ? 'Rewrite your idea' : 'What\'s your app idea?'}</h2>`}
      <form id="idea-form" class="stack">
        <div class="field">
          <label for="idea-text" class="small">One sentence is plenty</label>
          <textarea id="idea-text" class="big" rows="3" placeholder="An app for…" ${generating ? 'disabled' : ''}>${value}</textarea>
        </div>
        ${!opts.hasDirections ? html`<div>
          <span class="hint">Need inspiration? Try one:</span>
          <div class="option-group" style="margin-top:6px">
            ${EXAMPLES.map((x) => html`<button type="button" class="chip" data-action="example" ${generating ? 'disabled' : ''}>${x.length > 46 ? x.slice(0, 44) + '…' : x}</button>`)}
          </div>
        </div>` : ''}
        <div class="row">
          <button class="btn primary lg" type="submit" ${generating ? 'disabled' : ''}>
            ${generating ? html`<span class="spinner"></span> Thinking…` : html`${opts.hasDirections ? 'Get new directions' : 'Show me directions'} ${VC.icon('arrow', 18)}`}
          </button>
          ${!VC.ai.enabled() ? html`<span class="small muted">${VC.ui.term('Works offline', 'ai')}. Add a Claude key in <a href="#/settings">Settings</a> for directions tailored by AI.</span>` : html`<span class="small muted row sm">${VC.icon('sparkles', 14)} Using AI to write your directions</span>`}
        </div>
      </form>
    </section>`;
  }

  function moneyBadge(cost) {
    const free = /^free/i.test(cost || '');
    return VC.ui.badge(cost || '—', free ? 'green' : 'yellow');
  }

  function directionCard(d, ctxFlags) {
    const isChosen = ctxFlags.chosenId === d.id;
    const isPicked = selected.has(d.id);
    const features = arr(d.features).slice(0, 5);
    const screens = arr(d.screens).slice(0, 2);
    return html`<article class="card stack" id="dir-${d.id}">
      <div class="card-head mb-0">
        <div class="grow" style="min-width:0">
          <div class="row sm mb-0" style="margin-bottom:2px">
            <h3 class="mb-0">${d.name}</h3>
            ${isChosen ? VC.ui.badge(html`${VC.icon('check', 11)} Your pick`, 'accent') : ''}
            ${d.source === 'ai' ? VC.ui.badge(html`${VC.icon('sparkles', 11)} AI`, 'blue') : ''}
          </div>
          <p class="small text-2 mb-0">${d.pitch}</p>
        </div>
      </div>
      <div class="row sm">
        ${VC.ui.difficultyBadge(d.difficulty)}
        ${moneyBadge(d.monthlyCost)}
        ${d.audience ? html`<span class="tiny muted">For: ${d.audience}</span>` : ''}
      </div>
      ${screens.length ? html`<div class="grid-2">${screens.map(wireframe)}</div>` : ''}
      <ul class="small mb-0" style="padding-left:1.1em">${features.map((f) => html`<li>${f}</li>`)}</ul>
      ${d.vibe ? html`<p class="tiny muted mb-0">Look & feel: ${d.vibe}</p>` : ''}
      <div class="card-foot" style="margin-top:auto">
        <button class="btn primary sm" data-action="choose-one" data-id="${d.id}">Choose this</button>
        <label class="check small" style="margin-left:auto;gap:6px">
          <input type="checkbox" data-action="toggle-pick" data-id="${d.id}" ${isPicked ? 'checked' : ''}>
          <span>Add to a mix</span>
        </label>
      </div>
    </article>`;
  }

  function mixBar(directions) {
    if (selected.size < 2) return '';
    const names = Array.from(selected).map((id) => { const d = directions.find((x) => x.id === id); return d ? d.name : null; }).filter(Boolean);
    return html`<div class="card soft flat spread section" style="position:sticky;bottom:12px;box-shadow:var(--shadow-lg)">
      <span class="small">${VC.icon('wand', 16)} Mixing ${names.length}: <strong>${names.join(', ')}</strong></span>
      <button class="btn primary" data-action="choose-mix">Combine into one app ${VC.icon('arrow', 16)}</button>
    </div>`;
  }

  function chosenSummary(p) {
    const d = p.chosenDirection;
    return html`<section class="card pad-lg section" style="border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft), var(--shadow)">
      <div class="spread">
        <div class="grow" style="min-width:240px">
          <div class="row sm" style="margin-bottom:2px"><h2 class="mb-0">${d.name}</h2>${VC.ui.difficultyBadge(d.difficulty)}${moneyBadge(d.monthlyCost)}</div>
          <p class="text-2 mb-0">${d.pitch}</p>
          ${d.mixOf ? html`<p class="tiny muted mb-0">Mixed from: ${d.mixOf.join(', ')}</p>` : ''}
        </div>
        <a class="btn primary lg" href="#/kit">Continue to Build Kit ${VC.icon('arrow', 18)}</a>
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * View
   * ------------------------------------------------------------------ */
  VC.registerView({
    id: 'idea',
    title: 'Idea',
    navTitle: 'Your idea',
    icon: 'idea',
    nav: { group: 'journey', order: 1 },
    status(project) { return project && project.chosenDirection ? 'done' : 'todo'; },

    render(el, ctx) {
      const p = ctx.project;
      const directions = arr(p && p.directions);
      const key = directionsKey(directions);
      if (key !== selectedKey) { selected = new Set(); selectedKey = key; }

      const chosenId = p && p.chosenDirection ? p.chosenDirection.id : null;

      VC.mount(el, html`
        ${VC.ui.pageHead({
          eyebrow: 'Step 1 · Your idea',
          title: 'From idea to a real plan',
          lead: 'Type your idea in one sentence. We\'ll show you a few different ways to build it — pick the one that fits, or mix features from a few.',
        })}

        ${p && p.chosenDirection ? chosenSummary(p) : ''}

        ${directions.length ? ideaForm(p, { compact: true, hasDirections: true }) : ideaForm(p, { hasDirections: false })}

        ${directions.length ? html`
          <section class="section" aria-labelledby="idea-dirs-h">
            <div class="section-head">
              <div>
                <h2 id="idea-dirs-h">${p.chosenDirection ? 'All your directions' : 'Pick a direction'}</h2>
                <p class="small text-2 mb-0">Check "Add to a mix" on 2 or more to combine their features into one app.</p>
              </div>
            </div>
            <div class="grid-2">${directions.map((d) => directionCard(d, { chosenId }))}</div>
          </section>
          ${mixBar(directions)}
        ` : (generating ? html`<div class="loading"><span class="spinner"></span> Coming up with a few directions…</div>` : '')}
      `);

      /* ---------- Events ---------- */
      VC.delegate(el, 'click', '[data-action="example"]', (e, b) => {
        const t = el.querySelector('#idea-text');
        if (t) { t.value = b.textContent; t.focus(); }
      });

      VC.delegate(el, 'submit', '#idea-form', async (e) => {
        e.preventDefault();
        if (generating) return;
        const text = String(el.querySelector('#idea-text').value || '').trim();
        if (text.length < 4) { VC.ui.toast('Tell us a bit more about your idea.', 'error'); return; }

        let proj = VC.store.active();
        if (!proj) proj = VC.store.create(text);
        else VC.store.update((q) => { q.idea = text; q.chosenDirection = null; });

        const D = engine();
        if (!D) { VC.ui.toast('The directions engine didn\'t load. Refresh and try again.', 'error'); return; }

        generating = true;
        ctx.rerender();
        try {
          const list = await D.generate(text, (VC.store.active() || {}).answers || {});
          VC.store.update((q) => { q.directions = Array.isArray(list) ? list : []; });
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t come up with directions: ' + ((err && err.message) || err), 'error');
        } finally {
          generating = false;
          ctx.rerender();
        }
      });

      VC.delegate(el, 'change', '[data-action="toggle-pick"]', (e, b) => {
        const id = b.getAttribute('data-id');
        if (selected.has(id)) selected.delete(id); else selected.add(id);
        ctx.rerender();
      });

      VC.delegate(el, 'click', '[data-action="choose-one"]', (e, b) => {
        const id = b.getAttribute('data-id');
        const d = directions.find((x) => x.id === id);
        if (!d) return;
        VC.store.update((q) => { q.chosenDirection = VC.clone(d); if (!q.name) q.name = d.name; });
        VC.go('kit');
      });

      VC.delegate(el, 'click', '[data-action="choose-mix"]', () => {
        const mixed = mixDirections(directions, Array.from(selected));
        if (!mixed) return;
        VC.store.update((q) => { q.chosenDirection = mixed; if (!q.name) q.name = mixed.name; });
        VC.go('kit');
      });
    },
  });
})();
