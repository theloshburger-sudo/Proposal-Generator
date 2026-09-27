/* Vibe Check — App Map (#/map): pages, API routes, services and database
   tables pulled from the project's latest safety scan.
   See docs/ARCHITECTURE.md → "Visual app map" and Scanner types → ScanResult.map. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;
  const arr = (v) => (Array.isArray(v) ? v : []);

  let latestResult = null;

  function nodeCard(icon, title, sub, badge) {
    return html`<div class="card flat soft stack sm" style="padding:10px 12px">
      <div class="row sm" style="flex-wrap:nowrap;justify-content:space-between">
        <span class="row sm" style="flex-wrap:nowrap;min-width:0"><span style="color:var(--accent);flex:0 0 auto">${VC.icon(icon, 14)}</span><span class="small mono break">${title}</span></span>
        ${badge || ''}
      </div>
      ${sub ? html`<div class="tiny muted break">${sub}</div>` : ''}
    </div>`;
  }

  function column(title, icon, list) {
    return html`<div class="stack sm">
      <div class="row sm" style="font-weight:700">${VC.icon(icon, 16)} ${title} <span class="tiny muted">(${list.length})</span></div>
      <div class="stack sm">${list.length ? list : html`<div class="tiny muted">None found</div>`}</div>
    </div>`;
  }

  VC.registerView({
    id: 'map',
    title: 'App Map',
    icon: 'map',
    nav: { group: 'tools', order: 1 },

    render(el, ctx) {
      VC.db.get('scan:latest').then((r) => {
        const changed = (r && r.id) !== (latestResult && latestResult.id);
        if (changed) { latestResult = r || null; ctx.rerender(); }
      }).catch(() => { /* ignore */ });

      const m = latestResult ? latestResult.map : null;

      VC.mount(el, html`
        ${VC.ui.pageHead({ eyebrow: 'App map', title: 'Your app, mapped', lead: 'Pages, API routes, services and database tables, pulled from your latest safety scan.' })}
        ${!latestResult ? VC.ui.empty({
          icon: 'map', title: 'Scan your project first',
          body: 'The app map is built from your latest safety scan. Run a scan to see your pages, routes, services and tables here.',
          actionLabel: 'Go to Safety Scan', actionHref: '#/scan',
        }) : html`
          <div class="row sm" style="margin:-8px 0 16px">
            <span class="small muted">From the scan on ${VC.formatDate(latestResult.createdAt)}</span>
            <a class="btn ghost sm" href="#/scan">${VC.icon('refresh', 14)} Re-scan</a>
          </div>
          <div class="diagram">
            <div class="grid-4">
              ${column('Pages', 'file', arr(m.pages).map((p) => nodeCard('file', p.route || '/', p.file)))}
              ${column('API routes', 'code', arr(m.apiRoutes).map((r) => nodeCard('code', r.route, arr(r.methods).join(', '))))}
              ${column('Services', 'globe', arr(m.services).map((s) => nodeCard('globe', s.name, (arr(s.files)[0] || ''))))}
              ${column('Database tables', 'db', arr(m.tables).map((t) => nodeCard('db', t.name, t.rls === true ? 'RLS on' : t.rls === false ? 'RLS off' : 'RLS unknown', VC.ui.badge(t.rls === true ? 'Locked' : (t.rls === false ? 'Open' : '?'), t.rls === true ? 'green' : (t.rls === false ? 'red' : 'gray')))))}
            </div>
          </div>
          <section class="section" aria-labelledby="map-env-h">
            <div class="section-head"><h2 id="map-env-h">Environment variables</h2></div>
            <div class="table-wrap"><table>
              <thead><tr><th>Name</th><th>Type</th><th>Used in</th></tr></thead>
              <tbody>
                ${arr(m.envVars).length ? arr(m.envVars).map((e) => html`<tr>
                  <td class="mono small">${e.name}</td>
                  <td>${e.public ? VC.ui.badge('Public', 'green') : VC.ui.badge('Secret', 'red')}</td>
                  <td class="tiny muted">${arr(e.files).length} file${arr(e.files).length === 1 ? '' : 's'}</td>
                </tr>`) : html`<tr><td colspan="3" class="muted">None found</td></tr>`}
              </tbody>
            </table></div>
          </section>
        `}
      `);
    },
  });
})();
