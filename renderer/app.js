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
      pill('En la red', s.advertising),
      pill('Backend', s.backendUp),
      pill('Mongo', s.mongoUp),
    ].join('');
  }
  setInterval(refreshStatus, 3000);
  refreshStatus();

  // --- jornada sin sincronizar (datos locales, funciona sin internet) ---
  async function checkPending() {
    const r = await api.getPending();
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) {
      $('#pendingBar').hidden = true;
      state.pending = null;
      return;
    }
    const inst = r.data[0];
    state.pending = inst;
    if (!state.institutionId) state.institutionId = inst._id;
    $('#pendingBar').hidden = false;

    const n = r.data.length;
    if (!state.token) {
      // pre-login: no filtramos el nombre de la institución
      $('#pendingText').textContent =
        `🔒 ${n} institución${n > 1 ? 'es' : ''} en modo sede en esta laptop — conectate para sincronizar y finalizar`;
      $('#btnGoSync').textContent = 'Conectar';
      $('#syncTarget').textContent = '';
      return;
    }
    const since = inst.offlineMode && inst.offlineMode.since
      ? new Date(inst.offlineMode.since).toLocaleDateString('es-AR')
      : null;
    const synced = inst.offlineMode && inst.offlineMode.lastSyncAt;
    $('#pendingText').textContent =
      `🔒 Modo sede activo: ${inst.name}${since ? ` (desde ${since})` : ''}` +
      (synced ? '' : ' — todavía sin sincronizar');
    $('#btnGoSync').textContent = 'Ir a sincronizar';
    $('#syncTarget').textContent = `Institución: ${inst.name}`;
  }
  checkPending();
  $('#btnGoSync').addEventListener('click', () => show(state.token ? 'sincronizar' : 'conectar'));

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
    await checkPending(); // ahora sí puede mostrar el nombre
    await loadInstitutions();
    show(state.pending ? 'sincronizar' : 'institucion');
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
    const inst = state.institutions.find((i) => i._id === state.institutionId);
    $('#syncTarget').textContent = inst ? `Institución: ${inst.name}` : '';
    await checkPending();
    show('servir');
  });

  // --- 3. servir ---
  $('#btnServe').addEventListener('click', async () => {
    const st = await api.getStatus();
    if (st.ok && st.data.advertising) {
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
  function renderConflicts(conflicts, finalize) {
    $('#conflictList').innerHTML = (conflicts || [])
      .map((c) => {
        const fields = (c.changedFields || [])
          .map((f) => `${f}: nube = ${JSON.stringify(c.cloud[f])} · sede = ${c.local ? JSON.stringify(c.local[f]) : '—'}`)
          .join('<br>');
        return `<li><b>${c.label}</b> <span class="muted">(${c.collection})</span><br>${fields || 'cambió'}</li>`;
      })
      .join('');
    $('#conflictBox').hidden = false;
    $('#btnResolveVenue').onclick = () => { $('#conflictBox').hidden = true; doSync(finalize, 'overwrite'); };
    $('#btnResolveCloud').onclick = () => { $('#conflictBox').hidden = true; doSync(finalize, 'keepCloud'); };
    $('#btnResolveCancel').onclick = () => {
      $('#conflictBox').hidden = true;
      $('#syncResult').textContent = 'Cancelado. Arreglá los datos en la web y volvé a sincronizar.';
    };
  }

  async function doSync(finalize, conflictResolution) {
    if (!state.token) {
      $('#syncResult').textContent = 'Conectate primero (paso 1 · Conectar) para sincronizar.';
      show('conectar');
      return;
    }
    if (!state.institutionId) {
      $('#syncResult').textContent = 'No hay ninguna jornada para sincronizar en esta laptop.';
      return;
    }
    $('#conflictBox').hidden = true;
    $('#syncResult').textContent = 'Sincronizando…';
    const r = await api.sync(state.token, state.institutionId, finalize, conflictResolution);
    if (!r.ok) {
      if (r.body && r.body.code === 'CONFLICTS') {
        $('#syncResult').textContent = `${(r.body.conflicts || []).length} conflicto(s) — elegí abajo.`;
        renderConflicts(r.body.conflicts, finalize);
        return;
      }
      $('#syncResult').textContent = `Error: ${r.error}\n${JSON.stringify(r.body || {}, null, 2)}`;
      return;
    }
    const d = r.data;
    const del = (d.toReview && d.toReview.deletions) || {};
    const delLines = Object.entries(del)
      .filter(([, ids]) => ids.length)
      .map(([k, ids]) => `  ${k}: ${ids.length} para revisar y borrar a mano`)
      .join('\n');
    const kept = (d.keptCloud || []).length
      ? `\nse mantuvo la versión de la nube en ${d.keptCloud.length} doc(s)`
      : d.resolution === 'overwrite'
        ? '\nla sede pisó los cambios de la nube'
        : '';
    $('#syncResult').textContent =
      `OK ✓ ${finalize ? '(finalizado, candado liberado)' : '(sigue en modo sede)'}${kept}\n` +
      `aplicados: ${JSON.stringify(d.applied)}\n` +
      (delLines ? `bajas a revisar:\n${delLines}` : 'sin bajas a revisar');
    await checkPending();
  }
  $('#btnSync').addEventListener('click', () => doSync(false));
  $('#btnFinalize').addEventListener('click', () => doSync(true));
  $('#btnUnlock').addEventListener('click', async () => {
    if (!state.token) { show('conectar'); return; }
    if (!confirm('¿Forzar desbloqueo? Se descarta TODO lo de la jornada que no haya llegado a la nube.')) return;
    const r = await api.unlock(state.token, state.institutionId);
    $('#syncResult').textContent = r.ok ? 'Desbloqueada ✓ (sin sincronizar)' : `Error: ${r.error}`;
    await checkPending();
  });
})();
