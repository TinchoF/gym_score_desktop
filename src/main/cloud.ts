/**
 * Cliente del backend en la nube + orquestación de preparar / sincronizar.
 * Ver docs/MODO_SEDE.md.
 */
import { CLOUD_API_URL, LOCAL_API_URL, localSecret } from './config';

/**
 * fetch a la nube con timeout + timing en el log. Un Heroku "eco" dyno dormido
 * puede tardar 10-20s en despertar en el primer request — no es un cuelgue, pero
 * sin esto no había forma de distinguirlo de un problema real ni de darle un
 * límite. 45s de margen (arranque de dyno + conexión a Mongo Atlas si también
 * estaba fría).
 */
const CLOUD_TIMEOUT_MS = 45000;
// bundle/sync mueven la institución entera — les damos más margen que a un login.
const CLOUD_TIMEOUT_MS_LONG = 120000;

async function cloudFetch(url: string, init?: RequestInit, timeoutMs = CLOUD_TIMEOUT_MS): Promise<Response> {
  const start = Date.now();
  console.log(`[cloud] → ${init?.method || 'GET'} ${url}`);
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    console.log(`[cloud] ← ${res.status} ${url} (${Date.now() - start}ms)`);
    return res;
  } catch (err: any) {
    const ms = Date.now() - start;
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `La nube no respondió en ${Math.round(timeoutMs / 1000)}s (${url}). ` +
          `¿Hay internet? Si el servidor estaba "dormido" puede que ya haya despertado — reintentá.`,
      );
    }
    console.log(`[cloud] ✗ ${url} (${ms}ms): ${err?.message}`);
    throw err;
  }
}

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error((body as any)?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body as T;
}

// --- nube ---

/**
 * Login de super-admin contra la nube. La app web usa el prefijo `###` en el
 * username para marcar super-admin; acá lo aceptamos con o sin prefijo y siempre
 * mandamos role: 'super-admin' (la app Electron es una herramienta de super-admin).
 */
export async function login(username: string, password: string): Promise<{ token: string; role: string }> {
  const clean = username.trim().replace(/^###/, '');
  const data = await j<any>(
    await cloudFetch(`${CLOUD_API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: clean, password, role: 'super-admin' }),
    }),
  );
  return { token: data.token, role: 'super-admin' };
}

export async function listInstitutions(token: string): Promise<any[]> {
  return j(await cloudFetch(`${CLOUD_API_URL}/api/institution`, { headers: { Authorization: `Bearer ${token}` } }));
}

export async function lockInstitution(
  token: string,
  institutionId: string,
  deviceLabel?: string,
  force = false,
) {
  return j(
    await cloudFetch(`${CLOUD_API_URL}/api/offline/institutions/${institutionId}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceLabel, force }),
    }),
  );
}

export async function unlockInstitution(token: string, institutionId: string) {
  return j(
    await cloudFetch(`${CLOUD_API_URL}/api/offline/institutions/${institutionId}/unlock`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

async function getBundle(token: string, institutionId: string): Promise<any> {
  return j(
    await cloudFetch(
      `${CLOUD_API_URL}/api/offline/institutions/${institutionId}/bundle`,
      { headers: { Authorization: `Bearer ${token}` } },
      CLOUD_TIMEOUT_MS_LONG,
    ),
  );
}

async function pushSync(
  token: string,
  institutionId: string,
  payload: any,
  extra: { finalize?: boolean; conflictResolution?: 'overwrite' | 'keepCloud'; dryRun?: boolean },
): Promise<any> {
  return j(
    await cloudFetch(
      `${CLOUD_API_URL}/api/offline/institutions/${institutionId}/sync`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...payload, ...extra }),
      },
      CLOUD_TIMEOUT_MS_LONG,
    ),
  );
}

// --- local (backend en OFFLINE_MODE, ya sirviendo) ---

async function importLocal(bundle: any): Promise<any> {
  return j(
    await fetch(`${LOCAL_API_URL}/api/offline-local/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-offline-secret': localSecret() },
      body: JSON.stringify(bundle),
    }),
  );
}

async function exportLocal(institutionId: string): Promise<any> {
  return j(
    await fetch(`${LOCAL_API_URL}/api/offline-local/export?institutionId=${institutionId}`, {
      headers: { 'x-offline-secret': localSecret() },
    }),
  );
}

/** Instituciones cargadas localmente con una jornada sin sincronizar. Funciona sin internet. */
export async function getPending(): Promise<any[]> {
  return j(
    await fetch(`${LOCAL_API_URL}/api/offline-local/pending`, {
      headers: { 'x-offline-secret': localSecret() },
    }),
  );
}

/** Borra la copia local de una institución (tras finalizar / forzar desbloqueo). */
export async function discardLocal(institutionId: string): Promise<any> {
  return j(
    await fetch(`${LOCAL_API_URL}/api/offline-local/discard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-offline-secret': localSecret() },
      body: JSON.stringify({ institutionId }),
    }),
  );
}

// --- flujos completos ---

/**
 * Bloquea la institución en la nube, baja el bundle y lo carga en la DB local.
 * `force` en el lock: si ya estaba bloqueada (reintento tras un fallo, u otra
 * laptop), el super-admin re-toma el candado en esta laptop.
 */
export async function prepareForOffline(token: string, institutionId: string, deviceLabel?: string) {
  await lockInstitution(token, institutionId, deviceLabel, true);
  const bundle = await getBundle(token, institutionId);
  const imported = await importLocal(bundle);
  return { imported, bundleMeta: bundle.meta };
}

/** Exporta el estado local y lo sincroniza a la nube. `finalize` libera el candado. */
export async function syncToCloud(
  token: string,
  institutionId: string,
  finalize: boolean,
  conflictResolution?: 'overwrite' | 'keepCloud',
) {
  const payload = await exportLocal(institutionId);
  return pushSync(token, institutionId, payload, { finalize, conflictResolution });
}

/** Preview: qué haría la sincronización, sin escribir nada ni tocar el candado. */
export async function previewChanges(token: string, institutionId: string) {
  const payload = await exportLocal(institutionId);
  return pushSync(token, institutionId, payload, { dryRun: true });
}
