import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = fileURLToPath(new URL('.', import.meta.url));
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('需要 Node.js 24 或更高版本');
const runtime = ['src', 'web'];
const entries = runtime.flatMap((directory) =>
  readdirSync(join(here, directory), { recursive: true })
    .filter((path) => path.endsWith('.mjs'))
    .map((path) => join(directory, path)),
);
for (const relative of ['build.mjs', ...entries]) {
  execFileSync(process.execPath, ['--check', join(here, relative)], { stdio: 'inherit' });
}
const destination = join(here, 'dist');
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination);
for (const directory of runtime) {
  cpSync(join(here, directory), join(destination, directory), { recursive: true });
}
console.log(`已检查 ${entries.length} 个运行模块，产物为 dist/src/server.mjs`);
