/* global window, document, alert, confirm */
// Envuelto en IIFE: `contextBridge` expone `window.api` como propiedad NO configurable,
// y un `const api` a nivel de script clásico colisiona con eso ("Identifier 'api' has
// already been declared"). Dentro de una función no hay colisión.
(function () {
  const api = window.api;
  const state = { token: null, role: null, institutionId: null, institutions: [] };

  if (!api) {
    document.body.innerHTML =
      '<p style="padding:24px;color:#b23">Error interno: el puente con la app no cargó (preload). Reiniciá la app.</p>';
    return;
  }

  window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection', e.reason));

  const $ = (s) => document.querySelector(s);
  const pill = (label, on) => `<span class="pill ${on ? 'on' : 'off'}">${label}</span>`;
  const show = (name) => {
    document.querySelectorAll('.step').forEach((el) => el.classList.toggle('active', el.id === name));
    document.querySelectorAll('.steps button').forEach((b) => b.classList.toggle('active', b.dataset.step === name));
  };
  document.querySelectorAll('.steps button').forEach((b) => b.addEventListener('click', () => show(b.dataset.step)));

  async function refreshStatus() {
    const r = await api.getStatus();
    if (!r.ok) return;
    const s = r.data;
    $('#statusStrip').innerHTML = [
      pill('Sirviendo', s.serving),
      pill('Mongo', s.mongoUp),
      pill('Backend', s.backendUp),
    ].join('');
  }
  setInterval(refreshStatus, 3000);
  refreshStatus();

  // --- 1. login ---
  async function doLogin() {
    $('#loginMsg').textContent = 'Conectando…';
    const r = await api.login($('#user').value.trim(), $('#pass').value, $('#remember').checked);
    if (!r.ok) {
      $('#loginMsg').textContent = `Error: ${r.error}`;
      return;
    }
    state.token = r.data.token;
    state.role = r.data.role;
    $('#loginMsg').textContent = 'Conectado ✓';
    $('#btnForget').hidden = !$('#remember').checked;
    await loadInstitutions();
    show('institucion');
  }
  $('#btnLogin').addEventListener('click', doLogin);
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#btnForget').addEventListener('click', async () => {
    await api.clearCreds();
    $('#remember').checked = false;
    $('#btnForget').hidden = true;
    $('#loginMsg').textContent = 'Credenciales borradas de esta laptop.';
  });

  // pre-cargar credenciales guardadas
  (async () => {
    const saved = await api.loadCreds();
    if (saved && saved.ok && saved.data) {
      $('#user').value = saved.data.username || '';
      $('#pass').value = saved.data.password || '';
      $('#remember').checked = true;
      $('#btnForget').hidden = false;
      $('#loginMsg').textContent = 'Credenciales recordadas — apretá Ingresar.';
    }
  })();

  async function loadInstitutions() {
    const r = await api.listInstitutions(state.token);
    if (!r.ok) {
      $('#prepareMsg').textContent = `No se pudo listar instituciones: ${r.error}`;
      return;
    }
    state.institutions = r.data;
    $('#instSelect').innerHTML = r.data
      .map((i) => `<option value="${i._id}">${i.name}${i.offlineMode && i.offlineMode.active ? ' — (en modo sede)' : ''}</option>`)
      .join('');
  }

  // --- 2. preparar ---
  $('#btnPrepare').addEventListener('click', async () => {
    state.institutionId = $('#instSelect').value;
    if (!state.institutionId) return;
    $('#prepareMsg').textContent = 'Bloqueando y descargando… (puede tardar)';
    const r = await api.prepare(state.token, state.institutionId, $('#deviceLabel').value.trim() || undefined);
    if (!r.ok) {
      $('#prepareMsg').textContent = `Error: ${r.error}`;
      return;
    }
    const c = (r.data.imported && r.data.imported.counts) || {};
    $('#prepareMsg').textContent = `Listo ✓  ${c.gymnasts || 0} gimnastas, ${c.tournaments || 0} torneos, ${c.judges || 0} jueces.`;
    show('servir');
  });

  // --- 3. servir ---
  $('#btnServe').addEventListener('click', async () => {
    const st = await api.getStatus();
    if (st.ok && st.data.serving) {
      await api.stopServing();
      $('#btnServe').textContent = 'SERVIR';
      $('#serveInfo').hidden = true;
    } else {
      $('#btnServe').textContent = 'Iniciando…';
      const r = await api.startServing();
      if (!r.ok) {
        $('#btnServe').textContent = 'SERVIR';
        alert('Error al servir: ' + r.error);
        return;
      }
      $('#serveUrl').textContent = r.data.mdnsUrl;
      $('#serveIp').textContent = r.data.url;
      const qr = await api.makeQr(r.data.mdnsUrl);
      if (qr.ok) $('#qr').src = qr.data;
      $('#serveInfo').hidden = false;
      $('#btnServe').textContent = 'DETENER';
    }
    refreshStatus();
  });

  // --- 4. sincronizar ---
  async function doSync(finalize) {
    $('#syncResult').textContent = 'Sincronizando…';
    const r = await api.sync(state.token, state.institutionId, finalize);
    if (!r.ok) {
      $('#syncResult').textContent = `Error: ${r.error}\n${JSON.stringify(r.body || {}, null, 2)}`;
      return;
    }
    const d = r.data;
    const del = (d.toReview && d.toReview.deletions) || {};
    const delLines = Object.entries(del)
      .filter(([, ids]) => ids.length)
      .map(([k, ids]) => `  ${k}: ${ids.length} para revisar y borrar a mano`)
      .join('\n');
    $('#syncResult').textContent =
      `OK ✓ ${finalize ? '(finalizado, candado liberado)' : '(sigue en modo sede)'}\n` +
      `aplicados: ${JSON.stringify(d.applied)}\n` +
      (delLines ? `bajas a revisar:\n${delLines}` : 'sin bajas a revisar');
  }
  $('#btnSync').addEventListener('click', () => doSync(false));
  $('#btnFinalize').addEventListener('click', () => doSync(true));
  $('#btnUnlock').addEventListener('click', async () => {
    if (!confirm('¿Forzar desbloqueo? Se descarta lo no sincronizado.')) return;
    const r = await api.unlock(state.token, state.institutionId);
    $('#syncResult').textContent = r.ok ? 'Desbloqueada ✓' : `Error: ${r.error}`;
  });
})();
