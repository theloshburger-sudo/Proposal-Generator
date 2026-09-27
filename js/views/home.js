/* Vibe Check — Home (#/): the journey overview, your current project's progress,
   and a switcher for previous projects. Has no nav group; the router shows it
   pinned above "Your build" automatically. See docs/ARCHITECTURE.md → Views. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  const arr = (v) => (Array.isArray(v) ? v : []);

  /** The registered journey-group views, in nav order, with each one's status for `p`. */
  function journeySteps(p) {
    const list = Object.values(VC.views || {})
      .filter((v) => v && v.nav && v.nav.group === 'journey')
      .sort((a, b) => (a.nav.order || 0) - (b.nav.order || 0));
    return list.map((v) => {
      let status = 'todo';
      try { status = p && typeof v.status === 'function' ? v.status(p) : 'todo'; } catch (e) { status = 'todo'; }
      return { id: v.id, title: v.navTitle || v.title, icon: v.icon || 'info', status };
    });
  }

  function firstIncomplete(steps) {
    const s = steps.find((x) => x.status !== 'done');
    return (s || steps[0] || { id: 'idea' }).id;
  }

  function projectLabel(p) {
    return (p.chosenDirection && p.chosenDirection.name) || p.name || p.idea || 'Untitled idea';
  }

  function stepRow(s) {
    const done = s.status === 'done';
    return html`<a class="row" href="#/${s.id}" style="text-decoration:none;padding:9px 4px;border-bottom:1px solid var(--border)">
      <span style="width:26px;height:26px;border-radius:50%;flex:0 0 26px;display:grid;place-items:center;background:${done ? 'var(--green)' : 'var(--surface-3)'};color:${done ? '#fff' : 'var(--muted)'}">
        ${done ? VC.icon('check', 14) : VC.icon(s.icon, 14)}
      </span>
      <span class="grow" style="color:var(--text);font-weight:600">${s.title}</span>
      <span class="small muted">${done ? 'Done' : 'To do'}</span>
    </a>`;
  }

  function continueCard(p) {
    const steps = journeySteps(p);
    const doneCount = steps.filter((s) => s.status === 'done').length;
    const next = firstIncomplete(steps);
    const nextView = VC.views[next];
    return html`<section class="card pad-lg stack section" aria-labelledby="home-continue-h">
      <div class="spread">
        <div class="grow" style="min-width:240px">
          <div class="eyebrow" style="color:var(--accent);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Your project</div>
          <h2 id="home-continue-h" class="mb-0">${projectLabel(p)}</h2>
          ${p.chosenDirection && p.chosenDirection.pitch ? html`<p class="text-2 mb-0">${p.chosenDirection.pitch}</p>` : ''}
        </div>
        <a class="btn primary lg" href="#/${next}">${doneCount === 0 ? 'Get started' : 'Continue'} ${VC.icon('arrow', 18)}</a>
      </div>
      <div class="mt">${VC.ui.meter((doneCount / (steps.length || 1)) * 100)}</div>
      <div class="grid-2" style="margin-top:6px">${steps.map(stepRow)}</div>
      ${nextView ? html`<p class="small muted mb-0">Next up: <strong>${nextView.title}</strong></p>` : ''}
    </section>`;
  }

  function projectCard(p, isActive) {
    const steps = journeySteps(p);
    const doneCount = steps.filter((s) => s.status === 'done').length;
    return html`<article class="card stack sm" data-project="${p.id}">
      <div class="card-head mb-0">
        <div class="grow" style="min-width:0">
          <h3 class="mb-0" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${projectLabel(p)}</h3>
          <div class="tiny muted">Updated ${VC.formatDate(p.updatedAt)}</div>
        </div>
        ${isActive ? VC.ui.badge('Current', 'accent') : ''}
      </div>
      <div class="row sm">${VC.ui.meter((doneCount / (steps.length || 1)) * 100)}<span class="tiny muted nowrap">${doneCount}/${steps.length}</span></div>
      <div class="card-foot" style="margin-top:auto">
        ${isActive ? '' : html`<button class="btn sm" data-action="open" data-id="${p.id}">Open</button>`}
        <button class="btn ghost sm danger" data-action="delete" data-id="${p.id}" style="margin-left:auto">${VC.icon('trash', 14)}</button>
      </div>
    </article>`;
  }

  function journeyExplainer() {
    const STEPS = [
      ['idea', 'Idea', 'Tell us your idea in one sentence'],
      ['kit', 'Build Kit', 'The tools, accounts and plan'],
      ['setup', 'Setup', 'Get your keys, click by click'],
      ['prompts', 'Prompts', 'Paste-ready prompts, in order'],
      ['scan', 'Check', 'Scan for leaks and mistakes'],
      ['ship', 'Ship', 'A launch checklist for your stack'],
    ];
    return html`<section class="section" aria-labelledby="home-journey-h">
      <div class="section-head"><h2 id="home-journey-h">How it works</h2></div>
      <div class="grid-3">
        ${STEPS.map(([id, title, body], i) => html`<div class="card flat soft stack sm">
          <span class="row sm" style="color:var(--accent);font-weight:700"><span style="width:24px;height:24px;border-radius:50%;background:var(--accent-soft);display:grid;place-items:center;flex:0 0 24px;font-size:.78rem">${i + 1}</span>${title}</span>
          <p class="small text-2 mb-0">${body}</p>
        </div>`)}
      </div>
    </section>`;
  }

  VC.registerView({
    id: 'home',
    title: 'Vibe Check',
    icon: 'home',
    render(el, ctx) {
      el.classList.remove('narrow');
      const p = ctx.project;
      const projects = VC.store.projects();

      VC.mount(el, html`
        <div class="hero">
          <div class="eyebrow" style="color:var(--accent);font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;font-weight:700">Vibe Check</div>
          <h1><span class="gradient-text">Tell it your idea.</span> It handles the hard parts.</h1>
          <p class="lead text-2">It shows you what your app could be, gives you everything you need to build it, writes the prompts, and checks your work — so the hard parts of vibe coding stop being hard.</p>
          ${!p ? html`<div class="row" style="margin-top:6px"><a class="btn primary lg" href="#/idea">Describe your idea ${VC.icon('arrow', 18)}</a></div>` : ''}
        </div>

        ${p ? continueCard(p) : ''}
        ${journeyExplainer()}

        ${projects.length > 1 ? html`<section class="section" aria-labelledby="home-projects-h">
          <div class="section-head">
            <h2 id="home-projects-h">Your projects</h2>
            <button class="btn ghost sm" data-action="new">${VC.icon('plus', 14)} New idea</button>
          </div>
          <div class="grid-3">${projects.map((pr) => projectCard(pr, p && pr.id === p.id))}</div>
        </section>` : (p ? html`<div class="row"><button class="btn ghost sm" data-action="new">${VC.icon('plus', 14)} Start a different idea</button></div>` : '')}
      `);

      VC.delegate(el, 'click', '[data-action]', async (e, b) => {
        const act = b.getAttribute('data-action');
        const id = b.getAttribute('data-id');
        if (act === 'new') {
          const cur = VC.store.active();
          if (!cur || cur.idea || cur.chosenDirection) VC.store.create('');
          VC.go('idea');
        } else if (act === 'open') {
          VC.store.setActive(id);
          ctx.rerender();
        } else if (act === 'delete') {
          const target = projects.find((x) => x.id === id);
          const ok = await VC.ui.confirm('Delete this project?', `This removes "${target ? projectLabel(target) : 'this project'}" and everything saved for it. It can't be undone.`, 'Delete project');
          if (ok) { VC.store.remove(id); ctx.rerender(); }
        }
      });
    },
  });
})();
