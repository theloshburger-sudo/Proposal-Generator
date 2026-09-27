/* Vibe Check — Build Kit (#/kit): the builder, services, build plan, cost and safety rules
   for the chosen direction. Built offline by VC.engine.kit; swaps and rebuilds persist on project.kit. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  /** The quick questions a kit depends on (the builder has its own switch on the builder card). */
  const ANSWERS = [
    { key: 'platform', label: 'Where will people use it?', options: [['web', 'On the web'], ['mobile', 'As a phone app'], ['both', 'Web and phone']] },
    { key: 'accounts', label: 'Do people log in?', options: [['yes', 'Yes, with accounts'], ['no', 'No logins'], ['unsure', 'Not sure']] },
    { key: 'payments', label: 'Do you take payments?', options: [['none', 'No payments'], ['one-time', 'One-time payments'], ['subscription', 'Subscriptions'], ['marketplace', 'Buyers pay sellers (marketplace)']] },
    { key: 'ai', label: 'Does the app itself use AI?', options: [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] },
    { key: 'budget', label: 'Monthly budget', options: [['free', 'Free only'], ['low', 'A little (under ~$25/mo)'], ['flexible', 'Flexible']] },
    { key: 'experience', label: 'Your coding experience', options: [['never', 'Never coded'], ['some', 'Tinkered a bit'], ['shipped', 'Shipped apps before']] },
  ];
  /** Short labels for the answers summary chips. */
  const ANSWER_CHIPS = {
    platform: { web: 'Web app', mobile: 'Phone app', both: 'Web + phone' },
    accounts: { yes: 'Logins', no: 'No logins', unsure: 'Logins: not sure' },
    payments: { none: 'No payments', 'one-time': 'One-time payments', subscription: 'Subscriptions', marketplace: 'Marketplace payments' },
    ai: { yes: 'Uses AI', no: 'No AI', unsure: 'AI: not sure' },
    budget: { free: 'Free only', low: 'Small budget', flexible: 'Flexible budget' },
    experience: { never: 'New to coding', some: 'Some coding', shipped: 'Has shipped apps' },
  };
  const CATEGORY_ICONS = {
    hosting: 'globe', database: 'db', auth: 'user', payments: 'coin', ai: 'sparkles', email: 'file', storage: 'folder',
    maps: 'map', sms: 'prompt', analytics: 'eye', monitoring: 'warn', realtime: 'bolt', media: 'wand', 'version-control': 'refresh',
  };
  const SIZES = { S: ['S · Small', 'green', 'About 3–6 prompts'], M: ['M · Medium', 'blue', 'About 6–12 prompts'], L: ['L · Large', 'accent', 'About 10–20 prompts'] };
  const SETUP_MINUTES = { easy: 5, medium: 10, hard: 20 };
  const ICON_TILE = 'width:38px;height:38px;border-radius:11px;background:var(--accent-soft);color:var(--accent);display:grid;place-items:center;flex:0 0 38px';
  const LABEL = 'font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--muted);margin-bottom:6px';

  let answersOpen = false;   // keep the answers panel open across re-renders (not persisted)

  const arr = (v) => (Array.isArray(v) ? v : []);
  const engine = () => (VC.engine && VC.engine.kit) || null;
  const save = (kit) => VC.store.update((p) => { p.kit = kit; });

  function categoryIcon(cat) {
    const c = VC.data.categoryById ? VC.data.categoryById(cat) : null;
    return (c && c.icon) || CATEGORY_ICONS[cat] || 'kit';
  }
  function extLink(url, label, cls) {
    if (!url || !/^https?:\/\//i.test(String(url))) return '';
    return html`<a class="${cls || 'btn ghost sm'}" href="${url}" target="_blank" rel="noopener noreferrer">${label} ${VC.icon('external', 13)}</a>`;
  }
  function money(n) { return '$' + Math.round(Number(n) || 0); }

  /* ------------------------------------------------------------------ *
   * Sections
   * ------------------------------------------------------------------ */
  function answersPanel(p) {
    const a = p.answers || {};
    const chips = ANSWERS.map((q) => (ANSWER_CHIPS[q.key] || {})[a[q.key]]).filter(Boolean);
    return html`<details class="acc" id="kit-answers" ${answersOpen ? 'open' : ''}>
      <summary>
        <span class="row sm grow" style="font-weight:600">
          ${VC.icon('list', 16)} <span>Built from your answers</span>
          <span class="row sm" style="font-weight:500">${chips.length ? chips.map((c) => VC.ui.badge(c, 'gray')) : html`<span class="small muted">Tap to fill them in</span>`}</span>
        </span>
      </summary>
      <div class="acc-body stack">
        <p class="small text-2 mb-0">Change an answer, then rebuild your kit to match. Your service swaps are kept.</p>
        <div class="grid-3">
          ${ANSWERS.map((q) => html`<div class="field">
            <label for="ans-${q.key}" class="small">${q.label}</label>
            <select id="ans-${q.key}" data-answer="${q.key}">
              ${a[q.key] ? '' : html`<option value="" selected disabled>Choose…</option>`}
              ${q.options.map((o) => html`<option value="${o[0]}" ${a[q.key] === o[0] ? 'selected' : ''}>${o[1]}</option>`)}
            </select>
          </div>`)}
        </div>
      </div>
    </details>`;
  }

  function builderCard(kit, K) {
    const b = K.builder(kit) || { id: kit.builder.id, name: kit.builder.id };
    const allBuilders = arr(VC.data.builders).filter((x) => x && x.id);
    const alts = arr(kit.builder.alternatives).map((id) => allBuilders.find((x) => x.id === id) || K.builderInfo(id)).filter(Boolean);
    const others = allBuilders.filter((x) => x.id !== b.id && !alts.some((y) => y.id === x.id));
    const mine = kit.builder.chosenBy === 'you';
    return html`<section class="section" aria-labelledby="kit-builder-h">
      <div class="section-head"><h2 id="kit-builder-h">Your builder</h2><span class="small muted">The AI tool you'll build ${kit.directionName || 'your app'} with</span></div>
      <div class="card pad-lg stack">
        <div class="spread" style="align-items:flex-start">
          <div class="row" style="flex-wrap:nowrap;align-items:flex-start;min-width:0">
            <span style="${ICON_TILE};width:48px;height:48px;flex-basis:48px;border-radius:14px">${VC.icon('wand', 24)}</span>
            <div class="grow">
              <div class="row sm" style="margin-bottom:2px">
                <h3 class="mb-0" style="font-size:1.35rem">${b.name}</h3>
                ${mine ? VC.ui.badge('Your pick', 'blue') : VC.ui.badge(html`${VC.icon('sparkles', 12)} Recommended for you`, 'accent')}
              </div>
              ${b.tagline ? html`<div class="text-2 small">${b.tagline}</div>` : ''}
            </div>
          </div>
          ${extLink(b.url, 'Open ' + b.name, 'btn')}
        </div>
        <p class="mb-0">${kit.builder.reason}</p>
        ${kit.builder.warning ? VC.ui.callout('warn', kit.builder.warning) : ''}
        ${b.defaultStack || b.pricing || b.versionControl ? html`<dl class="kv small mb-0">
          ${b.defaultStack ? html`<dt>Builds with</dt><dd>${b.defaultStack}</dd>` : ''}
          ${b.pricing ? html`<dt>Price</dt><dd>${b.pricing}</dd>` : ''}
          ${b.versionControl ? html`<dt>Saving your work</dt><dd>${b.versionControl}</dd>` : ''}
        </dl>` : ''}
        ${allBuilders.length > 1 ? html`<div class="card-foot">
          <label for="builder-switch" class="small text-2">Using a different tool?</label>
          <select id="builder-switch" style="width:auto;min-width:0;max-width:100%;padding:7px 10px;font-size:.88rem">
            <option value="${b.id}" selected>${b.name}${mine ? '' : ' (recommended)'}</option>
            ${alts.length ? html`<optgroup label="Also a good fit">${alts.filter((x) => x.id !== b.id).map((x) => html`<option value="${x.id}">${x.name}</option>`)}</optgroup>` : ''}
            ${others.length ? html`<optgroup label="Other builders">${others.map((x) => html`<option value="${x.id}">${x.name}</option>`)}</optgroup>` : ''}
            ${mine ? html`<option value="unsure">Not sure: recommend one for me</option>` : ''}
          </select>
        </div>` : ''}
      </div>
    </section>`;
  }

  function keySummary(s) {
    const keys = arr(s && s.keys);
    if (!keys.length) return html`<span class="muted">No keys needed</span>`;
    const pub = keys.filter((k) => k.visibility !== 'secret').length;
    const sec = keys.length - pub;
    return html`<span class="row sm" style="gap:4px 10px">
      ${pub ? html`<span class="row sm" style="gap:5px" title="Public keys are safe to use inside your app"><span class="dot green"></span>${pub} public</span>` : ''}
      ${sec ? html`<span class="row sm" style="gap:5px" title="Secret keys must stay on the server, never in your app's code"><span class="dot red"></span>${sec} secret</span>` : ''}
    </span>`;
  }

  function swapSelect(label, name, options) {
    if (!options.length) return '';
    return html`<select data-swap aria-label="${label}" style="width:auto;flex:1 1 150px;min-width:0;max-width:260px;padding:6px 10px;font-size:.85rem">
      <option value="" selected>${name}</option>
      ${options.map((o) => html`<option value="${o.value}">${o.label}</option>`)}
    </select>`;
  }

  function serviceCard(g, kit, K) {
    const s = g.service || { id: g.serviceId, name: g.serviceId };
    const b = K.builder(kit) || { id: '', name: '' };
    const native = b.id && K.isNative(g.serviceId, b.id);
    const cats = g.categories;
    const options = K.swapOptions(kit, g.serviceId).map((o) => ({
      value: o.category + '|' + o.serviceId,
      label: o.name + (o.takesOver.length && o.takesOver.length < cats.length ? ' (' + o.takesOver.map(K.categoryShort).join(', ') + ' only)' : ''),
    }));
    if (cats[0] === 'hosting' && kit.hosting && kit.hosting.canUseBuiltIn) {
      const bi = K.builtInHosting(b.id);
      if (bi) options.unshift({ value: 'hosting|builtin', label: bi.name });
    }
    return html`<article class="card stack sm" id="svc-${g.serviceId}">
      <div class="card-head mb-0">
        <div class="row" style="flex-wrap:nowrap;min-width:0">
          <span style="${ICON_TILE}">${VC.icon(categoryIcon(cats[0]), 19)}</span>
          <div class="grow">
            <h3 class="mb-0">${s.name}</h3>
            ${s.tagline ? html`<div class="small muted">${s.tagline}</div>` : ''}
          </div>
        </div>
        <div class="row sm" style="justify-content:flex-end">
          ${g.required ? '' : VC.ui.badge('Optional', 'gray')}
          ${g.chosenBy === 'you' ? VC.ui.badge('Your pick', 'blue') : ''}
        </div>
      </div>
      <div class="row sm">
        ${cats.map((c) => VC.ui.badge(K.categoryName(c), 'accent'))}
        ${native ? VC.ui.badge(html`${VC.icon('bolt', 11)} Built into ${b.name}`, 'green') : ''}
      </div>
      <p class="small text-2 mb-0">${g.reason}</p>
      <dl class="kv small mb-0" style="margin-top:4px">
        ${s.freeTier ? html`<dt>Free plan</dt><dd>${s.freeTier}</dd>` : ''}
        ${s.difficulty ? html`<dt>Setup</dt><dd>${VC.ui.difficultyBadge(s.difficulty)}</dd>` : ''}
        ${g.serviceId !== 'github' || arr(s.keys).length ? html`<dt>${VC.ui.term('Keys', 'api key')}</dt><dd>${keySummary(s)}</dd>` : ''}
      </dl>
      <div class="card-foot" style="margin-top:auto">
        ${swapSelect('Swap ' + s.name + ' for another service', 'Swap for…', options)}
        <span class="row sm" style="margin-left:auto">
          ${extLink(s.website, 'Learn more')}
          ${extLink(s.docsUrl, 'Docs')}
        </span>
      </div>
    </article>`;
  }

  function builtInHostingCard(kit, K) {
    const h = kit.hosting;
    const options = arr(h.alternatives).map((id) => {
      const s = K.service(id);
      return s ? { value: 'hosting|' + id, label: s.name } : null;
    }).filter(Boolean);
    return html`<article class="card stack sm" id="svc-hosting">
      <div class="card-head mb-0">
        <div class="row" style="flex-wrap:nowrap;min-width:0">
          <span style="${ICON_TILE}">${VC.icon('globe', 19)}</span>
          <div class="grow"><h3 class="mb-0">${h.name}</h3><div class="small muted">Built in: nothing to sign up for</div></div>
        </div>
        ${VC.ui.badge(html`${VC.icon('check', 11)} Included`, 'green')}
      </div>
      <div class="row sm">${VC.ui.badge(K.categoryName('hosting'), 'accent')}</div>
      <p class="small text-2 mb-0">${h.note}</p>
      ${h.appStores ? html`<p class="small text-2 mb-0">For the App Store and Google Play, your builder packages the phone app with Expo. The Launch checklist walks you through it.</p>` : ''}
      <dl class="kv small mb-0" style="margin-top:4px"><dt>Cost</dt><dd>Free with your builder</dd><dt>${VC.ui.term('Keys', 'api key')}</dt><dd><span class="muted">No keys needed</span></dd></dl>
      <div class="card-foot" style="margin-top:auto">
        ${swapSelect('Use a separate hosting service instead', 'Host somewhere else…', options)}
      </div>
    </article>`;
  }

  function servicesSection(kit, K) {
    const groups = K.groups(kit);
    const swapped = Object.keys(kit.choices || {}).length > 0;
    const count = groups.filter((g) => g.required).length;
    return html`<section class="section" aria-labelledby="kit-svc-h">
      <div class="section-head">
        <div>
          <h2 id="kit-svc-h">What you'll need</h2>
          <p class="small text-2 mb-0">${count} ${count === 1 ? 'account' : 'accounts'} to set up. Each gives you ${VC.ui.term('API keys', 'api key')}: <span class="dot green" style="vertical-align:middle"></span> public ones are safe inside your app, <span class="dot red" style="vertical-align:middle"></span> secret ones must stay on the ${VC.ui.term('backend')}.</p>
        </div>
        ${swapped ? html`<button class="btn ghost sm" data-action="reset-swaps">${VC.icon('refresh', 14)} Back to our picks</button>` : ''}
      </div>
      <div class="grid-2">
        ${kit.hosting && kit.hosting.builtIn ? builtInHostingCard(kit, K) : ''}
        ${groups.map((g) => serviceCard(g, kit, K))}
      </div>
    </section>`;
  }

  function milestoneItem(m, i, K) {
    const size = SIZES[m.size] || SIZES.M;
    const names = arr(m.services).map((id) => { const s = K.service(id); return s ? s.name : null; }).filter(Boolean);
    return html`<li>
      <details class="acc" ${i === 0 ? 'open' : ''}>
        <summary>
          <span class="grow" style="min-width:0">
            <span class="row sm" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
              <span class="bold">${m.title}</span>
              <span class="badge ${size[1]}" title="${size[2]}">${size[0]}</span>
            </span>
            <span class="small text-2" style="display:block;font-weight:400;margin-top:2px">${m.goal}</span>
          </span>
        </summary>
        <div class="acc-body">
          <div class="grid-2">
            <div>
              <div style="${LABEL}">What gets built</div>
              <ul class="small mb-0">${arr(m.features).map((f) => html`<li>${f}</li>`)}</ul>
            </div>
            <div>
              <div style="${LABEL}">Done when…</div>
              <ul class="small mb-0 stack sm" style="list-style:none;padding:0;gap:4px">
                ${arr(m.doneWhen).map((d) => html`<li class="row top sm" style="flex-wrap:nowrap;margin:0"><span style="color:var(--green);margin-top:3px;flex:0 0 14px">${VC.icon('check', 14)}</span><span class="grow">${d}</span></li>`)}
              </ul>
            </div>
          </div>
          ${names.length ? html`<div class="row sm small muted" style="margin-top:12px">Uses ${names.map((n) => VC.ui.badge(n, 'gray'))}</div>` : ''}
        </div>
      </details>
    </li>`;
  }

  function planSection(kit, K) {
    const ms = arr(kit.milestones);
    return html`<section class="section" aria-labelledby="kit-plan-h">
      <div class="section-head">
        <div>
          <h2 id="kit-plan-h">Your build plan</h2>
          <p class="small text-2 mb-0">${ms.length} small steps, in the order that keeps things from breaking. Build one, check it works, then move on. ${typeof VC.views === 'object' && VC.views.prompts ? html`<a href="#/prompts">Prompt Studio</a> writes the prompt for each step.` : ''}</p>
        </div>
        <span class="row sm tiny muted">${Object.keys(SIZES).map((k) => html`<span class="badge ${SIZES[k][1]}" title="${SIZES[k][2]}">${k}</span> ${SIZES[k][2].replace('About ', '≈ ')}`)}</span>
      </div>
      <ol class="numbered">${ms.map((m, i) => milestoneItem(m, i, K))}</ol>
    </section>`;
  }

  function costSection(kit) {
    const c = kit.cost || {};
    const lines = arr(c.lines);
    const lo = Number(c.monthlyLow) || 0;
    const hi = Math.max(lo, Number(c.monthlyHigh) || 0);
    const row = (l) => html`<tr>
      <td><div class="bold">${l.label}</div>${l.note ? html`<div class="tiny muted">${l.note}</div>` : ''}</td>
      <td style="text-align:right;white-space:nowrap">${/^Free/.test(l.amount) ? html`<span class="badge green">${l.amount}</span>` : html`<span class="bold">${l.amount}</span>`}</td>
    </tr>`;
    return html`<section class="section" aria-labelledby="kit-cost-h">
      <div class="section-head"><h2 id="kit-cost-h">What it costs</h2></div>
      <div class="card stack">
        <div class="grid-2">
          <div class="stat"><span class="stat-value">${money(lo)}<span class="small muted" style="font-weight:500">/mo</span></span><span class="stat-label">To get started</span></div>
          <div class="stat"><span class="stat-value">${hi > lo ? '~' + money(hi) : money(hi)}<span class="small muted" style="font-weight:500">/mo</span></span><span class="stat-label">${hi > lo ? 'Once you have real users (rough guess)' : 'Stays this way for a small app'}</span></div>
        </div>
        ${VC.ui.callout('success', html`<strong>Most things are free to start.</strong> You only start paying when real people use your app, and every paid service lets you set a spending limit.`, 'coin')}
        ${c.budgetNote ? VC.ui.callout('warn', c.budgetNote) : ''}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Running your app</th><th style="text-align:right">Monthly</th></tr></thead>
            <tbody>
              ${lines.length ? lines.map(row) : html`<tr><td colspan="2" class="muted">No paid services. Nice.</td></tr>`}
              ${c.builder || arr(c.extras).length ? html`<tr><th colspan="2">While you build</th></tr>` : ''}
              ${c.builder ? row(c.builder) : ''}
              ${arr(c.extras).map(row)}
            </tbody>
          </table>
        </div>
        ${c.buildNote ? html`<p class="small text-2 mb-0 row top sm" style="flex-wrap:nowrap"><span style="color:var(--accent);margin-top:2px">${VC.icon('bolt', 16)}</span><span class="grow">${c.buildNote}</span></p>` : ''}
      </div>
    </section>`;
  }

  function safetySection(kit) {
    const rules = arr(kit.safetyRules);
    if (!rules.length) return '';
    return html`<section class="section" aria-labelledby="kit-safe-h">
      <div class="section-head"><h2 id="kit-safe-h">Safety rules we'll bake into your prompts</h2></div>
      <div class="card stack">
        <p class="small text-2 mb-0">Most leaks in AI-built apps come from a handful of mistakes. Every prompt Vibe Check writes for you includes these rules, so your builder keeps your ${VC.ui.term('API keys', 'api key')} secret and your ${VC.ui.term('database')} locked from the very first line of code.</p>
        <ul class="stack sm mb-0" style="list-style:none;padding:0">
          ${rules.map((r) => html`<li class="row top sm" style="flex-wrap:nowrap;margin:0"><span style="color:var(--green);margin-top:2px;flex:0 0 16px">${VC.icon('shield', 16)}</span><span class="grow small">${r}</span></li>`)}
        </ul>
      </div>
    </section>`;
  }

  function nextStep(kit, K) {
    const svcs = K.groups(kit).filter((g) => g.required);
    const mins = svcs.reduce((n, g) => n + (SETUP_MINUTES[(g.service && g.service.difficulty) || 'medium'] || 10), 0);
    return html`<section class="card pad-lg section" style="border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft), var(--shadow)">
      <div class="spread">
        <div class="grow" style="min-width:240px">
          <h2 class="mb-0">Next, get your keys</h2>
          <p class="text-2 mb-0">${svcs.length
            ? `We'll walk you through each account, click by click, and show exactly where every key goes. ${svcs.length} ${svcs.length === 1 ? 'account' : 'accounts'}, about ${Math.max(5, mins)} minutes.`
            : 'Nothing to sign up for yet. The setup page still shows where settings go in your builder.'}</p>
        </div>
        <div class="row">
          <button class="btn ghost" data-action="rebuild" title="Rebuild the kit from your latest answers">${VC.icon('refresh', 16)} Rebuild kit</button>
          <a class="btn primary lg" href="#/setup">Next: set up your accounts ${VC.icon('arrow', 18)}</a>
        </div>
      </div>
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * View
   * ------------------------------------------------------------------ */
  VC.registerView({
    id: 'kit',
    title: 'Build Kit',
    icon: 'kit',
    nav: { group: 'journey', order: 2 },
    status(project) { return project && project.kit ? 'done' : 'todo'; },

    render(el, ctx) {
      const p = ctx.project;
      if (!p || !p.chosenDirection) {
        VC.mount(el, html`
          ${VC.ui.pageHead({ eyebrow: 'Step 2 · Build kit', title: 'Your build kit', lead: 'The tools, accounts and step-by-step plan for your app.' })}
          ${VC.ui.empty({
            icon: 'kit',
            title: p ? 'Pick a direction first' : 'Start with your idea',
            body: p
              ? 'Your kit is made for the version of the app you choose. Pick one of your directions and we\'ll put it together.'
              : 'Tell us your app idea in one sentence. We\'ll suggest a few directions, then build the kit for the one you pick.',
            actionLabel: p ? 'Choose a direction' : 'Describe your idea',
            actionHref: '#/idea',
          })}`);
        return;
      }

      const K = engine();
      if (!K) {
        VC.mount(el, html`${VC.ui.pageHead({ eyebrow: 'Step 2 · Build kit', title: 'Your build kit' })}
          ${VC.ui.callout('danger', html`<strong>The build kit didn't load.</strong> Refresh the page to try again.`)}`);
        return;
      }

      // Build the kit on first visit; rebuild automatically if the chosen direction changed.
      let kit = p.kit;
      try {
        if (!kit || !Array.isArray(kit.services) || !kit.builder) {
          kit = K.build(p);
          save(kit);
        } else if (K.isStale(p) === 'direction') {
          kit = K.build(p);
          save(kit);
          VC.ui.toast('Kit updated for ' + (p.chosenDirection.name || 'your new direction'));
        }
      } catch (err) {
        console.error(err);
        VC.mount(el, html`${VC.ui.pageHead({ eyebrow: 'Step 2 · Build kit', title: 'Your build kit' })}
          ${VC.ui.callout('danger', html`<strong>We couldn't put your kit together.</strong> ${String((err && err.message) || err)}<div class="mt"><button class="btn sm" data-action="retry">Try again</button></div>`)}`);
        VC.delegate(el, 'click', '[data-action="retry"]', () => ctx.rerender());
        return;
      }

      const d = p.chosenDirection;
      const staleAnswers = K.isStale(p) === 'answers';
      const groups = K.groups(kit);
      const lo = Number(kit.cost && kit.cost.monthlyLow) || 0;

      VC.mount(el, html`
        ${VC.ui.pageHead({
          eyebrow: 'Step 2 · Your build kit',
          title: d.name || 'Your app',
          lead: d.pitch || 'Everything you need to build it: the tool, the accounts, and a step-by-step plan.',
          actions: html`<a class="btn ghost sm" href="#/idea">${VC.icon('back', 14)} Change direction</a>`,
        })}
        <div class="row sm" style="margin:-12px 0 16px">
          ${d.difficulty ? html`<span class="small muted">Difficulty</span> ${VC.ui.difficultyBadge(d.difficulty)}` : ''}
          ${VC.ui.badge(lo === 0 ? 'Free to start' : '~' + money(lo) + '/mo to start', lo === 0 ? 'green' : 'yellow')}
          ${VC.ui.badge(groups.length + (kit.hosting && kit.hosting.builtIn ? 1 : 0) + ' tools & services', 'gray')}
          ${VC.ui.badge(arr(kit.milestones).length + ' build steps', 'gray')}
        </div>

        ${staleAnswers ? html`<div class="mb">${VC.ui.callout('warn', html`<div class="spread"><span><strong>Your answers changed.</strong> Rebuild the kit so it matches them.</span><button class="btn sm primary" data-action="rebuild">${VC.icon('refresh', 14)} Rebuild kit</button></div>`)}</div>` : ''}

        ${answersPanel(p)}
        ${builderCard(kit, K)}
        ${servicesSection(kit, K)}
        ${planSection(kit, K)}
        ${costSection(kit)}
        ${safetySection(kit)}
        ${nextStep(kit, K)}
      `);

      /* ---------- Events ---------- */
      const rebuild = (opts, message) => {
        try {
          const next = K.build(VC.store.active(), opts);
          save(next);
          VC.ui.toast(message || 'Kit rebuilt', 'success');
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t rebuild the kit: ' + ((err && err.message) || err), 'error');
        }
        ctx.rerender();
      };

      VC.delegate(el, 'click', '[data-action]', (e, b) => {
        const act = b.getAttribute('data-action');
        if (act === 'rebuild') rebuild(null, 'Kit rebuilt from your latest answers');
        else if (act === 'reset-swaps') rebuild({ choices: {} }, 'Back to our recommended picks');
      });

      // Remember whether the answers panel is open, so re-renders don't collapse it.
      const panel = el.querySelector('#kit-answers');
      if (panel) panel.addEventListener('toggle', () => { answersOpen = panel.open; });

      VC.delegate(el, 'change', 'select[data-answer]', (e, sel) => {
        const key = sel.getAttribute('data-answer');
        const value = sel.value;
        VC.store.update((q) => { q.answers = q.answers || {}; q.answers[key] = value; });
        answersOpen = true;
        ctx.rerender();
      });

      VC.delegate(el, 'change', '#builder-switch', (e, sel) => {
        const id = sel.value;
        const before = kit.builder.id;
        try {
          VC.store.update((q) => {
            q.answers = q.answers || {};
            q.answers.builder = id;
            q.kit = K.build(q);
          });
          const now = VC.store.active().kit;
          const name = (K.builder(now) || {}).name || id;
          VC.ui.toast(id === 'unsure' ? `We recommend ${name} for this app` : (now.builder.id !== before ? `Switched to ${name}. Your kit is updated.` : 'Kit updated'), 'success');
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t switch builders: ' + ((err && err.message) || err), 'error');
        }
        ctx.rerender();
      });

      VC.delegate(el, 'change', 'select[data-swap]', (e, sel) => {
        const parts = String(sel.value || '').split('|');
        if (parts.length !== 2) return;
        const [category, serviceId] = parts;
        const before = {};
        arr(kit.services).forEach((s) => { before[s.category] = s.serviceId; });
        try {
          const next = K.swapService(VC.store.active(), category, serviceId);
          save(next);
          if (serviceId === 'builtin') {
            VC.ui.toast('Back to your builder\'s own publishing', 'success');
          } else {
            const moved = arr(next.services).filter((s) => s.serviceId === serviceId && before[s.category] !== serviceId).map((s) => K.categoryShort(s.category));
            const name = (K.service(serviceId) || {}).name || serviceId;
            VC.ui.toast(moved.length ? `${name} now handles ${moved.length > 1 ? moved.slice(0, -1).join(', ') + ' and ' + moved[moved.length - 1] : moved[0]}` : `Switched to ${name}`, 'success');
          }
        } catch (err) {
          console.error(err);
          VC.ui.toast('Couldn\'t swap that service: ' + ((err && err.message) || err), 'error');
        }
        ctx.rerender();
      });
    },
  });
})();
