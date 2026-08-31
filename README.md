# GymScore — Modo Sede (app de escritorio)

Sirve un torneo GymScore **sin internet** desde una laptop en la red local de la sede.
Parte del feature "Modo Sede" — el plan y el log de implementación están en
`../GymScore/docs/MODO_SEDE.md`.

## Qué hace

1. **Conectar** — login de super-admin (o admin) contra el backend en la nube.
2. **Institución** — elegís una institución → la bloquea online + descarga *todos* sus
   datos + los carga en un MongoDB local.
3. **Servir** — levanta el backend en `OFFLINE_MODE` + MongoDB local + anuncia
   `gymscore.local:4000` por mDNS, y muestra un QR para que los jueces entren.
4. **Sincronizar** — sube todo lo hecho en la jornada a la nube. "Finalizar" libera el candado.

Los jueces/pantallas solo abren `http://gymscore.local:4000` en un navegador — cero instalación.

## Arquitectura

- **Electron main** (`src/main/`):
  - `localStack.ts` — `mongodb-memory-server` (persistente, `userData/offline-data`) +
    `fork()` del backend con `OFFLINE_MODE=true`, `FRONTEND_BUILD_PATH`, secreto local;
    mDNS con `bonjour-service`; `powerSaveBlocker`.
  - `cloud.ts` — cliente HTTP de la nube + los flujos `prepareForOffline` / `syncToCloud`
    (que combinan endpoints de la nube y del backend local `/api/offline-local/*`).
  - `config.ts` — puertos, URLs, secreto por instalación.
- **Renderer** (`renderer/`) — HTML/CSS/JS plano, 4 pantallas.
- **resources/** (gitignored) — `prepare-resources.sh` compila y copia `gym_score_be` y
  `GymScore` acá antes de empaquetar.

## Desarrollo

```bash
npm install
npm run prepare-resources   # compila BE+FE de los repos hermanos → resources/
npm start                   # tsc + electron .
```

## Empaquetar (.dmg, sin firmar)

```bash
npm run dist
```

El primer arranque en cada máquina descarga el binario de `mongod`
(`mongodb-memory-server`) — necesita internet **una vez**. Hacerlo en casa antes del torneo.

Sin firma de código, macOS pide **clic derecho → Abrir** la primera vez. Ver la sección
"Firma de código" en `../GymScore/docs/MODO_SEDE.md`.

## Publicar una versión

El `.dmg` se distribuye como asset de un [GitHub Release](https://github.com/TinchoF/gym_score_desktop/releases)
público — el botón de descarga en la web app apunta siempre a `.../releases/latest/download/...`.
Ver **[RELEASING.md](RELEASING.md)** para los pasos.

## Estado

Fase 1 (MVP) funcionando: probado en runtime, `v0.1.0` publicado y descargable desde el panel de
super-admin de la web. Ver el checklist completo en `../GymScore/docs/MODO_SEDE.md`.
