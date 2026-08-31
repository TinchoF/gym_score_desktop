// electron-builder's `extraResources` copy silently drops `node_modules` (parece
// tratarlo como si fuera el árbol de dependencias de la propia app, aunque acá es
// un proyecto Node totalmente aparte). Sin esto, el backend forkeado no encuentra
// express/mongoose/etc. -> nunca levanta -> "no llega a su base de datos".
// afterPack corre después del empaquetado (antes de firmar/armar el .dmg) y copia
// el node_modules a mano, con fs plano, sin ningún filtro de electron-builder de por medio.
const fs = require('fs');
const path = require('path');

function copyNodeModules(label, resourcesDir) {
  const src = path.join(__dirname, '..', 'resources', label, 'node_modules');
  const dest = path.join(resourcesDir, label, 'node_modules');
  if (!fs.existsSync(src)) {
    console.warn(`[afterPack] no existe ${src} — ¿corriste prepare-resources?`);
    return;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log(`[afterPack] copiado ${label}/node_modules -> ${dest}`);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appName = context.packager.appInfo.productFilename;
  const resourcesDir = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources');
  copyNodeModules('backend', resourcesDir);
};
