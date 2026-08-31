#!/usr/bin/env bash
# Compila el backend y el frontend de GymScore y los copia a resources/ para
# empaquetarlos dentro de la app Electron. Asume el layout de repos hermanos:
#   REPOS/gym_score_be   REPOS/GymScore   REPOS/gym_score_desktop
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BE="$HERE/../gym_score_be"
FE="$HERE/../GymScore"
RES="$HERE/resources"

echo "==> Backend ($BE)"
( cd "$BE" && npm ci && npm run build )
rm -rf "$RES/backend"
mkdir -p "$RES/backend"
cp -R "$BE/dist" "$RES/backend/dist"
cp "$BE/package.json" "$BE/package-lock.json" "$RES/backend/"
( cd "$RES/backend" && npm ci --omit=dev )

echo "==> Frontend ($FE) — build de sede (sin REACT_APP_BASE_URL)"
( cd "$FE" && REACT_APP_BASE_URL="" npm run build )
rm -rf "$RES/frontend"
cp -R "$FE/build" "$RES/frontend"

echo "==> Listo. resources/ preparado."
echo "    Nota: mongod lo baja mongodb-memory-server en el primer arranque (requiere internet una vez)."
