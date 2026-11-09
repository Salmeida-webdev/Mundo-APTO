var CrmCrypto = (function () {
  'use strict';
  var DEFAULT_ITERATIONS = 60000;

  function hexToBytes(hex) {
    var clean = String(hex || '').replace(/\s+/g, '').toLowerCase();
    if (!clean || clean.length % 2 || !/^[0-9a-f]+$/.test(clean)) throw new Error('Hexadecimal inválido.');
    var bytes = [];
    for (var i = 0; i < clean.length; i += 2) {
      var byte = parseInt(clean.slice(i, i + 2), 16);
      bytes.push(byte > 127 ? byte - 256 : byte);
    }
    return bytes;
  }

  function bytesToHex(bytes) {
    return (bytes || []).map(function (value) { return ('0' + ((Number(value) + 256) % 256).toString(16)).slice(-2); }).join('');
  }

  function concatBytes(a, b) { return Array.prototype.slice.call(a || []).concat(Array.prototype.slice.call(b || [])); }

  function pbkdf2(password, saltHex, iterations, hmacFn) {
    var count = Math.max(1, Number(iterations) || DEFAULT_ITERATIONS);
    var passwordBytes = Utilities.newBlob(String(password)).getBytes();
    var salt = hexToBytes(saltHex);
    var firstBlock = concatBytes(salt, [0, 0, 0, 1]);
    var u = hmacFn(firstBlock, passwordBytes);
    var output = Array.prototype.slice.call(u);
    for (var round = 1; round < count; round += 1) {
      u = hmacFn(u, passwordBytes);
      for (var j = 0; j < output.length; j += 1) output[j] = output[j] ^ u[j];
    }
    return bytesToHex(output);
  }

  function constantTimeEqual(left, right) {
    left = String(left || '');
    right = String(right || '');
    var diff = left.length ^ right.length;
    var length = Math.max(left.length, right.length);
    for (var i = 0; i < length; i += 1) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
    return diff === 0;
  }

  function sha256Hex(value, digestFn) {
    return bytesToHex(digestFn(Utilities.newBlob(String(value)).getBytes()));
  }

  return {
    DEFAULT_ITERATIONS: DEFAULT_ITERATIONS,
    hexToBytes: hexToBytes,
    bytesToHex: bytesToHex,
    pbkdf2: pbkdf2,
    constantTimeEqual: constantTimeEqual,
    sha256Hex: sha256Hex
  };
}());

if (typeof module !== 'undefined' && module.exports) module.exports = CrmCrypto;
