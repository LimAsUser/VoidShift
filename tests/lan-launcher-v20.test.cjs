const assert = require('node:assert/strict');
const test = require('node:test');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const launcher = () => import('../scripts/start-lan.mjs');

test('LAN launcher requires a concrete active IPv4 interface and defaults to 8787', async () => {
  const { availableInterfaces, parseOptions, selectInterface } = await launcher();
  const candidates = availableInterfaces({
    Loopback: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    VPN: [{ family: 'IPv4', internal: false, address: '100.88.2.3' }, { family: 'IPv6', internal: false, address: '::2' }],
    Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.1.3' }],
    Disconnected: [{ family: 'IPv4', internal: false, address: '169.254.2.3' }],
  });
  assert.equal(candidates.length, 2);
  assert.equal(parseOptions([]).port, 8787);
  assert.deepEqual(selectInterface(parseOptions(['--interface', 'VPN']), candidates), { name: 'VPN', address: '100.88.2.3' });
  assert.throws(() => selectInterface(parseOptions(['--ip', '10.0.0.8']), candidates));
  assert.throws(() => parseOptions(['--port', '0']));
  assert.throws(() => parseOptions(['--ip', '192.168.1.3', '--interface', 'VPN']));
});

test('occupied LAN port fails without terminating the existing listener', async () => {
  const { assertPortAvailable } = await launcher();
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(assertPortAvailable('127.0.0.1', server.address().port), /occupied/);
    assert.equal(server.listening, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('migration and serving commands share the dedicated LAN persistence directory', async () => {
  const { localWranglerCommands } = await launcher();
  const projectRoot = path.dirname(__dirname);
  const location = path.join(projectRoot, '.wrangler', 'lan');
  const commands = localWranglerCommands({ location, configPath: path.join(location, 'config.json'),
    dbName: 'DB', ip: '192.168.1.5', port: 8787 });
  const expected = path.join(location, 'state');
  for (const args of [commands.migrations, commands.serve]) {
    assert.equal(args[args.indexOf('--persist-to') + 1], expected);
    assert.equal(args.filter(arg => arg === '--persist-to').length, 1);
    assert.ok(args.includes('--local'));
    assert.equal(args.includes('--remote'), false);
    assert.equal(args.includes(path.join(projectRoot, '.wrangler', 'state')), false);
  }
});

test('LAN actor and exactly five migrations are added only to generated local configuration', {
  skip: !fs.existsSync(path.join(__dirname, '../dist/server/wrangler.json')),
}, async () => {
  const { prepareConfig } = await launcher();
  const builtPath = path.join(__dirname, '../dist/server/wrangler.json');
  const original = fs.readFileSync(builtPath, 'utf8');
  const { configPath } = await prepareConfig();
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(config.durable_objects.bindings, [{ name: 'LAN_ROOM', class_name: 'LanRoom' }]);
  assert.deepEqual(config.migrations, [{ tag: 'v20-local-lan', new_sqlite_classes: ['LanRoom'] }]);
  const migrationDirectory = config.d1_databases.find(binding => binding.binding === 'DB').migrations_dir;
  assert.deepEqual(fs.readdirSync(migrationDirectory).filter(file => file.endsWith('.sql')).sort(), [
    '0000_damp_jack_murdock.sql', '0001_rainy_kylun.sql', '0002_four_player_coop.sql',
    '0003_reusable_guest_slots.sql', '0004_mission_rewards_and_create_intent.sql',
  ]);
  assert.equal(fs.readFileSync(builtPath, 'utf8'), original);
  assert.deepEqual(JSON.parse(original).durable_objects.bindings, []);
  assert.deepEqual(JSON.parse(original).migrations, []);
});
