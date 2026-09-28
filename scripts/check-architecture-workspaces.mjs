import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const apps = path.join(repo, 'apps');
const errors = [];
let checked = 0;

for (const entry of fs.readdirSync(apps, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const application = path.join(apps, entry.name);
  if (!fs.existsSync(path.join(application, 'Dockerfile'))) continue;
  checked++;
  const packageFile = path.join(application, 'package.json');
  const configFile = path.join(application, 'quality.config.json');
  if (!fs.existsSync(packageFile) || !fs.existsSync(configFile)) {
    errors.push(`${entry.name}: deployable backend requires package.json and quality.config.json`);
    continue;
  }
  const scripts = JSON.parse(fs.readFileSync(packageFile, 'utf8')).scripts ?? {};
  if (scripts['lint:architecture'] !== `wallpaperdb-check-architecture apps/${entry.name}`) {
    errors.push(`${entry.name}: deployable backend requires lint:architecture using the shared checker`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Architecture checks configured for ${checked} deployable backend applications.`);
}
