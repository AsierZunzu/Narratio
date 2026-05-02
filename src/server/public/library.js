/* Library page — articles list with live updates, filtering, search */
(function () {
  'use strict';

  const N = window.Narratio;
  const BASE_URL = window.NARRATIO.baseUrl;
  const STATUS_LABELS = { pending: 'Pending', converting: 'Converting', done: 'Ready', failed: 'Failed', purged: 'Purged' };

  const FEED_MAP = window.__FEED_MAP__ || {};

  const list = document.getElementById('dispatches');
  const search = document.getElementById('search');

  let activeFilter = 'all';
  let searchTerm = '';

  function applyFilters() {
    const rows = list.querySelectorAll('.dispatch[data-guid]');
    rows.forEach((r) => {
      const matchStatus = activeFilter === 'all' || r.dataset.status === activeFilter;
      const matchSearch = !searchTerm || (r.dataset.search || '').includes(searchTerm);
      r.style.display = matchStatus && matchSearch ? '' : 'none';
    });
  }

  function recalcCounts() {
    const rows = [...list.querySelectorAll('.dispatch[data-guid]')];
    const counts = { all: rows.length, pending: 0, converting: 0, done: 0, failed: 0, purged: 0 };
    rows.forEach((r) => { if (r.dataset.status in counts) counts[r.dataset.status]++; });
    document.querySelectorAll('[data-count-of]').forEach((el) => {
      const k = el.dataset.countOf;
      if (k in counts) el.textContent = counts[k];
    });
    // sidebar count
    const navCount = document.querySelector('.nav-link.active .nav-count');
    if (navCount) navCount.textContent = counts.all;
  }

  // Filter cells
  document.querySelectorAll('.telemetry-cell.is-filter').forEach((cell) => {
    cell.addEventListener('click', () => {
      document.querySelectorAll('.telemetry-cell.is-filter').forEach((c) => {
        c.classList.remove('active'); c.setAttribute('aria-pressed', 'false');
      });
      cell.classList.add('active');
      cell.setAttribute('aria-pressed', 'true');
      activeFilter = cell.dataset.filter;
      applyFilters();
    });
  });

  if (search) {
    search.addEventListener('input', (e) => {
      searchTerm = e.target.value.trim().toLowerCase();
      applyFilters();
    });
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
      return;
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
      recalcCounts();
      applyFilters();
    } catch {
      N.showToast('Network error', true);
      btn.disabled = false;
    }
  });

  function applyAction(action, row) {
    if (!row) return;
    if (action === 'delete') { row.remove(); return; }
    const newStatus = action === 'retry' || action === 'regenerate' ? 'pending' : 'purged';
    row.dataset.status = newStatus;
    const meta = row.querySelector('.dispatch-meta .badge');
    if (meta) {
      meta.className = 'badge badge-' + newStatus;
      meta.textContent = STATUS_LABELS[newStatus];
    }
    // Remove buttons that no longer apply
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
  }

  // Live reconciliation — fetch every 5s
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

    const search = (a.title + ' ' + (feed ? feed.name : '') + ' ' + content).toLowerCase();

    const wc = N.wordCount(a.content);
    const elapsed = N.formatElapsed(a.tts_elapsed_ms);

    let statsExtra = '';
    if (a.status === 'failed') statsExtra = `<span><span class="num">${a.tts_retries}×</span> retries</span>`;

    return `<article class="dispatch" data-guid="${N.escAttr(a.guid)}" data-status="${N.escAttr(a.status)}" data-feed-id="${N.escAttr(a.feed_id ?? '')}" data-content="${N.escAttr(content)}" data-search="${N.escAttr(search)}">
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

  async function reconcile() {
    let articles;
    try {
      const res = await fetch('/api/articles');
      if (!res.ok) return;
      articles = await res.json();
    } catch { return; }

    const apiMap = new Map(articles.map((a) => [a.guid, a]));
    const domRows = new Map();
    list.querySelectorAll('.dispatch[data-guid]').forEach((r) => domRows.set(r.dataset.guid, r));

    // Remove empty state if articles arrived
    if (articles.length > 0) list.querySelector('.empty-state')?.remove();

    let changed = false;
    const savedY = window.scrollY;

    for (const a of articles) {
      const existing = domRows.get(a.guid);
      if (existing) {
        domRows.delete(a.guid);
        if (existing.querySelector('[data-action]:disabled')) continue;
        if (existing.dataset.status === a.status) continue;
        // Replace in place
        const tmp = document.createElement('div');
        tmp.innerHTML = buildRow(a);
        existing.replaceWith(tmp.firstElementChild);
        changed = true;
      } else {
        const tmp = document.createElement('div');
        tmp.innerHTML = buildRow(a);
        const newEl = tmp.firstElementChild;
        // Insert in date order — newest first
        const allRows = [...list.querySelectorAll('.dispatch[data-guid]')];
        const newDate = a.pub_date || a.created_at || '';
        const insertBefore = allRows.find((row) => {
          const rowArt = apiMap.get(row.dataset.guid);
          const rowDate = rowArt ? (rowArt.pub_date || rowArt.created_at || '') : '';
          return newDate > rowDate;
        }) ?? null;
        list.insertBefore(newEl, insertBefore);
        changed = true;
      }
    }
    for (const [, tr] of domRows) {
      if (!tr.querySelector('[data-action]:disabled')) { tr.remove(); changed = true; }
    }
    if (list.querySelectorAll('.dispatch[data-guid]').length === 0 && !list.querySelector('.empty-state')) {
      list.innerHTML = '<div class="empty-state">The press is silent.<div class="empty-state-detail">No articles yet.</div></div>';
    }
    if (changed) { recalcCounts(); applyFilters(); }
    window.scrollTo(0, savedY);
  }

  document.getElementById('refresh-btn')?.addEventListener('click', reconcile);
  setInterval(reconcile, 5000);
})();
