const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const styles = read('apps-script/Styles.html').replace(/^\s*<style>/, '').replace(/<\/style>\s*$/, '');
const client = read('apps-script/Client.html');
const logo = fs.readFileSync(path.join(root, 'apps-script/assets/mundo-apto-logo.jpg')).toString('base64');
const systemName = 'CRM Comercial — Mundo Apto';

let html = read('apps-script/Index.html');
html = html
  .replace(/\s*<base target="_top">/, '')
  .replace('<?!= include_(\'Styles\'); ?>', `<style>${styles}</style>`)
  .replace('<?!= include_(\'Client\'); ?>', client)
  .replace('<?= systemName ?>', systemName)
  .replaceAll('__MUNDO_APTO_LOGO_DATA_URI__', `data:image/jpeg;base64,${logo}`)
  .replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="theme-color" content="#EE7A00"><meta name="description" content="CRM comercial da equipe Mundo Apto"><title>${systemName}</title>`);

if (html.includes('<?') || html.includes('__MUNDO_APTO_LOGO_DATA_URI__')) {
  throw new Error('O HTML ainda contém marcações não resolvidas.');
}
const outputDir = path.join(root, 'public');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'index.html'), html);
console.log('Aplicativo estático gerado em public/index.html.');
