const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.join(__dirname, '..');

test('room API accepts the browser protocol and stores its matching room marker', async () => {
  let insert;
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          if (sql.startsWith('INSERT')) insert = args;
          return { async run() { return { meta: { changes: 1 } }; } };
        }
      };
    }
  };
  const context = vm.createContext({
    env: { DB: db }, Request, Response, crypto: globalThis.crypto,
    TextEncoder, Uint8Array, Date
  });
  for (const file of ['db/rooms.ts', 'app/api/rooms/route.ts']) {
    const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, file), 'utf8'))
      .replace(/^import .*\r?\n/gm, '')
      .replace(/\bexport /g, '');
    vm.runInContext(source, context, { filename: file });
  }
  const makeRequest = version => new Request('http://localhost/api/rooms', {
    method: 'POST', body: JSON.stringify({ protocolVersion: version })
  });
  const response = await vm.runInContext('POST', context)(makeRequest(20));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).protocolVersion, 20);
  assert.equal(insert[2], 'MULTI_PEER_V20');
  assert.equal(insert[3], 20);
  assert.equal((await vm.runInContext('POST', context)(makeRequest(19))).status, 400);
});
