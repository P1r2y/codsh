import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceFiles = [];
async function visit(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await visit(relative);
    else if (/\.(?:mjs|cjs|css)$/.test(entry.name)) sourceFiles.push(relative);
  }
}
await visit('src');
const hash = createHash('sha256');
for (const relative of sourceFiles.sort()) {
  hash.update(relative + '\0');
  hash.update((await readFile(path.join(root, relative))).toString('utf8').replaceAll('\r\n', '\n'));
  hash.update('\0');
}
const sourceHash = hash.digest('hex');
await mkdir(path.join(root, 'dist'), { recursive: true });
for (const [entry, output] of [
  ['src/ui/index.mjs', 'usage-preload.cjs'],
  ['src/enhancement-preload.cjs', 'enhancement-preload.cjs']
]) {
  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome140',
    external: ['electron'],
    loader: { '.css': 'text' },
    legalComments: 'none',
    write: false,
    banner: { js: `// codsh-source-sha256:${sourceHash}` }
  });
  await writeFile(path.join(root, 'dist', output), result.outputFiles[0].contents);
}
console.log(`已构建前端与加载桥 ${sourceHash.slice(0, 12)}`);
