/* Vibe Check — Safety Scan (#/scan): drag in a project folder or .zip and get an
   offline, in-browser A–F report card. Nothing ever leaves the browser here.
   See docs/ARCHITECTURE.md → "5. Check (Safety Scan)" and Engines → VC.engine.scanner. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  const arr = (v) => (Array.isArray(v) ? v : []);
  const engine = () => (VC.engine && VC.engine.scanner) || null;
  const LABEL = 'font-size:.72rem;text-transform:uppercase;letter-spacing:.07em;font-weight:700;color:var(--muted);margin-bottom:6px';
  const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const CATS = [
    ['secrets', 'Leaked secrets', 'key'],
    ['database', 'Database locks', 'db'],
    ['config', 'Setup mistakes', 'settings'],
    ['code', 'Risky code', 'code'],
    ['deps', 'Unprotected endpoints', 'globe'],
  ];

  /* ------------------------------------------------------------------ *
   * Module state — a live scan and its progress are too big/ephemeral to
   * persist; only the small ScanSummary goes on project.scans.
   * ------------------------------------------------------------------ */
  let scanning = false;
  let progress = { done: 0, total: 0 };
  let currentResult = null;   // full ScanResult being shown (live or a past one)
  let currentDiff = null;     // {added, fixed, filesChanged, ...} vs the previous scan, or null
  let viewingPastId = null;   // id of a history entry being viewed, or null for the live result
  let lastProjectId = null;   // whichever project this module state belongs to

  function gradeColor(g) { return g === 'A' || g === 'B' ? 'green' : g === 'C' ? 'yellow' : 'red'; }

  /* ------------------------------------------------------------------ *
   * Sections
   * ------------------------------------------------------------------ */
  function dropzone() {
    return html`<div class="dropzone" id="scan-drop">
      ${VC.icon('upload', 30)}
      <h3 class="mt mb-0">Drag your project folder or a .zip here</h3>
      <p class="text-2">It all runs right here in your browser. Nothing is uploaded anywhere.</p>
      <div class="row" style="justify-content:center">
        <label class="btn primary">${VC.icon('folder', 16)} Choose a folder<input type="file" id="scan-folder-input" webkitdirectory directory multiple hidden></label>
        <label class="btn">${VC.icon('file', 16)} Choose a .zip<input type="file" id="scan-zip-input" accept=".zip,application/zip" hidden></label>
      </div>
    </div>`;
  }

  function whatWeCheck() {
    const ITEMS = [
      ['key', 'Leaked secrets', 'API keys and passwords that shouldn\'t be visible to visitors.'],
      ['db', 'Database locks', 'Supabase tables or Firebase rules anyone could read or change.'],
      ['settings', 'Setup mistakes', 'Missing .gitignore, a committed .env file, wide-open CORS.'],
      ['globe', 'Unprotected endpoints', 'AI or paid features with no login check or rate limit.'],
    ];
    return html`<div class="grid-2 section">${ITEMS.map(([icon, title, body]) => html`<div class="card flat soft stack sm">
      <span class="row sm" style="font-weight:700">${VC.icon(icon, 16)} ${title}</span>
      <p class="small text-2 mb-0">${body}</p>
    </div>`)}</div>`;
  }

  function gradeCard(result) {
    const sevs = ['critical', 'high', 'medium', 'low'].filter((s) => result.counts && result.counts[s]);
    return html`<div class="card pad-lg spread" style="align-items:center;flex-wrap:wrap;gap:16px">
      <div class="row" style="flex-wrap:nowrap">
        <span class="grade ${result.grade}">${result.grade}</span>
        <div>
          <div style="font-size:1.5rem;font-weight:750;line-height:1.1">${result.score}<span class="small muted" style="font-weight:500">/100</span></div>
          <div class="small muted">${result.fileCount} files scanned${result.skippedCount ? ', ' + result.skippedCount + ' skipped' : ''}</div>
        </div>
      </div>
      <div class="row sm">
        ${sevs.length ? sevs.map((s) => html`<span class="row sm" style="gap:5px">${VC.ui.severityBadge(s)}<span class="small">× ${result.counts[s]}</span></span>`) : VC.ui.badge(html`${VC.icon('check', 11)} No issues found`, 'green')}
      </div>
    </div>`;
  }

  function diffCallout(d) {
    if (!d) return '';
    const bits = [];
    if (d.fixed.length) bits.push(`${d.fixed.length} fixed`);
    if (d.added.length) bits.push(`${d.added.length} new`);
    if (!bits.length && !d.filesChanged) return VC.ui.callout('success', 'Nothing changed since your last scan.');
    return VC.ui.callout(d.added.length ? 'warn' : 'success', `Since your last scan: ${bits.join(', ') || 'no finding changes'}. ${d.filesChanged} file${d.filesChanged === 1 ? '' : 's'} changed.`);
  }

  function stackCard(result) {
    const s = result.stack || {};
    if (!arr(s.frameworks).length && !arr(s.languages).length && !arr(s.services).length) return '';
    return html`<div class="card stack sm">
      <div class="spread"><h3 class="mb-0">What we found in your project</h3><a class="btn ghost sm" href="#/map">${VC.icon('map', 14)} View app map</a></div>
      <dl class="kv small mb-0">
        ${arr(s.frameworks).length ? html`<dt>Framework</dt><dd>${s.frameworks.join(', ')}</dd>` : ''}
        ${arr(s.languages).length ? html`<dt>Language</dt><dd>${s.languages.join(', ')}</dd>` : ''}
        ${arr(s.services).length ? html`<dt>Services</dt><dd>${s.services.map((id) => { const svc = VC.data.serviceById && VC.data.serviceById(id); return svc ? svc.name : id; }).join(', ')}</dd>` : ''}
      </dl>
    </div>`;
  }

  function findingItem(f) {
    return html`<li>
      <details class="acc">
        <summary>
          <span class="grow" style="min-width:0">
            <span class="row sm" style="justify-content:space-between;flex-wrap:nowrap;align-items:flex-start">
              <span class="bold">${f.title}</span>${VC.ui.severityBadge(f.severity)}
            </span>
            ${f.file ? html`<span class="small text-2 mono" style="display:block;margin-top:2px;word-break:break-all">${f.file}${f.line ? ':' + f.line : ''}</span>` : ''}
          </span>
        </summary>
        <div class="acc-body stack sm">
          <p class="small mb-0">${f.plain}</p>
          ${f.risk ? html`<p class="small text-2 mb-0"><strong>Why it matters:</strong> ${f.risk}</p>` : ''}
          ${f.snippet ? html`<pre class="mono small" style="background:var(--surface-2);padding:8px 10px;border-radius:8px;overflow-x:auto;margin:0">${f.snippet}</pre>` : ''}
          ${arr(f.fix).length ? html`<div><div style="${LABEL}">How to fix it</div><ol class="small mb-0">${f.fix.map((s) => html`<li>${s}</li>`)}</ol></div>` : ''}
          ${f.fixPrompt ? VC.ui.codeBlock(f.fixPrompt, { title: 'Paste this to your AI builder', copyLabel: 'Copy fix prompt' }) : ''}
        </div>
      </details>
    </li>`;
  }

  function findingsSection(result) {
    const findings = arr(result.findings).slice().sort((a, b) => (SEV_RANK[a.severity] ?? 5) - (SEV_RANK[b.severity] ?? 5));
    if (!findings.length) return VC.ui.callout('success', html`<strong>No issues found.</strong> Nice work — re-scan after big changes to stay ahead of new ones.`, 'success');
    const byCat = {};
    findings.forEach((f) => { (byCat[f.category] = byCat[f.category] || []).push(f); });
    return html`<div class="stack">
      ${CATS.map(([id, label, icon]) => {
        const list = byCat[id] || [];
        if (!list.length) return '';
        return html`<div class="stack sm">
          <div class="row sm" style="font-weight:700">${VC.icon(icon, 16)} ${label} <span class="tiny muted">(${list.length})</span></div>
          <ul class="stack sm" style="list-style:none;padding:0">${list.map(findingItem)}</ul>
        </div>`;
      })}
    </div>`;
  }

  function historyList(p) {
    const scans = arr(p && p.scans);
    if (scans.length < 2) return '';
    return html`<section class="section" aria-labelledby="scan-history-h">
      <div class="section-head"><h2 id="scan-history-h">Past scans</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Grade</th><th>Score</th><th></th></tr></thead>
        <tbody>${scans.map((s) => html`<tr>
          <td>${VC.formatDate(s.createdAt)}</td>
          <td><span class="badge ${gradeColor(s.grade)}">${s.grade}</span></td>
          <td>${s.score}/100</td>
          <td style="text-align:right"><button class="btn ghost sm" data-action="view-scan" data-id="${s.id}" ${viewingPastId === s.id ? 'disabled' : ''}>View</button></td>
        </tr>`)}</tbody>
      </table></div>
    </section>`;
  }

  /* ------------------------------------------------------------------ *
   * View
   * ------------------------------------------------------------------ */
  VC.registerView({
    id: 'scan',
    title: 'Safety Scan',
    navTitle: 'Check',
    icon: 'shield',
    nav: { group: 'journey', order: 5 },
    status(project) { return project && arr(project.scans).length ? 'done' : 'todo'; },

    render(el, ctx) {
      const p = ctx.project;
      const pid = p && p.id;
      if (pid !== lastProjectId) {
        lastProjectId = pid;
        currentResult = null;
        currentDiff = null;
        viewingPastId = null;
      }
      const eng = engine();

      async function handleInput(raw) {
        if (!eng) { VC.ui.toast('The safety scanner didn\'t load. Refresh and try again.', 'error'); return; }
        scanning = true;
        progress = { done: 0, total: 0 };
        ctx.rerender();
        try {
          const vfiles = await eng.readInput(raw);
          if (!vfiles.length) {
            VC.ui.toast('Couldn\'t find any files there.', 'error');
            return;
          }
          const result = await eng.scan(vfiles, (prog) => { progress = prog || progress; ctx.rerender(); });
          result.projectName = (VC.store.active() && (VC.store.active().name || VC.store.active().idea)) || result.projectName || '';

          let diff = null;
          const active = VC.store.active();
          const prevSummary = arr(active && active.scans)[0];
          if (prevSummary) {
            try {
              const prevFull = await VC.db.get('scan:' + prevSummary.id);
              if (prevFull) diff = eng.diff(prevFull, result);
            } catch (e) { /* ignore */ }
          }

          await VC.db.set('scan:' + result.id, result);
          await VC.db.set('scan:latest:' + (active && active.id), result);
          const summary = eng.summarize(result);
          VC.store.update((q) => { q.scans = [summary].concat(arr(q.scans)).slice(0, 10); });

          currentResult = result;
          currentDiff = diff;
          viewingPastId = null;
          VC.ui.toast('Scan complete: grade ' + result.grade, result.grade === 'A' || result.grade === 'B' ? 'success' : undefined);
        } catch (err) {
          console.error(err);
          VC.ui.toast('The scan failed: ' + ((err && err.message) || err), 'error');
        } finally {
          scanning = false;
          ctx.rerender();
        }
      }

      VC.mount(el, html`
        ${VC.ui.pageHead({ eyebrow: 'Step 5 · Safety Scan', title: 'Check for leaks and mistakes', lead: 'Drag in your project and get a plain-English report card, with a paste-ready fix for everything we find.' })}

        ${scanning ? html`<div class="card pad-lg loading" style="justify-content:flex-start"><span class="spinner"></span>
          <span>Scanning${progress.total ? ` — ${progress.done}/${progress.total} files` : '…'}</span></div>
          ${progress.total ? VC.ui.meter((progress.done / progress.total) * 100) : ''}
        ` : (currentResult ? html`
          ${viewingPastId ? VC.ui.callout('info', html`<span class="spread"><span>Viewing a past scan from ${VC.formatDate(currentResult.createdAt)}.</span><button class="btn sm" data-action="rescan">Scan again</button></span>`) : ''}
          ${!viewingPastId ? diffCallout(currentDiff) : ''}
          ${gradeCard(currentResult)}
          ${stackCard(currentResult)}
          <section class="section" aria-labelledby="scan-findings-h">
            <div class="section-head">
              <h2 id="scan-findings-h">What we found</h2>
              <div class="row sm">
                <button class="btn ghost sm" data-action="download-report">${VC.icon('download', 14)} Download report</button>
                ${!viewingPastId ? html`<button class="btn ghost sm" data-action="rescan">${VC.icon('refresh', 14)} Scan again</button>` : ''}
              </div>
            </div>
            ${findingsSection(currentResult)}
          </section>
        ` : html`${dropzone()}${whatWeCheck()}`)}

        ${!scanning ? historyList(p) : ''}
      `);

      /* ---------- Events ---------- */
      VC.delegate(el, 'dragover', '#scan-drop', (e, z) => { e.preventDefault(); z.classList.add('over'); });
      VC.delegate(el, 'dragleave', '#scan-drop', (e, z) => { z.classList.remove('over'); });
      VC.delegate(el, 'drop', '#scan-drop', (e, z) => {
        e.preventDefault();
        z.classList.remove('over');
        if (!scanning && e.dataTransfer) handleInput(e.dataTransfer);
      });
      VC.delegate(el, 'change', '#scan-folder-input', (e, input) => { if (input.files && input.files.length) handleInput(input.files); });
      VC.delegate(el, 'change', '#scan-zip-input', (e, input) => { if (input.files && input.files.length) handleInput(input.files); });

      VC.delegate(el, 'click', '[data-action]', async (e, b) => {
        const act = b.getAttribute('data-action');
        if (act === 'rescan') {
          currentResult = null;
          currentDiff = null;
          viewingPastId = null;
          ctx.rerender();
        } else if (act === 'download-report' && currentResult && eng) {
          VC.download('vibe-check-scan-report.md', eng.report(currentResult), 'text/markdown');
        } else if (act === 'view-scan') {
          const id = b.getAttribute('data-id');
          try {
            const full = await VC.db.get('scan:' + id);
            if (!full) { VC.ui.toast('That scan\'s details aren\'t saved on this device anymore.', 'error'); return; }
            currentResult = full;
            currentDiff = null;
            viewingPastId = id;
            ctx.rerender();
          } catch (err) {
            VC.ui.toast('Couldn\'t load that scan.', 'error');
          }
        }
      });
    },
  });
})();
