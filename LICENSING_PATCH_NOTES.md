# Licensing Patch Notes

## What was changed

Patched `electron/main.cjs` to skip license and activation checks in packaged builds:

- `ensureLicenseOrQuit()`: added early `return true;` after bypass checks
- `ensureActivationOrQuit()`: added early `return true;` after bypass checks

## Result

- Packaged desktop builds now start **without** requiring `license.json` or `activation.json`
- Development builds (`npm run dev:desktop`) continue to work as before
- Licensing can be re-enabled at any time (see below)

## How to re-enable licensing later

To restore normal license/activation enforcement:

1. Open `electron/main.cjs`
2. Find both functions:
   - `ensureLicenseOrQuit()` (around line 106)
   - `ensureActivationOrQuit()` (around line 239)
3. Remove the line:
   ```javascript
   // TEMPORARY: Skip licensing in packaged builds for distribution without license files
   return true;
   ```
4. Rebuild the desktop app:
   ```bash
   npm run build:desktop
   ```

## Files to share with client

After rebuilding, share these files from `release/`:

- `Redio Setup 1.0.0.exe` (installer)
- Optional: `Redio Setup 1.0.0.zip` (portable version)

The client can install/run without any license files.

## Important notes

- This patch only affects **packaged builds**
- Development builds were already bypassing licensing
- No other functionality is affected
- Keep your original `electron/main.cjs` backup if you want to quickly revert changes
