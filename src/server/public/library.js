/* Library page — paginated server-side filtering with infinite scroll. */
(function () {
  'use strict';

  const N = window.Narratio;
  const BASE_URL = window.NARRATIO.baseUrl;
  const STATUS_LABELS = { pending: 'Pending', converting: 'Converting', done: 'Ready', failed: 'Failed', purged: 'Purged' };
  const FEED_MAP = window.__FEED_MAP__ || {};
  const CONFIG = window.__LIBRARY_CONFIG__ || { pageSize: 50, initialCounts: { all: 0 }, initialLoaded: 0, initialHasMore: false };

  const list = document.getElementById('dispatches');
  const search = document.getElementById('search');
  const sentinel = document.getElementById('dispatches-sentinel');
  const loadingEl = document.getElementById('dispatches-loading');
  const endEl = document.getElementById('dispatches-end');

  const PAGE_SIZE = CONFIG.pageSize;
  let activeFilter = 'all';
  let searchTerm = '';
  let loadedCount = CONFIG.initialLoaded;
  let hasMore = CONFIG.initialHasMore;
  let loading = false;
  let requestSeq = 0;

  function buildQuery(extra) {
    const params = new URLSearchParams();
    if (activeFilter !== 'all') params.set('status', activeFilter);
    if (searchTerm) params.set('search', searchTerm);
    Object.entries(extra || {}).forEach(([k, v]) => params.set(k, String(v)));
    return params.toString();
  }

  function setCounts(counts) {
    document.querySelectorAll('[data-count-of]').forEach((el) => {
      const k = el.dataset.countOf;
      if (counts && k in counts) el.textContent = counts[k];
    });
    const navCount = document.querySelector('.nav-link.active .nav-count');
    if (navCount && counts && 'all' in counts) navCount.textContent = counts.all;
  }

  setCounts(CONFIG.initialCounts);
  if (endEl) endEl.hidden = hasMore || loadedCount === 0;

  function buildRow(a) {
    const feed = a.feed_id ? FEED_MAP[a.feed_id] : null;
    const label = STATUS_LABELS[a.status] || a.status;
    const content = a.content || '';
    const titleHtml = content
      ? `<button class="btn-view-content" type="button" data-guid="${N.escAttr(a.guid)}">${N.escHtml(a.title)}</button>`
      : N.escHtml(a.title);

    let errorHtml = '';
    if (a.status === 'failed' && a.error) {
      const msg = a.error.length > 200 ? a.error.slice(0, 200) + '…' : a.error;
      errorHtml = `<div class="dispatch-error" title="${N.escAttr(a.error)}">${N.escHtml(msg)}</div>`;
    }

    let actions = '';
    if (a.status === 'done' && a.audio_file) {
      actions += `<a class="btn btn-success btn-sm" href="${BASE_URL}/audio/${encodeURIComponent(a.audio_file)}"><svg viewBox="0 0 24 24"><path d="M5 4v16l14-8z"/></svg><span>Play</span></a>`;
    }
    if (a.link) {
      actions += `<a class="btn btn-sm" href="${N.escAttr(a.link)}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 14 20 4M19 13v6H5V5h6"/></svg><span>Source</span></a>`;
    }
    if (a.status === 'failed') actions += `<button class="btn btn-info btn-sm" data-action="retry" data-guid="${N.escAttr(a.guid)}" type="button">Retry</button>`;
    if (a.status === 'done' || a.status === 'purged') actions += `<button class="btn btn-success btn-sm" data-action="regenerate" data-guid="${N.escAttr(a.guid)}" type="button">Regenerate</button>`;
    if (a.status === 'done') actions += `<button class="btn btn-warn btn-sm" data-action="purge" data-guid="${N.escAttr(a.guid)}" type="button">Purge</button>`;
    actions += `<button class="btn btn-danger btn-sm" data-action="delete" data-guid="${N.escAttr(a.guid)}" type="button"><svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button>`;

    const feedHtml = feed
      ? `<span class="dispatch-meta-sep">·</span><a class="dispatch-feed" href="${BASE_URL}/rss/${N.escAttr(feed.slug)}" target="_blank" rel="noopener">${N.escHtml(feed.name)}</a>`
      : '';

    const wc = N.wordCount(a.content);
    const elapsed = N.formatElapsed(a.tts_elapsed_ms);

    let statsExtra = '';
    if (a.status === 'failed') statsExtra = `<span><span class="num">${a.tts_retries}×</span> retries</span>`;

    return `<article class="dispatch" data-guid="${N.escAttr(a.guid)}" data-status="${N.escAttr(a.status)}" data-feed-id="${N.escAttr(a.feed_id ?? '')}" data-content="${N.escAttr(content)}">
      <div class="dispatch-body">
        <div class="dispatch-meta">
          <span class="badge badge-${N.escAttr(a.status)}">${N.escHtml(label)}</span>
          ${feedHtml}
          <span class="dispatch-meta-sep">·</span>
          <span>${N.escHtml(N.formatDate(a.pub_date))}</span>
        </div>
        <h2 class="dispatch-title">${titleHtml}</h2>
        <div class="dispatch-stats">
          <span><span class="num">${wc}</span> words</span>
          <span><span class="num">${elapsed}</span> render</span>
          ${statsExtra}
        </div>
        ${errorHtml}
      </div>
      <div class="dispatch-actions">${actions}</div>
    </article>`;
  }

  function renderRows(articles, mode) {
    if (mode === 'replace') {
      list.querySelectorAll('.dispatch[data-guid]').forEach((r) => r.remove());
      list.querySelector('.empty-state')?.remove();
    }
    const frag = document.createDocumentFragment();
    for (const a of articles) {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildRow(a);
      if (tmp.firstElementChild) frag.appendChild(tmp.firstElementChild);
    }
    list.appendChild(frag);
  }

  function showEmptyState() {
    list.querySelectorAll('.dispatch[data-guid]').forEach((r) => r.remove());
    if (!list.querySelector('.empty-state')) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = 'No matching dispatches.<div class="empty-state-detail">Try a different filter or search term.</div>';
      list.appendChild(empty);
    }
  }

  function cssEscape(s) {
    return (window.CSS && window.CSS.escape) ? window.CSS.escape(s) : String(s).replace(/"/g, '\\"');
  }

  async function fetchPage(offset, mode) {
    if (loading) return;
    loading = true;
    const seq = ++requestSeq;
    if (loadingEl) loadingEl.hidden = false;
    if (endEl) endEl.hidden = true;
    try {
      const res = await fetch('/api/articles?' + buildQuery({ limit: PAGE_SIZE, offset }));
      if (!res.ok) return;
      const payload = await res.json();
      if (seq !== requestSeq) return;
      const articles = payload.articles || [];
      if (mode === 'replace') loadedCount = 0;
      renderRows(articles, mode);
      loadedCount += articles.length;
      hasMore = !!payload.hasMore;
      setCounts(payload.counts);
      if (loadedCount === 0) showEmptyState();
      else list.querySelector('.empty-state')?.remove();
      if (endEl) endEl.hidden = hasMore || loadedCount === 0;
    } catch { /* network error — silent */ }
    finally {
      if (seq === requestSeq && loadingEl) loadingEl.hidden = true;
      loading = false;
    }
  }

  function reset() { fetchPage(0, 'replace'); }

  // Status pills
  document.querySelectorAll('.telemetry-cell.is-filter').forEach((cell) => {
    cell.addEventListener('click', () => {
      document.querySelectorAll('.telemetry-cell.is-filter').forEach((c) => {
        c.classList.remove('active'); c.setAttribute('aria-pressed', 'false');
      });
      cell.classList.add('active');
      cell.setAttribute('aria-pressed', 'true');
      activeFilter = cell.dataset.filter;
      reset();
    });
  });

  // Search — debounced
  if (search) {
    let t;
    search.addEventListener('input', (e) => {
      const v = e.target.value.trim().toLowerCase();
      clearTimeout(t);
      t = setTimeout(() => {
        searchTerm = v;
        reset();
      }, 250);
    });
  }

  // Infinite scroll
  if (sentinel && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && hasMore && !loading) {
          fetchPage(loadedCount, 'append');
        }
      }
    }, { rootMargin: '400px 0px' });
    io.observe(sentinel);
  }

  // Content reader
  function openContent(title, content) {
    document.getElementById('content-title').textContent = title;
    document.getElementById('content-text').textContent = content;
    N.openModal('content-modal');
  }

  list.addEventListener('click', (e) => {
    const viewBtn = e.target.closest('.btn-view-content');
    if (viewBtn) {
      const row = viewBtn.closest('.dispatch[data-guid]');
      if (row) openContent(viewBtn.textContent.trim(), row.dataset.content || '');
    }
  });

  // Action buttons
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, guid } = btn.dataset;
    if (action === 'delete' && !confirm('Delete this article permanently?')) return;
    if (action === 'regenerate' && !confirm('Regenerate audio? The current file will be deleted and TTS will run again on the next worker poll.')) return;

    const row = btn.closest('.dispatch[data-guid]');
    btn.disabled = true;
    try {
      const url = '/api/articles/' + encodeURIComponent(guid) + (action === 'delete' ? '' : '/' + action);
      const res = await fetch(url, { method: action === 'delete' ? 'DELETE' : 'POST' });
      if (!res.ok) {
        N.showToast('Error: ' + await res.text(), true);
        btn.disabled = false;
        return;
      }
      const msg = action === 'regenerate' ? 'Regenerate queued' : action.charAt(0).toUpperCase() + action.slice(1) + ' successful';
      N.showToast(msg, false);
      applyAction(action, row);
      refreshCounts();
    } catch {
      N.showToast('Network error', true);
      btn.disabled = false;
    }
  });

  function applyAction(action, row) {
    if (!row) return;
    if (action === 'delete') {
      row.remove();
      loadedCount = Math.max(0, loadedCount - 1);
      if (loadedCount === 0) showEmptyState();
      return;
    }
    const newStatus = action === 'retry' || action === 'regenerate' ? 'pending' : 'purged';
    row.dataset.status = newStatus;
    const meta = row.querySelector('.dispatch-meta .badge');
    if (meta) {
      meta.className = 'badge badge-' + newStatus;
      meta.textContent = STATUS_LABELS[newStatus];
    }
    if (action === 'retry') {
      row.querySelector('[data-action="retry"]')?.remove();
      row.querySelector('.dispatch-error')?.remove();
    } else if (action === 'regenerate') {
      row.querySelector('[data-action="regenerate"]')?.remove();
      row.querySelector('[data-action="purge"]')?.remove();
      row.querySelector('.btn-success[href]')?.remove();
    } else if (action === 'purge') {
      row.querySelector('[data-action="purge"]')?.remove();
      row.querySelector('.btn-success[href]')?.remove();
    }
    if (activeFilter !== 'all' && row.dataset.status !== activeFilter) {
      row.remove();
      loadedCount = Math.max(0, loadedCount - 1);
      if (loadedCount === 0) showEmptyState();
    }
  }

  async function refreshCounts() {
    try {
      const params = searchTerm ? '?search=' + encodeURIComponent(searchTerm) : '';
      const res = await fetch('/api/articles/counts' + params);
      if (!res.ok) return;
      setCounts(await res.json());
    } catch { /* ignore */ }
  }

  // Live reconciliation — re-fetch the currently loaded window with active filters.
  async function reconcile() {
    if (loading) return;
    if (loadedCount === 0) { refreshCounts(); return; }
    const seq = ++requestSeq;
    try {
      const res = await fetch('/api/articles?' + buildQuery({ limit: Math.min(loadedCount, 200), offset: 0 }));
      if (!res.ok) return;
      const payload = await res.json();
      if (seq !== requestSeq) return;
      const articles = payload.articles || [];
      const domRows = new Map();
      list.querySelectorAll('.dispatch[data-guid]').forEach((r) => domRows.set(r.dataset.guid, r));

      const savedY = window.scrollY;
      for (const a of articles) {
        const existing = domRows.get(a.guid);
        if (existing) {
          domRows.delete(a.guid);
          if (existing.querySelector('[data-action]:disabled')) continue;
          if (existing.dataset.status === a.status && existing.dataset.content === (a.content || '')) continue;
          const tmp = document.createElement('div');
          tmp.innerHTML = buildRow(a);
          existing.replaceWith(tmp.firstElementChild);
        }
      }
      for (const [, tr] of domRows) {
        if (!tr.querySelector('[data-action]:disabled')) tr.remove();
      }
      // Prepend new rows that weren't present
      for (let i = articles.length - 1; i >= 0; i--) {
        const a = articles[i];
        if (!list.querySelector('.dispatch[data-guid="' + cssEscape(a.guid) + '"]')) {
          const tmp = document.createElement('div');
          tmp.innerHTML = buildRow(a);
          list.insertBefore(tmp.firstElementChild, list.firstChild);
        }
      }
      loadedCount = list.querySelectorAll('.dispatch[data-guid]').length;
      const total = (payload.counts && typeof payload.counts.all === 'number') ? payload.counts.all : loadedCount;
      hasMore = !!payload.hasMore || loadedCount < total;
      setCounts(payload.counts);
      if (loadedCount === 0) showEmptyState();
      else list.querySelector('.empty-state')?.remove();
      if (endEl) endEl.hidden = hasMore || loadedCount === 0;
      window.scrollTo(0, savedY);
    } catch { /* ignore */ }
  }

  document.getElementById('refresh-btn')?.addEventListener('click', reconcile);
  setInterval(reconcile, 5000);
})();
