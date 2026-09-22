import { access, cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'dist');
const publicEntries = ['index.html', 'styles.css', 'js', 'resources'];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const entry of publicEntries) {
  const source = path.join(root, entry);
  await access(source);
  await cp(source, path.join(output, entry), { recursive: true });
}

await access(path.join(output, 'index.html'));
console.log(`Prepared VOID SHIFT static site in ${output}`);
