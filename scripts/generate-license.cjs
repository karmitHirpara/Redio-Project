'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableStringify } = require('../electron/license.cjs');

function usage() {
  process.stderr.write(
    [
      'Usage:',
      '  node scripts/generate-license.cjs --privateKey <path> [--fingerprint <fp>] [--licenseId <id> --maxActivations <n>] [--out <license.json>] [--product <name>]',
      '',
      'Example:',
      '  node scripts/generate-license.cjs --fingerprint abc... --privateKey .\\keys\\license-private.pem --out .\\license.json',
      '  node scripts/generate-license.cjs --licenseId REDIO-123 --maxActivations 3 --privateKey .\\keys\\license-private.pem --out .\\license.json',
      '',
    ].join('\n')
  );
}

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

function signPayload(payload, privateKeyPem) {
  const data = stableStringify(payload);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

(function main() {
  const args = parseArgs(process.argv);

  const fingerprint = String(args.fingerprint || '');
  const licenseId = String(args.licenseId || '');
  const maxActivationsRaw = args.maxActivations === undefined ? '' : String(args.maxActivations);
  const product = String(args.product || 'Redio');
  const privateKeyPath = String(args.privateKey || process.env.LICENSE_PRIVATE_KEY || '');
  const outPath = String(args.out || 'license.json');

  const hasLegacyFingerprint = Boolean(fingerprint);
  const hasActivationMode = Boolean(licenseId);
  const maxActivations = maxActivationsRaw ? Number(maxActivationsRaw) : 3;

  if (!privateKeyPath || (!hasLegacyFingerprint && !hasActivationMode)) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (hasActivationMode) {
    if (!Number.isFinite(maxActivations)) {
      process.stderr.write('maxActivations must be a number\n');
      process.exitCode = 2;
      return;
    }
    if (!Number.isInteger(maxActivations) || maxActivations < 1) {
      process.stderr.write('maxActivations must be an integer >= 1\n');
      process.exitCode = 2;
      return;
    }
  }

  const privateKeyPem = fs.readFileSync(privateKeyPath, 'utf8');

  const payload = hasActivationMode
    ? {
        licenseId,
        maxActivations,
        product,
      }
    : {
        fingerprint,
        product,
      };

  const signature = signPayload(payload, privateKeyPem);
  const license = { payload, signature };

  const absOut = path.resolve(outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(license, null, 2), 'utf8');

  process.stdout.write(`Wrote license: ${absOut}\n`);
})();
