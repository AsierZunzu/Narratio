/* Voices (TTS) page */
(function () {
  'use strict';
  const N = window.Narratio;

  const grid = document.getElementById('tts-grid');
  const form = document.getElementById('tts-form');
  const idInput = document.getElementById('tts-id');
  const titleEl = document.getElementById('tts-modal-title');
  const eyebrowEl = document.getElementById('tts-modal-eyebrow');

  function openTtsModal(svc) {
    form.reset();
    const result = document.getElementById('tts-test-result');
    if (result) { result.textContent = ''; result.className = 'test-result'; }
    if (svc) {
      titleEl.textContent = 'Edit Voice';
      eyebrowEl.textContent = 'Editing voice';
      idInput.value = svc.id;
      form.elements['name'].value = svc.name || '';
      form.elements['host'].value = svc.host || '';
      form.elements['port'].value = svc.port || '';
    } else {
      titleEl.textContent = 'Add Voice';
      eyebrowEl.textContent = 'New voice';
      idInput.value = '';
    }
    N.openModal('tts-modal');
  }

  document.getElementById('add-tts-btn')?.addEventListener('click', () => openTtsModal(null));

  document.getElementById('tts-test-btn')?.addEventListener('click', async () => {
    const host = form.elements['host'].value.trim();
    const port = form.elements['port'].value.trim();
    const result = document.getElementById('tts-test-result');
    const testBtn = document.getElementById('tts-test-btn');
    if (!host || !port) {
      result.className = 'test-result err';
      result.textContent = 'Enter host and port first';
      return;
    }
    testBtn.disabled = true;
    result.className = 'test-result';
    result.textContent = 'Testing…';
    try {
      const res = await fetch('/api/tts-services/test-connection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: Number(port) }),
      });
      const data = await res.json();
      result.className = 'test-result ' + (data.ok ? 'ok' : 'err');
      result.textContent = (data.ok ? '✓ ' : '✗ ') + data.message;
    } catch {
      result.className = 'test-result err';
      result.textContent = '✗ Network error';
    } finally {
      testBtn.disabled = false;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = idInput.value;
    const data = Object.fromEntries(new FormData(form).entries());
    data['port'] = Number(data['port']);
    const submitBtn = document.getElementById('tts-form-submit');
    submitBtn.disabled = true;
    try {
      const url = id ? '/api/tts-services/' + encodeURIComponent(id) : '/api/tts-services';
      const method = id ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) {
        N.showToast(id ? 'Voice updated' : 'Voice created', false);
        N.closeModal('tts-modal');
        setTimeout(() => window.location.reload(), 600);
      } else {
        N.showToast(await res.text(), true);
      }
    } catch {
      N.showToast('Network error', true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  grid.addEventListener('click', async (e) => {
    const editBtn = e.target.closest('[data-tts-edit]');
    const delBtn = e.target.closest('[data-tts-delete]');
    if (editBtn) {
      const id = editBtn.dataset.ttsEdit;
      try {
        const res = await fetch('/api/tts-services');
        const services = await res.json();
        const svc = services.find((s) => String(s.id) === String(id));
        if (svc) openTtsModal(svc);
      } catch { N.showToast('Failed to load voice data', true); }
      return;
    }
    if (delBtn) {
      const id = delBtn.dataset.ttsDelete;
      if (!confirm('Delete this voice? This cannot be undone.')) return;
      delBtn.disabled = true;
      try {
        const res = await fetch('/api/tts-services/' + encodeURIComponent(id), { method: 'DELETE' });
        if (res.ok) {
          N.showToast('Voice deleted', false);
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
