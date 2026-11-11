import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const portDefault = 8787;
const migrations = [
  "0000_damp_jack_murdock.sql", "0001_rainy_kylun.sql", "0002_four_player_coop.sql",
  "0003_reusable_guest_slots.sql", "0004_mission_rewards_and_create_intent.sql",
];

export function availableInterfaces(interfaces = networkInterfaces()) {
  return Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
    .filter(entry => entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."))
    .map(entry => ({ name, address: entry.address })));
}

export function parseOptions(args) {
  const options = { port: portDefault, ip: null, interface: null, list: false, open: true };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--no-open") options.open = false;
    else if (["--ip", "--interface", "--port"].includes(argument)) {
      const value = args[++index];
      if (!value) throw new Error(`${argument} requires a value.`);
      if (argument === "--port") options.port = Number(value);
      else options[argument.slice(2)] = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("Port must be 1–65535.");
  if (options.ip && options.interface) throw new Error("Choose --ip or --interface, not both.");
  return options;
}

export function selectInterface(options, candidates) {
  const matches = candidates.filter(entry => options.ip ? entry.address === options.ip : entry.name === options.interface);
  if (matches.length !== 1) throw new Error("Select one listed IPv4 address with --ip, or an interface with exactly one IPv4 address.");
  return matches[0];
}

export function assertPortAvailable(ip, port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", cause => reject(new Error(
      cause.code === "EADDRINUSE" ? `${ip}:${port} is occupied. Stop the existing server or use --port.` : cause.message)));
    server.listen(port, ip, () => server.close(resolve));
  });
}

