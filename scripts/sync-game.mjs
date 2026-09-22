import { access, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const destination = path.join(root, "public", "game");
const entries = ["index.html", "styles.css", "js", "resources"];

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of entries) {
  const source = path.join(root, entry);
  await access(source);
  await cp(source, path.join(destination, entry), { recursive: true });
}
