const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'config/seed-data.json'), 'utf8'));
const output = `/* Gerado por npm run build a partir de config/seed-data.json. */\nvar CRM_CONFIG = ${JSON.stringify(seed, null, 2)};\n`;
fs.writeFileSync(path.join(root, 'apps-script/Config.gs'), output, 'utf8');
console.log('Config.gs atualizado com os dados-base atuais.');
