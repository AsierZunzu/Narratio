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
})();
