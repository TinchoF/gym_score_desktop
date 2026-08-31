#!/usr/bin/env bash
# Actualiza (git pull) y compila el backend y el frontend de GymScore, y los copia
# a resources/ para empaquetarlos dentro de la app Electron. Layout de repos hermanos:
#   REPOS/gym_score_be   REPOS/GymScore   REPOS/gym_score_desktop
#
#   SKIP_PULL=1 ./scripts/prepare-resources.sh   # no hacer git pull
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
BE="$HERE/../gym_score_be"
FE="$HERE/../GymScore"
RES="$HERE/resources"

pull() {
  local dir="$1" branch="$2"
  if [ "${SKIP_PULL:-0}" = "1" ]; then return; fi
  echo "==> git pull $dir ($branch)"
  ( cd "$dir" && git fetch --quiet origin "$branch" && git checkout --quiet "$branch" && git pull --quiet --ff-only origin "$branch" ) \
    || echo "    ⚠️  no se pudo actualizar $dir — sigo con lo que hay"
}

pull "$BE" main
pull "$FE" production

echo "==> Backend ($BE)"
( cd "$BE" && npm ci && npm run build )
rm -rf "$RES/backend"
mkdir -p "$RES/backend"
cp -R "$BE/dist" "$RES/backend/dist"
cp "$BE/package.json" "$BE/package-lock.json" "$RES/backend/"
( cd "$RES/backend" && npm ci --omit=dev )

echo "==> Frontend ($FE) — build de sede (sin REACT_APP_BASE_URL)"
( cd "$FE" && REACT_APP_BASE_URL="" CI=false npm run build )
rm -rf "$RES/frontend"
cp -R "$FE/build" "$RES/frontend"

echo "==> Listo. resources/ preparado ($(cd "$FE" && git rev-parse --short HEAD) FE / $(cd "$BE" && git rev-parse --short HEAD) BE)."
echo "    Nota: mongod lo baja mongodb-memory-server en el primer arranque (requiere internet una vez)."
