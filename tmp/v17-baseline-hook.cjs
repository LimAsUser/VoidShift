// Read-only comparison: run selected existing tests against the captured pre-V17 sources.
const fs = require('node:fs'), path = require('node:path');
const read = fs.readFileSync;
const root = path.resolve(__dirname, '..');
fs.readFileSync = function(file, ...args) {
  if (typeof file === 'string' && path.dirname(path.resolve(file)) === path.join(root, 'js')) {
    const old = path.join(__dirname, 'v17-baseline', path.basename(file));
    if (fs.existsSync(old)) return read.call(this, old, ...args);
  }
  return read.call(this, file, ...args);
};
