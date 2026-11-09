const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../apps-script/Crypto.gs'), 'utf8');
const sandbox = {
  module: { exports: {} },
  Utilities: { newBlob: (value) => ({ getBytes: () => Array.from(Buffer.from(String(value), 'utf8')) }) }
};
vm.runInNewContext(source, sandbox, { filename: 'Crypto.gs' });
const cryptoLayer = sandbox.module.exports;
const unsigned = (bytes) => Buffer.from(Array.from(bytes, (byte) => (Number(byte) + 256) % 256));
const hmac = (message, key) => Array.from(crypto.createHmac('sha256', unsigned(key)).update(unsigned(message)).digest());

test('PBKDF2-HMAC-SHA256 confere com o vetor do módulo crypto do Node', () => {
  const password = 'senha de teste 123';
  const saltHex = '00112233445566778899aabbccddeeff';
  const iterations = 1000;
  const expected = crypto.pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256').toString('hex');
  assert.equal(cryptoLayer.pbkdf2(password, saltHex, iterations, hmac), expected);
});

test('comparação constante aceita igualdade e rejeita tamanhos/valores diferentes', () => {
  assert.equal(cryptoLayer.constantTimeEqual('aabbcc', 'aabbcc'), true);
  assert.equal(cryptoLayer.constantTimeEqual('aabbcc', 'aabbcd'), false);
  assert.equal(cryptoLayer.constantTimeEqual('aabb', 'aabbcc'), false);
});

test('conversão hexadecimal mantém bytes altos sem corromper o digest', () => {
  const bytes = cryptoLayer.hexToBytes('80ff01');
  assert.equal(cryptoLayer.bytesToHex(bytes), '80ff01');
});
