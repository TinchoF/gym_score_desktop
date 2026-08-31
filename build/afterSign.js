// Ad-hoc code signing (gratis, sin cuenta de Apple Developer). Sin esto, un build
// arm64 sin firma NINGUNA no arranca en Apple Silicon: macOS lo reporta como
// "está dañado y no puede abrirse" en vez del habitual aviso de "desarrollador no
// identificado" (que sí deja abrir con clic derecho). El ad-hoc satisface el
// requisito mínimo de firma de arm64; sigue sin estar notarizado, así que el
// primer clic derecho → Abrir sigue haciendo falta. Ver RELEASING.md.
const { execSync } = require('child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' });
  console.log('[afterSign] ad-hoc signed:', appPath);
};
