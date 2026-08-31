/* global window, document */
const api = window.api;
const state = { token: null, role: null, institutionId: null, institutions: [] };

const $ = (s) => document.querySelector(s);
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
const pill = (label, on) => `<span class="pill ${on ? 'on' : 'off'}">${label}</span>`;
setInterval(refreshStatus, 3000);
refreshStatus();

// --- 1. login ---
$('#btnLogin').addEventListener('click', async () => {
  $('#loginMsg').textContent = 'Conectando…';
  const r = await api.login($('#user').value.trim(), $('#pass').value);
  if (!r.ok) return ($('#loginMsg').textContent = `Error: ${r.error}`);
  state.token = r.data.token;
  state.role = r.data.role;
  $('#loginMsg').textContent = 'Conectado ✓';
  await loadInstitutions();
  show('institucion');
});

async function loadInstitutions() {
  const r = await api.listInstitutions(state.token);
  if (!r.ok) return;
  state.institutions = r.data;
  $('#instSelect').innerHTML = r.data
    .map((i) => `<option value="${i._id}">${i.name}${i.offlineMode?.active ? ' — (en modo sede)' : ''}</option>`)
    .join('');
}

// --- 2. preparar ---
$('#btnPrepare').addEventListener('click', async () => {
  state.institutionId = $('#instSelect').value;
  $('#prepareMsg').textContent = 'Bloqueando y descargando… (puede tardar)';
  const r = await api.prepare(state.token, state.institutionId, $('#deviceLabel').value.trim() || undefined);
  if (!r.ok) return ($('#prepareMsg').textContent = `Error: ${r.error}`);
  const c = r.data.imported?.counts || {};
  $('#prepareMsg').textContent = `Listo ✓  ${c.gymnasts || 0} gimnastas, ${c.tournaments || 0} torneos, ${c.judges || 0} jueces.`;
  show('servir');
});

// --- 3. servir ---
$('#btnServe').addEventListener('click', async () => {
  const serving = (await api.getStatus()).data?.serving;
  if (serving) {
    await api.stopServing();
    $('#btnServe').textContent = 'SERVIR';
    $('#serveInfo').hidden = true;
  } else {
    $('#btnServe').textContent = 'Iniciando…';
    const r = await api.startServing();
    if (!r.ok) {
      $('#btnServe').textContent = 'SERVIR';
      return alert('Error al servir: ' + r.error);
    }
    const url = r.data.mdnsUrl;
    $('#serveUrl').textContent = url;
    $('#serveIp').textContent = r.data.url;
    const qr = await api.makeQr(url);
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
  const del = d.toReview?.deletions || {};
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
