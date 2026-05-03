/* Narratio shared client utilities */
(function () {
  'use strict';

  const toast = document.getElementById('toast');
  let toastTimer = null;

  window.Narratio = window.Narratio || {};

  window.Narratio.showToast = function (msg, isError) {
    if (!toast) return;
    toast.textContent = msg;
    toast.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.className = ''; }, 3000);
  };

  window.Narratio.escAttr = function (s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
      .replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  window.Narratio.escHtml = function (s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };

  window.Narratio.formatDate = function (d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return String(d); }
  };
  window.Narratio.formatElapsed = function (ms) {
    if (ms == null) return '—';
    return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
  };
  window.Narratio.wordCount = function (content) {
    if (!content) return '—';
    const t = content.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').trim();
    if (!t) return '—';
    return t.split(/\s+/).filter(Boolean).length;
  };

  // Modal helpers — opens/closes by id, traps escape
  const openModals = new Set();

  window.Narratio.openModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    openModals.add(id);
    document.body.style.overflow = 'hidden';
    // Focus first focusable
    const focusable = el.querySelector('input, select, textarea, button:not([data-modal-close])');
    if (focusable) setTimeout(() => focusable.focus(), 50);
  };
  window.Narratio.closeModal = function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('open');
    openModals.delete(id);
    if (openModals.size === 0) document.body.style.overflow = '';
  };
  window.Narratio.closeAllModals = function () {
    [...openModals].forEach((id) => window.Narratio.closeModal(id));
  };

  // Wire up [data-modal-close] anywhere
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-modal-close]');
    if (closer) {
      const modal = closer.closest('.modal');
      if (modal && modal.id) window.Narratio.closeModal(modal.id);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openModals.size > 0) window.Narratio.closeAllModals();
  });

  // Worker status pill — polls /api/worker/status, ticks countdown locally.
  const workerEl = document.getElementById('worker-status');
  const workerDetailEl = document.getElementById('worker-status-detail');
  const workerRunBtn = document.getElementById('worker-run-btn');
  if (workerEl && workerDetailEl) {
    let workerState = { status: 'idle', nextRunAt: null, pollInterval: null, since: null, triggerRequestedAt: null };

    function relativeFromNow(iso) {
      const target = new Date(iso).getTime();
      if (!Number.isFinite(target)) return '';
      let diff = Math.max(0, Math.round((target - Date.now()) / 1000));
      const h = Math.floor(diff / 3600); diff -= h * 3600;
      const m = Math.floor(diff / 60); const s = diff - m * 60;
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
      if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    }

    function renderWorker() {
      const running = workerState.status === 'running';
      const queued = !running && !!workerState.triggerRequestedAt;
      if (running) {
        workerEl.classList.add('worker-status-running');
        workerEl.classList.remove('worker-status-idle');
        workerDetailEl.textContent = 'running…';
      } else {
        workerEl.classList.add('worker-status-idle');
        workerEl.classList.remove('worker-status-running');
        if (queued) workerDetailEl.textContent = 'queued…';
        else if (workerState.nextRunAt) workerDetailEl.textContent = 'next in ' + relativeFromNow(workerState.nextRunAt);
        else workerDetailEl.textContent = 'one-shot';
      }
      if (workerRunBtn) {
        const disabled = running || queued;
        workerRunBtn.disabled = disabled;
        workerRunBtn.textContent = queued ? 'Queued' : (running ? 'Running' : 'Run now');
      }
    }

    async function fetchWorker() {
      try {
        const res = await fetch('/api/worker/status');
        if (!res.ok) return;
        workerState = await res.json();
      } catch { /* silent */ }
      renderWorker();
    }

    if (workerRunBtn) {
      workerRunBtn.addEventListener('click', async () => {
        if (workerRunBtn.disabled) return;
        workerRunBtn.disabled = true;
        try {
          const res = await fetch('/api/worker/run', { method: 'POST' });
          let body = null;
          try { body = await res.json(); } catch { /* ignore */ }
          if (res.status === 202) {
            window.Narratio.showToast('Worker run queued');
          } else if (res.status === 200) {
            window.Narratio.showToast(body && body.message ? body.message : 'A run is already queued');
          } else if (res.status === 409) {
            window.Narratio.showToast(body && body.message ? body.message : 'Worker is already running', true);
          } else {
            window.Narratio.showToast('Failed to queue worker run', true);
          }
        } catch {
          window.Narratio.showToast('Failed to queue worker run', true);
        }
        fetchWorker();
      });
    }

    fetchWorker();
    setInterval(fetchWorker, 5000);
    setInterval(renderWorker, 1000);
  }
})();
