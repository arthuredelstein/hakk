#!/usr/bin/env node

const { run } = require('./index.js');
const minimist = require('minimist');

const flags = minimist(process.argv.slice(2));
const filename = flags._[0];

const main = () => {
  run(filename, flags);
};

if (require.main === module) {
  main();
}
