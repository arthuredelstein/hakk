const path = require('node:path');
const { ModuleManager } = require('./modules.js');
const { Repl } = require('./repl.js');

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  const moduleManager = await ModuleManager.create(filenameFullPath);
  console.log('Use shift+up and shift+down to switch between modules.');
  await Repl.start(moduleManager);
};

module.exports = { run };
