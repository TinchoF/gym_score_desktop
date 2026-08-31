/* global window, document, alert, confirm */
// IIFE: `const api = window.api` a nivel de script clásico colisiona con la
// propiedad no-configurable que crea contextBridge.
(function () {
  const api = window.api;
  if (!api) {
    document.body.innerHTML =
      '<p style="padding:24px;color:#b23">Error interno: el puente con la app no cargó. Reiniciá.</p>';
    return;
  }
  window.addEventListener('unhandledrejection', (e) => console.error('unhandledrejection', e.reason));

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-AR') : '');
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '');

  const state = { token: null, institutions: [], localPending: new Set(), localPendingData: [], managing: null };

  const show = (view) => $$('.view').forEach((el) => el.classList.toggle('active', el.id === view));

  // ---------- estado ----------
  let statusTimer = null;
  async function refreshStatus() {
    if (!state.token) return;
    const r = await api.getStatus();
    if (!r.ok) return;
    const s = r.data;
    $('#statusStrip').hidden = false;
    $('#statusStrip').innerHTML =
      `<span class="pill ${s.advertising ? 'on' : 'off'}">En la red</span>` +
      `<span class="pill ${s.backendUp ? 'on' : 'off'}">Backend</span>` +
      `<span class="pill ${s.mongoUp ? 'on' : 'off'}">Mongo</span>`;
  }

  // ---------- login ----------
  async function doLogin() {
    $('#loginMsg').textContent = 'Conectando…';
    const r = await api.login($('#user').value.trim(), $('#pass').value, $('#remember').checked);
    if (!r.ok) { $('#loginMsg').textContent = `Error: ${r.error}`; return; }
    state.token = r.data.token;
    $('#loginMsg').textContent = '';
    $('#btnForget').hidden = !$('#remember').checked;
    statusTimer = statusTimer || setInterval(refreshStatus, 3000);
    await refreshStatus();
    await loadList();
    show('viewList');
  }
  $('#btnLogin').addEventListener('click', doLogin);
  $('#pass').addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  $('#btnForget').addEventListener('click', async () => {
    await api.clearCreds();
    $('#remember').checked = false;
    $('#btnForget').hidden = true;
    $('#loginMsg').textContent = 'Credenciales borradas de esta laptop.';
  });
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

  // ---------- lista de instituciones ----------
  const BADGES = {
    online: ['🟢', 'Online', 'ok'],
    'sede-aca': ['🔒', 'En modo sede · esta laptop', 'warn'],
    'sede-otra': ['🔒', 'En modo sede · otra laptop', 'muted'],
    'local-stale': ['⚠️', 'Copia local vieja', 'danger'],
  };

  function computeState(inst) {
    const cloudLocked = !!(inst.offlineMode && inst.offlineMode.active);
    const localHas = state.localPending.has(String(inst._id));
    if (cloudLocked && localHas) return 'sede-aca';
    if (cloudLocked && !localHas) return 'sede-otra';
    if (!cloudLocked && localHas) return 'local-stale';
    return 'online';
  }

  async function loadList() {
    $('#listMsg').textContent = 'Cargando…';
    const [instR, pendR] = await Promise.all([api.listInstitutions(state.token), api.getPending()]);
    state.localPendingData = pendR.ok && Array.isArray(pendR.data) ? pendR.data : [];
    state.localPending = new Set(state.localPendingData.map((i) => String(i._id)));

    if (!instR.ok) {
      $('#listMsg').textContent = 'Sin conexión a la nube — mostrando solo lo que está en esta laptop.';
      state.institutions = state.localPendingData;
    } else {
      $('#listMsg').textContent = '';
      state.institutions = instR.data;
    }
    renderList();
  }

  function renderList() {
    $('#instList').innerHTML = state.institutions
      .map((inst) => {
        const st = computeState(inst);
        const [icon, text, cls] = BADGES[st];
        const om = inst.offlineMode || {};
        const extra = [
          om.since ? `desde ${fmtDate(om.since)}` : '',
          om.deviceLabel ? om.deviceLabel : '',
        ].filter(Boolean).join(' · ');
        return `<li>
          <div><b>${esc(inst.name)}</b><br>
          <span class="badge ${cls}">${icon} ${text}</span>
          ${extra ? `<span class="muted"> ${esc(extra)}</span>` : ''}</div>
          <button data-id="${inst._id}">Administrar</button>
        </li>`;
      })
      .join('') || '<li class="muted">No hay instituciones.</li>';
    $$('#instList button[data-id]').forEach((b) => {
      b.onclick = () => openManage(state.institutions.find((i) => String(i._id) === b.dataset.id));
    });
  }
  $('#btnRefresh').addEventListener('click', loadList);

  // ---------- administrar una institución ----------
  function openManage(inst) {
    state.managing = inst;
    $('#manageName').textContent = inst.name;
    renderManage();
    show('viewManage');
  }
  $('#btnBack').addEventListener('click', () => { show('viewList'); loadList(); });

  function renderManage() {
    const inst = state.managing;
    const st = computeState(inst);
    const om = inst.offlineMode || {};
    ['actOnline', 'actSede', 'actOther', 'actStale'].forEach((id) => ($('#' + id).hidden = true));
    $('#conflictBox').hidden = true;
    $('#report').textContent = '';

    if (st === 'online') {
      $('#manageState').textContent = 'Online — editable desde la web.';
      $('#manageState').className = 'state-banner ok';
      $('#actOnline').hidden = false;
    } else if (st === 'sede-aca') {
      $('#manageState').textContent =
        `En modo sede desde ${fmtDate(om.since)}` +
        (om.lastSyncAt ? ` · última sync ${fmtDateTime(om.lastSyncAt)}` : ' · sin sincronizar aún') + '.';
      $('#manageState').className = 'state-banner warn';
      $('#actSede').hidden = false;
    } else if (st === 'sede-otra') {
      $('#manageState').textContent = 'En modo sede — otra laptop.';
      $('#manageState').className = 'state-banner muted';
      $('#actOther').textContent =
        `Está en modo sede en otra laptop${om.deviceLabel ? ` (${om.deviceLabel})` : ''}` +
        ` desde ${fmtDate(om.since)}. No podés operar desde acá hasta que esa laptop sincronice y finalice.`;
      $('#actOther').hidden = false;
    } else {
      $('#manageState').textContent = 'Ya desbloqueada online — la copia local quedó vieja.';
      $('#manageState').className = 'state-banner danger';
      $('#actStale').hidden = false;
    }
  }

  $('#btnPrepare').addEventListener('click', async () => {
    const inst = state.managing;
    $('#report').textContent = 'Bloqueando y descargando… (puede tardar)';
    const r = await api.prepare(state.token, inst._id, $('#deviceLabel').value.trim() || undefined);
    if (!r.ok) { $('#report').textContent = `Error: ${r.error}`; return; }
    const c = (r.data.imported && r.data.imported.counts) || {};
    $('#report').textContent = `Listo ✓  ${c.gymnasts || 0} gimnastas, ${c.tournaments || 0} torneos, ${c.judges || 0} jueces.`;
    await loadList();
    state.managing = state.institutions.find((i) => String(i._id) === String(inst._id)) || inst;
    renderManage();
  });

  $('#btnCheck').addEventListener('click', () => runSync({ dryRun: true }));
  $('#btnSync').addEventListener('click', () => runSync({ finalize: false }));
  $('#btnFinalize').addEventListener('click', () => runSync({ finalize: true }));

  async function runSync({ finalize, dryRun, conflictResolution }) {
    const inst = state.managing;
    $('#conflictBox').hidden = true;
    $('#report').textContent = dryRun ? 'Verificando…' : 'Sincronizando…';
    const r = dryRun
      ? await api.previewChanges(state.token, inst._id)
      : await api.sync(state.token, inst._id, !!finalize, conflictResolution);
    if (!r.ok) {
      if (r.body && r.body.code === 'CONFLICTS') {
        $('#report').textContent = `${(r.body.conflicts || []).length} conflicto(s) — elegí abajo.`;
        renderConflicts(r.body.conflicts, finalize);
        return;
      }
      $('#report').textContent = `Error: ${r.error}`;
      return;
    }
    $('#report').textContent = renderReport(r.data, { finalize, dryRun });
    if (!dryRun && finalize && r.data.ok) {
      await api.discardLocal(inst._id);
      await loadList();
      setTimeout(() => show('viewList'), 1500);
    }
  }

  $('#btnForce').addEventListener('click', async () => {
    if (!confirm('¿Forzar desbloqueo? Se descarta TODO lo de la jornada que no haya llegado a la nube.')) return;
    await api.unlock(state.token, state.managing._id);
    await api.discardLocal(state.managing._id);
    await loadList();
    show('viewList');
  });
  $('#btnDiscard').addEventListener('click', async () => {
    if (!confirm('¿Descartar la copia local de esta institución?')) return;
    await api.discardLocal(state.managing._id);
    await loadList();
    show('viewList');
  });

  // ---------- conflictos ----------
  function renderConflicts(conflicts, finalize) {
    $('#conflictList').innerHTML = (conflicts || [])
      .map((c) => {
        const fields = (c.changedFields || [])
          .map((f) => `${esc(f)}: nube = ${esc(JSON.stringify(c.cloud[f]))} · sede = ${c.local ? esc(JSON.stringify(c.local[f])) : '—'}`)
          .join('<br>');
        return `<li><b>${esc(c.label)}</b> <span class="muted">(${esc(c.collection)})</span><br>${fields || 'cambió'}</li>`;
      })
      .join('');
    $('#conflictBox').hidden = false;
    $('#btnResolveVenue').onclick = () => runSync({ finalize, conflictResolution: 'overwrite' });
    $('#btnResolveCloud').onclick = () => runSync({ finalize, conflictResolution: 'keepCloud' });
    $('#btnResolveCancel').onclick = () => {
      $('#conflictBox').hidden = true;
      $('#report').textContent = 'Cancelado. Arreglá los datos en la web y volvé a verificar.';
    };
  }

  // ---------- reporte del diff ----------
  const COL_LABELS = { tournaments: 'torneos', gymnasts: 'gimnastas', judges: 'jueces', scores: 'puntajes', rotations: 'rotaciones' };
  function renderReport(d, { finalize, dryRun }) {
    const lines = [];
    for (const [col, ch] of Object.entries(d.changes || {})) {
      const parts = [];
      if (ch.created.length) parts.push(`${ch.created.length} nuevas`);
      if (ch.updated.length) parts.push(`${ch.updated.length} modificadas`);
      if (ch.deleted.length) parts.push(`${ch.deleted.length} para borrar a mano`);
      if (parts.length) lines.push(`  ${COL_LABELS[col] || col}: ${parts.join(', ')} (${ch.unchanged} sin cambios)`);
    }
    const detail = (arr, verb) =>
      arr.slice(0, 12).map((x) => `    · ${verb} ${x.label}${x.changedFields ? ` (${x.changedFields.join(', ')})` : ''}`).join('\n');
    const detailBlocks = Object.entries(d.changes || {})
      .flatMap(([, ch]) => [
        ...(ch.created.length ? [detail(ch.created, 'nueva:')] : []),
        ...(ch.updated.length ? [detail(ch.updated, 'modificada:')] : []),
        ...(ch.deleted.length ? [detail(ch.deleted, 'baja pendiente:')] : []),
      ])
      .filter(Boolean)
      .join('\n');

    const kept = (d.keptCloud || []).length
      ? `Se mantiene la versión de la nube en ${d.keptCloud.length} doc(s).\n`
      : d.resolution === 'overwrite' ? 'La sede pisa los cambios de la nube.\n' : '';
    const conf = (d.conflicts || []).length && !d.resolution
      ? `⚠️ ${d.conflicts.length} conflicto(s) con cambios hechos en la nube — se resuelven al sincronizar.\n`
      : '';

    let head;
    if (dryRun) head = d.upToDate ? '✓ Al día — no hay nada para sincronizar.' : 'Cambios pendientes de sincronizar:';
    else if (finalize) head = '✓ Finalizado — la institución quedó online de nuevo.';
    else if (d.upToDate) head = '✓ Sincronizado — no había cambios.';
    else head = '✓ Sincronizado (sigue en modo sede).';

    return head + '\n' + conf + kept + (lines.length ? lines.join('\n') + '\n' + detailBlocks : (dryRun ? '' : 'Sin cambios.'));
  }

  // ---------- servir ----------
  $('#btnServe').addEventListener('click', async () => {
    const st = await api.getStatus();
    if (st.ok && st.data.advertising) {
      await api.stopServing();
      $('#btnServe').textContent = 'SERVIR EN LA RED';
      $('#serveInfo').hidden = true;
    } else {
      $('#btnServe').textContent = 'Iniciando…';
      const r = await api.startServing();
      if (!r.ok) { $('#btnServe').textContent = 'SERVIR EN LA RED'; alert('Error al servir: ' + r.error); return; }
      $('#serveUrl').textContent = r.data.mdnsUrl;
      $('#serveIp').textContent = r.data.url;
      const qr = await api.makeQr(r.data.mdnsUrl);
      if (qr.ok) $('#qr').src = qr.data;
      const served = state.localPendingData.map((i) => i.name).join(', ');
      $('#serveScope').textContent = served ? `Sirviendo: ${served}` : '⚠️ No hay instituciones descargadas.';
      $('#serveInfo').hidden = false;
      $('#btnServe').textContent = 'DETENER';
    }
    refreshStatus();
  });
})();
