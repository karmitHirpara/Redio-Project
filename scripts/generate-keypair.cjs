'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith('--')) {
      args[key] = val;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

(function main() {
  const args = parseArgs(process.argv);
  const outDir = path.resolve(String(args.outDir || 'keys'));
  const bits = Number(args.bits || 2048);

  fs.mkdirSync(outDir, { recursive: true });

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: bits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const pubPath = path.join(outDir, 'license-public.pem');
  const privPath = path.join(outDir, 'license-private.pem');

  fs.writeFileSync(pubPath, publicKey, 'utf8');
  fs.writeFileSync(privPath, privateKey, 'utf8');

  process.stdout.write(`Wrote public key: ${pubPath}\n`);
  process.stdout.write(`Wrote private key: ${privPath}\n`);
})();
