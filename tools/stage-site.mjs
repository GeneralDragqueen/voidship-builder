import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

// This allowlist is the deployment artifact; tests serve these exact files.
const output = resolve('_site');
await rm(output, { recursive: true, force: true });
await mkdir(output);
for (const path of ['index.html', '.nojekyll', 'ledger', 'README.md', 'LICENSE']) {
  await cp(path, resolve(output, path), { recursive: true });
}
