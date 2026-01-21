'use strict';

const crypto = require('crypto');
const si = require('systeminformation');

const DEFAULT_LICENSE_FILENAME = 'license.json';
const DEFAULT_ACTIVATION_FILENAME = 'activation.json';

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function getHardwareIdentity() {
  const [system, baseboard, bios, osInfo, cpu] = await Promise.all([
    si.system().catch(() => ({})),
    si.baseboard().catch(() => ({})),
    si.bios().catch(() => ({})),
    si.osInfo().catch(() => ({})),
    si.cpu().catch(() => ({})),
  ]);

  return {
    manufacturer: system.manufacturer || '',
    model: system.model || '',
    uuid: system.uuid || '',
    serial: system.serial || '',
    baseboardSerial: baseboard.serial || '',
    biosSerial: bios.serial || '',
    osUuid: osInfo.uuid || '',
    cpuBrand: cpu.brand || '',
  };
}

async function getDeviceFingerprint() {
  const id = await getHardwareIdentity();
  const payload = stableStringify(id);
  return sha256Hex(payload);
}

async function getDeviceFingerprintV2() {
  const id = await getHardwareIdentity();
  const payload = stableStringify({
    ...id,
    osUuid: '',
  });
  return sha256Hex(payload);
}

function canonicalizeLicensePayload(payload) {
  if (payload === null || payload === undefined) {
    throw new Error('License file missing payload');
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('License payload must be an object');
  }

  const allowed = {};
  if ('fingerprint' in payload) allowed.fingerprint = String(payload.fingerprint || '');
  if ('licenseId' in payload) allowed.licenseId = String(payload.licenseId || '');
  if ('maxActivations' in payload) allowed.maxActivations = Number(payload.maxActivations);
  if ('expiresAt' in payload) allowed.expiresAt = String(payload.expiresAt || '');
  if ('product' in payload) allowed.product = String(payload.product || '');

  if (!allowed.fingerprint && !allowed.licenseId) {
    throw new Error('License missing fingerprint or licenseId');
  }
  if (allowed.licenseId) {
    if (!Number.isFinite(allowed.maxActivations)) throw new Error('License missing maxActivations');
    if (!Number.isInteger(allowed.maxActivations) || allowed.maxActivations < 1) {
      throw new Error('License maxActivations must be an integer >= 1');
    }
  }

  return allowed;
}

function canonicalizeActivationPayload(payload) {
  if (payload === null || payload === undefined) {
    throw new Error('Activation file missing payload');
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Activation payload must be an object');
  }

  const allowed = {
    licenseId: String(payload.licenseId || ''),
    fingerprint: String(payload.fingerprint || ''),
    issuedAt: String(payload.issuedAt || ''),
    ...(Object.prototype.hasOwnProperty.call(payload, 'product') ? { product: String(payload.product || '') } : {}),
  };

  if (!allowed.licenseId) throw new Error('Activation missing licenseId');
  if (!allowed.fingerprint) throw new Error('Activation missing fingerprint');
  if (!allowed.issuedAt) throw new Error('Activation missing issuedAt');
  const t = Date.parse(allowed.issuedAt);
  if (!Number.isFinite(t)) throw new Error('Activation issuedAt must be a valid ISO date-time string');

  return allowed;
}

function verifyLicenseSignature({ payload, signature, publicKeyPem }) {
  const data = stableStringify(payload);
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(data);
  verifier.end();
  try {
    return verifier.verify(publicKeyPem, Buffer.from(String(signature || ''), 'base64'));
  } catch (e) {
    throw new Error('License verification key is invalid or corrupted');
  }
}

function parseExpiry(expiresAt) {
  const t = Date.parse(expiresAt);
  if (!Number.isFinite(t)) throw new Error('Invalid expiresAt timestamp');
  return t;
}

function getDefaultLicensePath({ app }) {
  const path = require('path');
  return path.join(app.getPath('userData'), DEFAULT_LICENSE_FILENAME);
}

function getDefaultActivationPath({ app }) {
  const path = require('path');
  return path.join(app.getPath('userData'), DEFAULT_ACTIVATION_FILENAME);
}

async function validateLicenseOrThrow({ app, fs, path, publicKeyPem, licensePath }) {
  const resolvedPath = licensePath || getDefaultLicensePath({ app });

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`License file not found: ${resolvedPath}`);
  }

  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (e) {
    throw new Error(`Failed to read license file: ${resolvedPath}`);
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error(`License file is not valid JSON: ${resolvedPath}`);
  }

  let payload;
  try {
    payload = canonicalizeLicensePayload(doc.payload);
  } catch (e) {
    throw new Error(`${e.message}: ${resolvedPath}`);
  }
  const signature = doc.signature;

  if (!publicKeyPem || typeof publicKeyPem !== 'string') {
    throw new Error('Missing public key for license verification');
  }

  const ok = verifyLicenseSignature({ payload, signature, publicKeyPem });
  if (!ok) {
    throw new Error('License signature invalid');
  }

  const [fp1, fp2] = await Promise.all([getDeviceFingerprint(), getDeviceFingerprintV2()]);
  const fp = fp1;
  if (payload.fingerprint && fp1 !== payload.fingerprint && fp2 !== payload.fingerprint) {
    throw new Error('License is not valid for this device');
  }

  const expiresAtMs = Number.POSITIVE_INFINITY;

  return {
    licensePath: resolvedPath,
    payload,
    fingerprint: fp,
    fingerprintV2: fp2,
    expiresAtMs,
  };
}

async function validateActivationOrThrow({ app, fs, path, publicKeyPem, activationPath, licenseId, fingerprints }) {
  const resolvedPath = activationPath || getDefaultActivationPath({ app });

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Activation file not found: ${resolvedPath}`);
  }

  let raw;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch {
    throw new Error(`Failed to read activation file: ${resolvedPath}`);
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    throw new Error(`Activation file is not valid JSON: ${resolvedPath}`);
  }

  let payload;
  try {
    payload = canonicalizeActivationPayload(doc.payload);
  } catch (e) {
    throw new Error(`${e.message}: ${resolvedPath}`);
  }
  const signature = doc.signature;

  if (!publicKeyPem || typeof publicKeyPem !== 'string') {
    throw new Error('Missing public key for activation verification');
  }

  const ok = verifyLicenseSignature({ payload, signature, publicKeyPem });
  if (!ok) {
    throw new Error('Activation signature invalid');
  }

  if (licenseId && payload.licenseId !== licenseId) {
    throw new Error('Activation is for a different license');
  }

  const fp1 = fingerprints && fingerprints.fp1 ? String(fingerprints.fp1) : '';
  const fp2 = fingerprints && fingerprints.fp2 ? String(fingerprints.fp2) : '';
  if (payload.fingerprint !== fp1 && payload.fingerprint !== fp2) {
    throw new Error('Activation is not valid for this device');
  }

  return {
    activationPath: resolvedPath,
    payload,
  };
}

module.exports = {
  DEFAULT_LICENSE_FILENAME,
  DEFAULT_ACTIVATION_FILENAME,
  getDeviceFingerprint,
  getDeviceFingerprintV2,
  getDefaultLicensePath,
  getDefaultActivationPath,
  validateLicenseOrThrow,
  validateActivationOrThrow,
  stableStringify,
};
