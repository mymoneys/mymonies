// Generates QVAC's mobile worker bundle and links its native addons, the same
// step `npx expo prebuild` runs through @qvac/sdk/expo-plugin.
//
// Why: the bundle is written inside node_modules
// (@qvac/sdk/dist/worker.mobile.bundle.js), so every `npm install` / `npm ci`
// deletes it. Building without it compiles fine, but on the phone the AI
// fails with "Failed to load mobile worker bundle ... Cannot find module".
// Running this from postinstall means a fresh clone builds a working app
// without a full prebuild (which would overwrite the manifest and icons).
//
// Imported by file path: the SDK's package exports don't expose this module.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const pluginPath = path.join(projectRoot, 'node_modules/@qvac/sdk/dist/src/expo/plugins/withMobileBundle.js');
if (!existsSync(pluginPath)) {
  console.error(`QVAC SDK not found at ${pluginPath}. Run npm install first.`);
  process.exit(1);
}

const { buildMobileBundle } = await import(pathToFileURL(pluginPath).href);
// Same options as the "@qvac/sdk/expo-plugin" entry in app.json.
await buildMobileBundle({ modRequest: { projectRoot, platform: 'android' } }, { installMissingPrebuilds: true });
