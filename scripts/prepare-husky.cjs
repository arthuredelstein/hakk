'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

if (!fs.existsSync(path.join(root, '.git'))) {
  process.exit(0);
}

const huskyBin =
  process.platform === 'win32'
    ? path.join(root, 'node_modules', '.bin', 'husky.cmd')
    : path.join(root, 'node_modules', '.bin', 'husky');

if (!fs.existsSync(huskyBin)) {
  process.exit(0);
}

const result = spawnSync(huskyBin, [], {
  stdio: 'inherit',
  cwd: root,
  shell: false
});

process.exit(result.status === 0 ? 0 : (result.status ?? 1));
