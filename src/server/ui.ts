import type { Article } from '../db/index.js';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  done: 'Done',
  failed: 'Failed',
  purged: 'Purged',
};

function escape(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

function statusBadge(status: string): string {
  return `<span class="badge badge-${escape(status)}">${escape(STATUS_LABELS[status] ?? status)}</span>`;
}

function actionButtons(article: Article, baseUrl: string): string {
  const guid = escape(article.guid);
  const buttons: string[] = [];

  if (article.status === 'failed') {
    buttons.push(`<button class="btn btn-retry" data-action="retry" data-guid="${guid}">Retry</button>`);
  }
  if (article.status === 'done') {
    buttons.push(`<button class="btn btn-purge" data-action="purge" data-guid="${guid}">Purge</button>`);
  }
  if (article.status === 'done' && article.audio_file) {
    buttons.push(`<a class="btn btn-audio" href="${escape(baseUrl)}/audio/${encodeURIComponent(article.audio_file)}">▶ Audio</a>`);
  }
  buttons.push(`<button class="btn btn-delete" data-action="delete" data-guid="${guid}">Delete</button>`);

  return buttons.join(' ');
}

function buildRows(articles: Article[], baseUrl: string, filterStatus: string): string {
  const filtered = filterStatus === 'all' ? articles : articles.filter((a) => a.status === filterStatus);

  if (filtered.length === 0) {
    return `<tr><td colspan="6" class="empty">No articles found.</td></tr>`;
  }

  return filtered
    .map(
      (a) => `
    <tr data-guid="${escape(a.guid)}" data-status="${escape(a.status)}">
      <td class="col-title">
        ${a.link ? `<a href="${escape(a.link)}" target="_blank" rel="noopener">${escape(a.title)}</a>` : escape(a.title)}
      </td>
      <td class="col-status">${statusBadge(a.status)}</td>
      <td class="col-date">${escape(formatDate(a.pub_date))}</td>
      <td class="col-retries">${a.status === 'failed' ? `${a.tts_retries} retries` : '—'}</td>
      <td class="col-error">${a.status === 'failed' && a.error ? `<span class="error-msg" title="${escape(a.error)}">${escape(a.error.slice(0, 60))}${a.error.length > 60 ? '…' : ''}</span>` : ''}</td>
      <td class="col-actions">${actionButtons(a, baseUrl)}</td>
    </tr>`,
    )
    .join('');
}

export function renderDashboard(articles: Article[], baseUrl: string): string {
  const counts = {
    all: articles.length,
    pending: articles.filter((a) => a.status === 'pending').length,
    done: articles.filter((a) => a.status === 'done').length,
    failed: articles.filter((a) => a.status === 'failed').length,
    purged: articles.filter((a) => a.status === 'purged').length,
  };

  const tabsHtml = (['all', 'pending', 'done', 'failed', 'purged'] as const)
    .map(
      (s) =>
        `<button class="tab" data-filter="${s}">${s === 'all' ? 'All' : STATUS_LABELS[s]} <span class="tab-count">${counts[s]}</span></button>`,
    )
    .join('');

  // All rows rendered once; JS filters by data-status attribute
  const rowsHtml = articles.length === 0
    ? `<tr><td colspan="6" class="empty">No articles yet. The worker will populate this table after the first RSS poll.</td></tr>`
    : articles
        .map(
          (a) => `
    <tr data-guid="${escape(a.guid)}" data-status="${escape(a.status)}">
      <td class="col-title">
        ${a.link ? `<a href="${escape(a.link)}" target="_blank" rel="noopener">${escape(a.title)}</a>` : escape(a.title)}
      </td>
      <td class="col-status">${statusBadge(a.status)}</td>
      <td class="col-date">${escape(formatDate(a.pub_date))}</td>
      <td class="col-retries">${a.status === 'failed' ? `${a.tts_retries}×` : '—'}</td>
      <td class="col-error">${a.status === 'failed' && a.error ? `<span class="error-msg" title="${escape(a.error)}">${escape(a.error.slice(0, 60))}${a.error.length > 60 ? '…' : ''}</span>` : ''}</td>
      <td class="col-actions">${actionButtons(a, baseUrl)}</td>
    </tr>`,
        )
        .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Narratio Dashboard</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; font-size: 14px; }
    a { color: #60a5fa; text-decoration: none; }
    a:hover { text-decoration: underline; }

    header { padding: 20px 24px 12px; border-bottom: 1px solid #1e2535; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 18px; font-weight: 600; letter-spacing: 0.02em; }
    header .rss-link { font-size: 12px; color: #94a3b8; }

    .summary { display: flex; gap: 12px; padding: 16px 24px; flex-wrap: wrap; }
    .stat { background: #1a1f2e; border: 1px solid #252d3f; border-radius: 8px; padding: 10px 16px; min-width: 90px; text-align: center; }
    .stat-value { font-size: 22px; font-weight: 700; }
    .stat-label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

    .tabs { display: flex; gap: 4px; padding: 0 24px 12px; flex-wrap: wrap; }
    .tab { background: none; border: 1px solid #252d3f; border-radius: 6px; color: #94a3b8; cursor: pointer; font-size: 13px; padding: 5px 12px; }
    .tab:hover { border-color: #3b4a6b; color: #e2e8f0; }
    .tab.active { background: #1e3a5f; border-color: #2563eb; color: #93c5fd; }
    .tab-count { background: #1e2535; border-radius: 10px; font-size: 11px; padding: 1px 6px; margin-left: 4px; }

    .table-wrap { overflow-x: auto; padding: 0 24px 32px; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #475569; padding: 8px 10px; border-bottom: 1px solid #1e2535; }
    td { padding: 9px 10px; border-bottom: 1px solid #151a28; vertical-align: middle; }
    tr:hover td { background: #141926; }
    .empty { color: #475569; padding: 24px; text-align: center; }

    .col-title { max-width: 340px; word-break: break-word; }
    .col-retries { white-space: nowrap; color: #94a3b8; }
    .col-error { max-width: 200px; }
    .error-msg { color: #f87171; font-size: 12px; cursor: help; }

    .badge { border-radius: 4px; font-size: 11px; font-weight: 600; padding: 2px 7px; text-transform: uppercase; letter-spacing: 0.06em; }
    .badge-pending { background: #334155; color: #94a3b8; }
    .badge-done    { background: #14532d; color: #86efac; }
    .badge-failed  { background: #450a0a; color: #fca5a5; }
    .badge-purged  { background: #422006; color: #fdba74; }

    .btn { border: none; border-radius: 5px; cursor: pointer; font-size: 12px; padding: 4px 10px; font-family: inherit; text-decoration: none; display: inline-block; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-retry  { background: #1e3a5f; color: #93c5fd; }
    .btn-retry:hover  { background: #1d4ed8; }
    .btn-purge  { background: #422006; color: #fdba74; }
    .btn-purge:hover  { background: #c2410c; }
    .btn-delete { background: #450a0a; color: #fca5a5; }
    .btn-delete:hover { background: #991b1b; }
    .btn-audio  { background: #14532d; color: #86efac; }
    .btn-audio:hover  { background: #166534; }

    #toast { position: fixed; bottom: 24px; right: 24px; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; font-size: 13px; padding: 10px 16px; opacity: 0; transition: opacity 0.2s; pointer-events: none; z-index: 100; }
    #toast.show { opacity: 1; }
    #toast.error { border-color: #7f1d1d; color: #fca5a5; }
  </style>
</head>
<body>
  <header>
    <h1>Narratio</h1>
    <a class="rss-link" href="/rss">RSS Feed</a>
  </header>

  <div class="summary">
    <div class="stat"><div class="stat-value">${counts.all}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-value" style="color:#94a3b8">${counts.pending}</div><div class="stat-label">Pending</div></div>
    <div class="stat"><div class="stat-value" style="color:#86efac">${counts.done}</div><div class="stat-label">Done</div></div>
    <div class="stat"><div class="stat-value" style="color:#fca5a5">${counts.failed}</div><div class="stat-label">Failed</div></div>
    <div class="stat"><div class="stat-value" style="color:#fdba74">${counts.purged}</div><div class="stat-label">Purged</div></div>
  </div>

  <div class="tabs">${tabsHtml}</div>

  <div class="table-wrap">
    <table id="articles-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Date</th>
          <th>Retries</th>
          <th>Error</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="articles-body">
        ${rowsHtml}
      </tbody>
    </table>
  </div>

  <div id="toast"></div>

  <script>
    const toast = document.getElementById('toast');
    function showToast(msg, isError) {
      toast.textContent = msg;
      toast.className = 'show' + (isError ? ' error' : '');
      clearTimeout(toast._t);
      toast._t = setTimeout(() => { toast.className = ''; }, 3000);
    }

    // Filter tabs
    const tabs = document.querySelectorAll('.tab');
    tabs[0].classList.add('active');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
        document.querySelectorAll('#articles-body tr[data-status]').forEach(row => {
          row.style.display = (filter === 'all' || row.dataset.status === filter) ? '' : 'none';
        });
      });
    });

    // Action buttons
    document.getElementById('articles-body').addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, guid } = btn.dataset;
      if (action === 'delete' && !confirm('Delete this article permanently?')) return;

      btn.disabled = true;
      try {
        let res;
        if (action === 'delete') {
          res = await fetch('/api/articles/' + encodeURIComponent(guid), { method: 'DELETE' });
        } else {
          res = await fetch('/api/articles/' + encodeURIComponent(guid) + '/' + action, { method: 'POST' });
        }
        if (!res.ok) {
          const txt = await res.text();
          showToast('Error: ' + txt, true);
          btn.disabled = false;
        } else {
          showToast(action.charAt(0).toUpperCase() + action.slice(1) + ' successful', false);
          setTimeout(() => location.reload(), 600);
        }
      } catch (err) {
        showToast('Network error', true);
        btn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
