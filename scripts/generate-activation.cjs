'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { stableStringify } = require('../electron/license.cjs');

function usage() {
  process.stderr.write(
    [
      'Usage:',
      '  node scripts/generate-activation.cjs --request <activation-request.json> --license <license.json> --privateKey <path> [--registry <activation-registry.json>] [--out <activation.json>]',
      '',
      'Notes:',
      '  - This is vendor-side. It enforces maxActivations using a local registry file.',
      '  - Re-issuing activation for the same fingerprint is idempotent and does not consume another seat.',
      '',
      'Example:',
      '  node scripts/generate-activation.cjs --request .\\activation-request.json --license .\\license.json --privateKey .\\keys\\license-private.pem --registry .\\activation-registry.json --out .\\activation.json',
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

function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`${label} not found or unreadable: ${filePath}`);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
}

function signPayload(payload, privateKeyPem) {
  const data = stableStringify(payload);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  return signer.sign(privateKeyPem).toString('base64');
}

function nowIso() {
  return new Date().toISOString();
}

(function main() {
  const args = parseArgs(process.argv);

  const requestPath = String(args.request || '');
  const licensePath = String(args.license || '');
  const privateKeyPath = String(args.privateKey || process.env.LICENSE_PRIVATE_KEY || '');
  const registryPath = String(args.registry || 'activation-registry.json');
  const outPath = String(args.out || 'activation.json');

  if (!requestPath || !licensePath || !privateKeyPath) {
    usage();
    process.exitCode = 2;
    return;
  }

  const absRequest = path.resolve(requestPath);
  const absLicense = path.resolve(licensePath);
  const absRegistry = path.resolve(registryPath);
  const absOut = path.resolve(outPath);

  const request = readJsonFile(absRequest, 'Activation request');
  const licenseDoc = readJsonFile(absLicense, 'License');

  const licensePayload = licenseDoc && licenseDoc.payload ? licenseDoc.payload : null;

  const licenseId = licensePayload && licensePayload.licenseId ? String(licensePayload.licenseId) : '';
  const maxActivations = licensePayload && licensePayload.maxActivations !== undefined ? Number(licensePayload.maxActivations) : NaN;
  const product = licensePayload && licensePayload.product ? String(licensePayload.product) : 'Redio';

  if (!licenseId) {
    process.stderr.write('License must be an activation-mode license (payload.licenseId is required).\n');
    process.exitCode = 2;
    return;
  }
  if (!Number.isInteger(maxActivations) || maxActivations < 1) {
    process.stderr.write('License payload.maxActivations must be an integer >= 1.\n');
    process.exitCode = 2;
    return;
  }

  const reqLicenseId = request && request.licenseId ? String(request.licenseId) : '';
  const reqFingerprint = request && request.fingerprint ? String(request.fingerprint) : '';

  if (!reqLicenseId || !reqFingerprint) {
    process.stderr.write('activation-request.json must contain licenseId and fingerprint.\n');
    process.exitCode = 2;
    return;
  }

  if (reqLicenseId !== licenseId) {
    process.stderr.write('activation-request.json licenseId does not match license.json licenseId.\n');
    process.exitCode = 2;
    return;
  }

  let registry = { licenses: {} };
  if (fs.existsSync(absRegistry)) {
    try {
      registry = readJsonFile(absRegistry, 'Activation registry');
    } catch (e) {
      process.stderr.write(`${e.message}\n`);
      process.exitCode = 2;
      return;
    }
  }

  if (!registry || typeof registry !== 'object') registry = { licenses: {} };
  if (!registry.licenses || typeof registry.licenses !== 'object') registry.licenses = {};

  if (!registry.licenses[licenseId] || typeof registry.licenses[licenseId] !== 'object') {
    registry.licenses[licenseId] = {
      maxActivations,
      activations: {},
      ownerFingerprint: '',
      updatedAt: nowIso(),
      product,
    };
  }

  const entry = registry.licenses[licenseId];
  entry.maxActivations = maxActivations;
  entry.product = product;
  if (!entry.activations || typeof entry.activations !== 'object') entry.activations = {};
  if (typeof entry.ownerFingerprint !== 'string') entry.ownerFingerprint = '';

  if (!entry.ownerFingerprint) {
    const existingFingerprints = Object.keys(entry.activations || {});
    if (existingFingerprints.length > 0) {
      entry.ownerFingerprint = existingFingerprints[0];
    }
  }

  if (!entry.ownerFingerprint) {
    entry.ownerFingerprint = reqFingerprint;
  } else if (entry.ownerFingerprint !== reqFingerprint) {
    process.stderr.write(
      `This license is locked to another PC (ownerFingerprint=${entry.ownerFingerprint}). Activation rejected for fingerprint=${reqFingerprint}.\n`
    );
    process.exitCode = 3;
    return;
  }

  const existing = entry.activations[reqFingerprint];
  const activationCount = Object.keys(entry.activations).length;

  if (!existing && activationCount >= maxActivations) {
    process.stderr.write(`Activation limit reached for licenseId=${licenseId} (maxActivations=${maxActivations}).\n`);
    process.exitCode = 3;
    return;
  }

  // Idempotent: if fingerprint already activated, re-issue activation without consuming another seat.
  entry.activations[reqFingerprint] = {
    fingerprint: reqFingerprint,
    firstIssuedAt: existing && existing.firstIssuedAt ? String(existing.firstIssuedAt) : nowIso(),
    lastIssuedAt: nowIso(),
    requestPath: absRequest,
  };
  entry.updatedAt = nowIso();

  fs.mkdirSync(path.dirname(absRegistry), { recursive: true });
  fs.writeFileSync(absRegistry, JSON.stringify(registry, null, 2), 'utf8');

  const privateKeyPem = fs.readFileSync(path.resolve(privateKeyPath), 'utf8');

  const activationPayload = {
    licenseId,
    fingerprint: reqFingerprint,
    issuedAt: nowIso(),
    product,
  };

  const signature = signPayload(activationPayload, privateKeyPem);
  const activation = { payload: activationPayload, signature };

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(activation, null, 2), 'utf8');

  const seatsUsed = Object.keys(entry.activations).length;
  process.stdout.write(`Wrote activation: ${absOut}\n`);
  process.stdout.write(`Registry updated: ${absRegistry}\n`);
  process.stdout.write(`Seats used for ${licenseId}: ${seatsUsed}/${maxActivations}\n`);
})();
