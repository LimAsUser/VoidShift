const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const blender = process.env.BLENDER_BIN;

test('crew source renders an editable model and transparent overhead image', { skip: !blender }, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'voidshift-art-test-'));
  const script = path.resolve(__dirname, '../design/gameplay-art-v1/generate.py');
  const run = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', '--output', output, '--mode', 'crew'], {
    encoding: 'utf8', timeout: 120000
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  const source = path.join(output, 'crew.blend');
  const render = path.join(output, 'crew-overhead.png');
  assert.ok(existsSync(source), 'editable Blender source must be preserved');
  assert.ok(existsSync(render), 'overhead game render must exist');
  const png = readFileSync(render);
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  assert.equal(png[25], 6, 'render must have an alpha channel');
});

test('crew v1 rebuild renders both inspection and overhead views from one source', { skip: !blender }, () => {
  const output = mkdtempSync(path.join(tmpdir(), 'voidshift-art-v1-test-'));
  const script = path.resolve(__dirname, '../design/gameplay-art-v1/crew_v1.py');
  const run = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', '--output', output], {
    encoding: 'utf8', timeout: 180000
  });

  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.ok(existsSync(path.join(output, 'crew-v1.blend')), 'editable v1 model must exist');
  for (const name of ['crew-v1-top.png', 'crew-v1-threequarter.png']) {
    const png = readFileSync(path.join(output, name));
    assert.equal(png.toString('ascii', 1, 4), 'PNG');
    assert.equal(png.readUInt32BE(16), 1024);
    assert.equal(png.readUInt32BE(20), 1024);
    assert.equal(png[25], 6, `${name} must preserve alpha`);
  }
});

for (const kind of ['hunter', 'monster']) {
  test(`${kind} v1 exports editable source and two transparent views`, { skip: !blender }, () => {
    const output = mkdtempSync(path.join(tmpdir(), `voidshift-${kind}-art-test-`));
    const script = path.resolve(__dirname, '../design/gameplay-art-v1/enemy_v1.py');
    const run = spawnSync(blender, ['--background', '--factory-startup', '--python', script, '--', '--kind', kind, '--output', output], {
      encoding: 'utf8', timeout: 180000
    });

    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
    assert.ok(existsSync(path.join(output, `${kind}-v1.blend`)), 'editable model must exist');
    for (const view of ['top', 'threequarter']) {
      const png = readFileSync(path.join(output, `${kind}-v1-${view}.png`));
      assert.equal(png.toString('ascii', 1, 4), 'PNG');
      assert.equal(png.readUInt32BE(16), 1024);
      assert.equal(png.readUInt32BE(20), 1024);
      assert.equal(png[25], 6, 'render must have an alpha channel');
    }
  });
}
