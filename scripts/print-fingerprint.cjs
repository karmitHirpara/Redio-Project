'use strict';

const { getDeviceFingerprint, getDeviceFingerprintV2 } = require('../electron/license.cjs');

(async () => {
  try {
    const [fp1, fp2] = await Promise.all([getDeviceFingerprint(), getDeviceFingerprintV2()]);
    process.stdout.write(`CLIENT_FP=${fp1}\nCLIENT_FP2=${fp2}\n`);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  }
})();
