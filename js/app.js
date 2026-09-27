/* Vibe Check — boot. Loaded last, after every data/engine/view file. */
(function () {
  'use strict';
  const VC = window.VC;

  function start() {
    try {
      VC.start();
    } catch (err) {
      console.error(err);
      const v = document.getElementById('view');
      if (v) v.textContent = 'Vibe Check failed to start: ' + (err && err.message ? err.message : err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
