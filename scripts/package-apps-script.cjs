const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'apps-script');
const releaseDir = path.join(root, 'release');
const serverFiles = ['Config.gs', 'Domain.gs', 'Crypto.gs', 'Repository.gs', 'Code.gs'];
const serverCode = serverFiles.map((file) => fs.readFileSync(path.join(sourceDir, file), 'utf8').trim()).join('\n\n');
let html = fs.readFileSync(path.join(sourceDir, 'Index.html'), 'utf8');
const styles = fs.readFileSync(path.join(sourceDir, 'Styles.html'), 'utf8').trim();
const client = fs.readFileSync(path.join(sourceDir, 'Client.html'), 'utf8').trim();
const logo = fs.readFileSync(path.join(sourceDir, 'assets', 'mundo-apto-logo.jpg')).toString('base64');
html = html.replace("<?!= include_('Styles'); ?>", styles).replace("<?!= include_('Client'); ?>", client);
html = html.replaceAll('__MUNDO_APTO_LOGO_DATA_URI__', 'data:image/jpeg;base64,' + logo);
if (html.includes("include_('Styles')") || html.includes("include_('Client')")) throw new Error('Não foi possível embutir os arquivos HTML.');
if (html.includes('__MUNDO_APTO_LOGO_DATA_URI__')) throw new Error('Não foi possível embutir a logo do Mundo Apto.');
const baseManifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'appsscript.json'), 'utf8'));

for (const [environment, access] of [['staging', 'MYSELF'], ['production', 'ANYONE']]) {
  const destination = path.join(releaseDir, environment);
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'Code.gs'), serverCode + '\n', 'utf8');
  fs.writeFileSync(path.join(destination, 'Index.html'), html, 'utf8');
  const manifest = structuredClone(baseManifest);
  manifest.webapp.access = access;
  fs.writeFileSync(path.join(destination, 'appsscript.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
console.log('Pacotes Apps Script gerados: release/staging e release/production.');
