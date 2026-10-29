import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const output = mkdtempSync(join(tmpdir(), 'chatspin-emitted-'));
try {
  execFileSync(
    resolve('node_modules/.bin/tsc'),
    [
      'api/cloud.ts',
      '--outDir',
      output,
      '--target',
      'ES2023',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      '--esModuleInterop',
      '--strict',
      '--skipLibCheck',
      '--types',
      'node',
    ],
    { stdio: 'inherit' },
  );
  writeFileSync(join(output, 'package.json'), '{"type":"module"}');
  symlinkSync(resolve('node_modules'), join(output, 'node_modules'), 'dir');
  // Execute emitted JavaScript with plain Node, without tsx or source .ts files.
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `await import(${JSON.stringify(join(output, 'api/cloud.js'))}); console.log('Compiled cloud entry imports successfully without TypeScript sources.');`,
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
