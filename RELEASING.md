# Publicar una versión nueva

El botón de descarga en la web (`SuperAdminPanel` → `DesktopAppDownload.tsx`) apunta siempre a:

```
https://github.com/TinchoF/gym_score_desktop/releases/latest/download/GymScore-Modo-Sede.dmg
```

Esa URL nunca cambia porque `electron-builder.yml` fija el nombre del asset
(`artifactName: "GymScore-Modo-Sede.dmg"`, sin versión). Publicar una versión nueva
es: generar el `.dmg` y subirlo a un Release nuevo — **no hay que tocar la web**.

## Requisitos

- Estar en una Mac (el `.dmg` se arma nativo, no cross-compila).
- `gh` autenticado (`gh auth status`) con acceso de push a `TinchoF/gym_score_desktop`.
- Los repos hermanos en `~/REPOS/gym_score_be` y `~/REPOS/GymScore` (`prepare-resources.sh`
  los actualiza solo — no hace falta pull manual).

## Pasos

```bash
cd ~/REPOS/gym_score_desktop

# 1. (opcional) bump de versión — solo para llevar registro, el asset no la usa
#    editar "version" en package.json, ej. 0.1.0 -> 0.2.0

# 2. armar el .dmg (git pull de BE+FE, build de los tres, empaquetar)
npm run dist

# 3. publicar el release (el nombre del asset queda fijo, gh lo toma del build)
gh release create v0.2.0 "release/GymScore-Modo-Sede.dmg" \
  --title "GymScore Modo Sede v0.2.0" \
  --notes "Qué cambió en esta versión…"

# 4. commitear el bump de versión (si lo hiciste) y el tag
git add package.json
git commit -m "chore: v0.2.0"
git push origin main --follow-tags
```

`npm run dist` = `prepare-resources` (pull + build de BE y FE) → `build:ts` → `electron-builder --mac`.
El `.dmg` queda en `release/GymScore-Modo-Sede.dmg`. Tarda unos minutos; la primera vez
`electron-builder` baja el runtime de Electron y algunas herramientas de empaquetado (~internet).

## Verificar que quedó bien

```bash
# el release no debe quedar en draft, y el asset tiene que estar
gh release view v0.2.0 --json isDraft,assets -q '.isDraft, (.assets[].name)'

# el link público tiene que resolver sin login (200, sin redirect a login)
curl -sIL https://github.com/TinchoF/gym_score_desktop/releases/latest/download/GymScore-Modo-Sede.dmg | tail -5
```

`releases/latest` es el release **no-prerelease** más reciente por fecha. Si publicás algo que no
querés que reemplace el botón de descarga (una beta, por ejemplo), marcalo como pre-release:
`gh release create ... --prerelease`.

## Si algo salió mal

- **Quedó como draft** (`gh release create` cortado, ej. por la subida grande): `gh release edit v0.2.0 --draft=false`.
- **Subiste el asset con otro nombre**: `gh release delete-asset v0.2.0 <nombre>` y volvé a subir con
  `gh release upload v0.2.0 release/GymScore-Modo-Sede.dmg` (el nombre del archivo local ya es el correcto).
- **Borrar un release entero**: `gh release delete v0.2.0 --cleanup-tag` (borra el tag también).

## Firma de código

Sigue sin firmar (`identity: null` en `electron-builder.yml`) — ver la sección "Firma de código" en
`../GymScore/docs/MODO_SEDE.md`. Mientras tanto, cada instalación nueva necesita clic derecho → Abrir
la primera vez.

## Solo Apple Silicon (por ahora)

El build actual es `arm64` únicamente. Para dar soporte a Macs Intel hace falta un build universal
(`mac.target` con `arch: universal` en `electron-builder.yml`), que además de tardar más necesita
bajar el runtime de Electron para ambas arquitecturas.
