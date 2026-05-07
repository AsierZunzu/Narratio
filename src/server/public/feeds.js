/* Feeds page */
(function () {
  'use strict';
  const N = window.Narratio;
  const BASE_URL = window.NARRATIO.baseUrl;

  const grid = document.getElementById('feeds-grid');
  const form = document.getElementById('feed-form');
  const idInput = document.getElementById('feed-id');
  const slugInput = document.getElementById('f-slug');
  const slugPreview = document.getElementById('f-slug-preview');
  const titleEl = document.getElementById('feed-modal-title');
  const eyebrowEl = document.getElementById('feed-modal-eyebrow');

  if (slugInput && slugPreview) {
    slugInput.addEventListener('input', () => {
      slugPreview.textContent = BASE_URL + '/rss/' + (slugInput.value || '…');
    });
  }

  async function refreshTtsDropdown(selectedId) {
    try {
      const res = await fetch('/api/tts-services');
      if (!res.ok) return;
      const services = await res.json();
      const sel = document.getElementById('f-tts');
      if (!sel) return;
      sel.innerHTML = services.length === 0
        ? '<option value="" disabled>No voices configured</option>'
        : services.map((s) => `<option value="${N.escAttr(s.id)}"${String(s.id) === String(selectedId) ? ' selected' : ''}>${N.escHtml(s.name)} (${N.escHtml(s.host)}:${N.escHtml(String(s.port))})</option>`).join('');
    } catch { /* silent */ }
  }

  const imageInput = document.getElementById('f-image');
  const imagePreview = document.getElementById('f-image-preview');
  const imageRemoveBtn = document.getElementById('f-image-remove');
  const fileNameEl = document.getElementById('f-file-name');
  const fileTextEl = document.querySelector('.file-input-label .file-text');
  // Tracks per-modal-open state: whether the user clicked Remove on the existing image.
  let imageRemovalRequested = false;

  function setImagePreview(src) {
    if (!imagePreview) return;
    if (src) {
      imagePreview.src = src;
      imagePreview.hidden = false;
      if (imageRemoveBtn) imageRemoveBtn.hidden = false;
    } else {
      imagePreview.removeAttribute('src');
      imagePreview.hidden = true;
      if (imageRemoveBtn) imageRemoveBtn.hidden = true;
    }
  }

  function updateFileName(name) {
    if (!fileNameEl || !fileTextEl) return;
    if (name) {
      fileNameEl.textContent = name;
      fileNameEl.hidden = false;
      fileTextEl.hidden = true;
    } else {
      fileNameEl.hidden = true;
      fileTextEl.hidden = false;
    }
  }

  imageInput?.addEventListener('change', () => {
    const file = imageInput.files && imageInput.files[0];
    if (!file) return;
    imageRemovalRequested = false;
    updateFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  });

  imageRemoveBtn?.addEventListener('click', () => {
    imageRemovalRequested = true;
    if (imageInput) imageInput.value = '';
    updateFileName('');
    setImagePreview('');
  });

  function openFeedModal(feed) {
    form.reset();
    imageRemovalRequested = false;
    updateFileName('');
    setImagePreview(feed && feed.image_file ? BASE_URL + '/feed-images/' + encodeURIComponent(feed.image_file) : '');
    refreshTtsDropdown(feed ? feed.tts_service_id : null);
    if (feed) {
      titleEl.textContent = 'Edit Feed';
      eyebrowEl.textContent = 'Editing subscription';
      idInput.value = feed.id;
      ['name','rss_url','slug','title','description','author','language','itunes_author','itunes_category','itunes_owner_name','itunes_owner_email','itunes_summary','unavailable_message','tts_failed_message'].forEach((k) => {
        if (form.elements[k]) form.elements[k].value = feed[k] || '';
      });
      if (form.elements['tts_service_id']) form.elements['tts_service_id'].value = feed.tts_service_id || '';
      if (form.elements['max_audio_files']) form.elements['max_audio_files'].value = feed.max_audio_files || '';
      if (form.elements['max_audio_size_mb']) form.elements['max_audio_size_mb'].value = feed.max_audio_size_mb || '';
      if (slugPreview) slugPreview.textContent = BASE_URL + '/rss/' + feed.slug;
    } else {
      titleEl.textContent = 'Add Feed';
      eyebrowEl.textContent = 'New subscription';
      idInput.value = '';
      if (slugPreview) slugPreview.textContent = BASE_URL + '/rss/…';
    }
    N.openModal('feed-modal');
  }

  document.getElementById('add-feed-btn')?.addEventListener('click', () => openFeedModal(null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = idInput.value;
    const data = Object.fromEntries(new FormData(form).entries());
    delete data['image']; // file goes via separate endpoint
    if (data['max_audio_files'] === '') delete data['max_audio_files'];
    else if (data['max_audio_files']) data['max_audio_files'] = Number(data['max_audio_files']);
    if (data['max_audio_size_mb'] === '') delete data['max_audio_size_mb'];
    else if (data['max_audio_size_mb']) data['max_audio_size_mb'] = Number(data['max_audio_size_mb']);
    data['tts_service_id'] = Number(data['tts_service_id']);

    const imageFile = imageInput && imageInput.files && imageInput.files[0];
    const submitBtn = document.getElementById('feed-form-submit');
    submitBtn.disabled = true;
    try {
      const url = id ? '/api/feeds/' + encodeURIComponent(id) : '/api/feeds';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (!res.ok) {
        N.showToast(await res.text(), true);
        return;
      }
      const saved = await res.json();
      const feedId = id || (saved && saved.id);

      if (feedId && imageFile) {
        const imgRes = await fetch('/api/feeds/' + encodeURIComponent(feedId) + '/image', {
          method: 'POST',
          headers: { 'Content-Type': imageFile.type },
          body: imageFile,
        });
        if (!imgRes.ok) {
          N.showToast('Feed saved, but image upload failed: ' + (await imgRes.text()), true);
          return;
        }
      } else if (feedId && id && imageRemovalRequested) {
        await fetch('/api/feeds/' + encodeURIComponent(feedId) + '/image', { method: 'DELETE' });
      }

      N.showToast(id ? 'Feed updated' : 'Feed created', false);
      N.closeModal('feed-modal');
      setTimeout(() => window.location.reload(), 600);
    } catch {
      N.showToast('Network error', true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  grid.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-feed-edit]');
    const delBtn = e.target.closest('[data-feed-delete]');

    if (editBtn) {
      const id = editBtn.dataset.feedEdit;
      try {
        const res = await fetch('/api/feeds');
        const feeds = await res.json();
        const feed = feeds.find((f) => String(f.id) === String(id));
        if (feed) openFeedModal(feed);
      } catch { N.showToast('Failed to load feed data', true); }
      return;
    }

    if (delBtn) {
      const id = delBtn.dataset.feedDelete;
      if (!confirm('Delete this feed?\n\nAll articles belonging to this feed AND their audio files will be permanently removed. This cannot be undone.')) return;
      delBtn.disabled = true;
      try {
        const res = await fetch('/api/feeds/' + encodeURIComponent(id), { method: 'DELETE' });
        if (res.ok) {
          N.showToast('Feed deleted', false);
          delBtn.closest('.card').remove();
        } else {
          N.showToast(await res.text(), true);
          delBtn.disabled = false;
        }
      } catch {
        N.showToast('Network error', true);
        delBtn.disabled = false;
      }
    }
  });
})();
