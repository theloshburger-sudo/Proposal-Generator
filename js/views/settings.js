/* Vibe Check — Settings: optional AI key, model, theme, data export/import/reset. */
(function () {
  'use strict';
  const VC = window.VC;
  const html = VC.html;

  VC.registerView({
    id: 'settings',
    title: 'Settings',
    icon: 'settings',
    nav: { group: 'tools', order: 9 },
    render(el, ctx) {
      el.classList.add('narrow');
      const s = VC.store.settings();
      const hasKey = VC.ai.enabled();
      const remembered = !!VC.storage.get('vibecheck.aiKey', null);

      VC.mount(el, html`
        ${VC.ui.pageHead({ eyebrow: 'Settings', title: 'Settings', lead: 'Everything here stays in this browser. Nothing is sent anywhere unless you turn on AI.' })}

        <section class="card pad-lg stack">
          <div class="spread">
            <h2 class="mb-0">${VC.icon('sparkles')} AI boost <span class="muted small">(optional)</span></h2>
            ${hasKey ? VC.ui.badge('On', 'green') : VC.ui.badge('Off', 'gray')}
          </div>
          <p class="text-2 mb-0">Vibe Check works without AI. With your own Claude ${VC.ui.term('API key')}, it can invent custom directions for any idea, write prompts tailored to your project, and explain scan results in more depth.</p>
          ${VC.ui.callout('info', html`Your key goes straight from this browser to Anthropic. Secrets in your code are removed before anything is sent. You pay Anthropic directly for what you use (typically a few cents per request).`)}
          <div class="field">
            <label for="ai-key">Claude API key</label>
            <input id="ai-key" type="password" class="mono" autocomplete="off" spellcheck="false" placeholder="${hasKey ? '•••••••• saved — paste a new one to replace' : 'sk-ant-…'}">
            <span class="hint">Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com → API Keys</a>. You'll need to add a little credit to your account.</span>
          </div>
          <label class="check"><input type="checkbox" id="ai-remember" ${remembered || s.rememberKey ? 'checked' : ''}><span>Remember on this device <span class="muted small">— leave off on shared computers (the key is forgotten when you close the tab)</span></span></label>
          <div class="field">
            <label for="ai-model">Model</label>
            <select id="ai-model">
              ${VC.ai.models.map((m) => html`<option value="${m.id}" ${s.aiModel === m.id ? 'selected' : ''}>${m.label} — ${m.note}</option>`)}
            </select>
          </div>
          <div class="row">
            <button class="btn primary" data-action="save-key">${VC.icon('check', 16)} Save key</button>
            <button class="btn" data-action="test-key" ${hasKey ? '' : 'disabled'}>Test connection</button>
            ${hasKey ? html`<button class="btn danger" data-action="clear-key">${VC.icon('trash', 16)} Remove key</button>` : ''}
            <span id="ai-status" class="small muted"></span>
          </div>
        </section>

        <section class="card pad-lg stack section">
          <h2 class="mb-0">Appearance</h2>
          <div class="option-group" role="radiogroup" aria-label="Theme">
            ${['system', 'light', 'dark'].map((t) => html`<button class="chip ${s.theme === t ? 'on' : ''}" data-action="theme" data-theme="${t}" role="radio" aria-checked="${String(s.theme === t)}">${t === 'system' ? 'Match my device' : VC.titleCase(t)}</button>`)}
          </div>
        </section>

        <section class="card pad-lg stack section">
          <h2 class="mb-0">Your data</h2>
          <p class="text-2 mb-0">Projects are saved in this browser only. Export a backup to move them to another computer.</p>
          <div class="row">
            <button class="btn" data-action="export">${VC.icon('download', 16)} Export backup</button>
            <label class="btn">${VC.icon('upload', 16)} Import backup<input type="file" id="import-file" accept=".json,application/json" hidden></label>
            <button class="btn danger" data-action="reset">${VC.icon('trash', 16)} Delete everything</button>
          </div>
        </section>
      `);

      const status = el.querySelector('#ai-status');

      VC.delegate(el, 'click', '[data-action]', async (e, b) => {
        const act = b.getAttribute('data-action');
        if (act === 'save-key') {
          const key = el.querySelector('#ai-key').value.trim();
          const remember = el.querySelector('#ai-remember').checked;
          VC.store.setSetting('aiModel', el.querySelector('#ai-model').value);
          VC.store.setSetting('rememberKey', remember);
          if (key) {
            if (!VC.ai.looksLikeKey(key)) {
              VC.ui.toast('That doesn\'t look like a Claude key — it should start with "sk-ant-".', 'error');
              return;
            }
            VC.ai.setKey(key, remember);
          } else if (VC.ai.enabled()) {
            VC.ai.setKey(VC.ai.getKey(), remember);
          }
          VC.ui.toast('Saved', 'success');
          ctx.rerender();
        } else if (act === 'test-key') {
          b.disabled = true;
          VC.mount(status, html`<span class="row sm"><span class="spinner"></span>Testing…</span>`);
          try {
            await VC.ai.test();
            VC.mount(status, html`<span class="badge green">${VC.icon('check', 12)} Connected</span>`);
          } catch (err) {
            VC.mount(status, html`<span class="badge red">${err.message}</span>`);
          } finally {
            b.disabled = false;
          }
        } else if (act === 'clear-key') {
          VC.ai.clearKey();
          VC.ui.toast('Key removed');
          ctx.rerender();
        } else if (act === 'theme') {
          VC.store.setSetting('theme', b.getAttribute('data-theme'));
          VC.applyTheme();
          ctx.rerender();
        } else if (act === 'export') {
          VC.download('vibe-check-backup.json', VC.store.exportAll(), 'application/json');
        } else if (act === 'reset') {
          const ok = await VC.ui.confirm('Delete everything?', 'This removes all your projects and scans from this browser. It can\'t be undone.', 'Delete everything');
          if (ok) {
            VC.store.resetAll();
            VC.ai.clearKey();
            try { await VC.db.del('scan:latest'); } catch (err) { /* ignore */ }
            VC.ui.toast('All data deleted');
            VC.go('home');
          }
        }
      });

      el.querySelector('#ai-model').addEventListener('change', (e) => VC.store.setSetting('aiModel', e.target.value));

      el.querySelector('#import-file').addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
          const n = VC.store.importAll(await f.text());
          VC.ui.toast(`Imported ${n} project${n === 1 ? '' : 's'}`, 'success');
          ctx.rerender();
        } catch (err) {
          VC.ui.toast(err.message || 'Could not import that file', 'error');
        }
      });
    },
  });
})();