async function newestSourceTime(location) {
  const metadata = await stat(location);
  if (!metadata.isDirectory()) return metadata.mtimeMs;
  let newest = metadata.mtimeMs;
  for (const entry of await readdir(location, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    newest = Math.max(newest, await newestSourceTime(path.join(location, entry.name)));
  }
  return newest;
}

async function buildOutdated() {
  const manifest = path.join(root, "dist/server/wrangler.json");
  const entry = path.join(root, "dist/server/index.js");
  if (!existsSync(manifest) || !existsSync(entry)) return true;
  const builtAt = (await stat(entry)).mtimeMs;
  for (const source of ["app", "db", "worker", "js", "resources", "build", "index.html", "menu.css", "styles.css", "vite.config.ts", "next.config.ts", "package.json", "pnpm-lock.yaml"]) {
    if (await newestSourceTime(path.join(root, source)) > builtAt) return true;
  }
  return false;
}

function runNode(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true, ...options });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Command failed (exit ${code}): ${args[0]}`)));
  });
}

export async function prepareConfig() {
  const builtPath = path.join(root, "dist/server/wrangler.json");
  const config = JSON.parse(await readFile(builtPath, "utf8"));
  const location = path.join(root, ".wrangler/lan");
  const migrationDirectory = path.join(location, "migrations");
  await mkdir(migrationDirectory, { recursive: true });
  if ((await readdir(migrationDirectory)).some(file => file.endsWith(".sql") && !migrations.includes(file))) {
    throw new Error("The isolated LAN migrations directory contains an unapproved SQL file; only 0000–0004 may run.");
  }
  const db = config.d1_databases?.find(binding => binding.binding === "DB");
  if (!db) throw new Error("The built Worker has no local DB binding.");
  db.migrations_dir = migrationDirectory;
  for (const file of migrations) await copyFile(path.join(root, "drizzle", file), path.join(migrationDirectory, file));
  config.main = path.resolve(path.dirname(builtPath), config.main);
  if (config.assets?.directory) config.assets.directory = path.resolve(path.dirname(builtPath), config.assets.directory);
  config.vars = { ...config.vars };
  delete config.vars.VOIDSHIFT_LAN_ENABLED;
  delete config.vars.VOIDSHIFT_LAN_HOST_KEY;
  // These actor bindings exist only in this generated local launch configuration.
  config.durable_objects = { bindings: [{ name: "LAN_ROOM", class_name: "LanRoom" }] };
  config.migrations = [{ tag: "v20-local-lan", new_sqlite_classes: ["LanRoom"] }];
  const configPath = path.join(location, "config.json");
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { configPath, location, dbName: db.binding };
}

export function localWranglerCommands({ configPath, location, dbName, ip, port }) {
  const localArgs = ["--local", "--config", configPath, "--persist-to", path.join(location, "state")];
  return {
    migrations: ["d1", "migrations", "apply", dbName, ...localArgs],
    serve: ["dev", ...localArgs, "--ip", ip, "--port", String(port), "--inspector-port", "0"],
  };
}

function openHost(url) {
  const command = process.platform === "win32" ? "rundll32" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => console.error("Browser could not open. Restart with a working default browser to receive the host credential."));
  child.unref();
}

async function waitUntilReady(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode != null) throw new Error("LAN Worker exited before it became ready.");
    try {
      const response = await fetch(`${url}/api/lan/info`, { signal: AbortSignal.timeout(1500) });
      const info = await response.json();
      if (response.ok && info.enabled && info.protocolVersion === 20 && info.transport === "LAN_WS_V20") return;
    } catch { /* Wrangler is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("LAN Worker did not become ready within 45 seconds.");
}

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  const candidates = availableInterfaces();
  if (!candidates.length) throw new Error("No active LAN/VPN IPv4 interface was found.");
  console.log("Available LAN/VPN IPv4 interfaces:");
  candidates.forEach((entry, index) => console.log(`  ${index + 1}. ${entry.name}: ${entry.address}`));
  if (options.list) return;
  let selected;
  if (options.ip || options.interface) selected = selectInterface(options, candidates);
  else {
    if (!process.stdin.isTTY) throw new Error("Pass --ip <listed IPv4 address> for a non-interactive launch.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const choice = Number(await prompt.question("Choose the interface number explicitly: "));
    prompt.close();
    selected = candidates[choice - 1];
    if (!selected || !Number.isInteger(choice)) throw new Error("Invalid interface selection.");
  }
  await assertPortAvailable(selected.address, options.port);
  const wrangler = path.join(root, "node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wrangler)) throw new Error("Dependencies are missing. Run pnpm install --frozen-lockfile before launching LAN.");
  if (await buildOutdated()) {
    console.log("Building the local Worker and current game assets…");
    await runNode([path.join(root, "scripts/sync-game.mjs")]);
    await runNode([path.join(root, "scripts/run-framework.mjs"), "build"]);
  }
  const { configPath, location, dbName } = await prepareConfig();
  const commands = localWranglerCommands({ configPath, location, dbName, ip: selected.address, port: options.port });
  const variables = path.join(location, ".dev.vars");
  const hostKey = randomBytes(32).toString("hex");
  await writeFile(variables, `VOIDSHIFT_LAN_ENABLED="1"\nVOIDSHIFT_LAN_HOST_KEY="${hostKey}"\n`, { mode: 0o600 });
  let child;
  const cleanup = async () => { await rm(variables, { force: true }); };
  try {
    console.log("Applying only local D1 migrations 0000–0004…");
    await runNode(["--import", pathToFileURL(path.join(root, "scripts/sites-env.mjs")).href, wrangler,
      ...commands.migrations],
      { env: { ...process.env, CI: "1", VOIDSHIFT_LAN_ENABLED: "1" } });
    const url = `http://${selected.address}:${options.port}`;
    child = spawn(process.execPath, ["--import", pathToFileURL(path.join(root, "scripts/sites-env.mjs")).href, wrangler,
      ...commands.serve],
      { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", cause => console.error(cause.message));
    const stop = () => { child.kill("SIGTERM"); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await waitUntilReady(url, child);
    console.log(`Guest URL: ${url}/game/index.html?mode=lan`);
    console.log("LAN is ready. Keep this console running; the host credential is private to the opened browser.");
    if (options.open) openHost(`${url}/game/index.html?mode=lan#lan-host=${hostKey}`);
    else console.log(`Host URL: ${url}/game/index.html?mode=lan#lan-host=${hostKey}`);
    await new Promise((resolve, reject) => {
      if (child.exitCode != null) resolve();
      else { child.once("exit", resolve); child.once("error", reject); }
    });
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  } finally {
    if (child && child.exitCode == null) child.kill("SIGTERM");
    await cleanup();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(cause => { console.error(`LAN startup failed: ${cause.message}`); process.exitCode = 1; });
}
