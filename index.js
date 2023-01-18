const path = require('node:path');
const { ModuleManager } = require('./modules.js');
const { Repl } = require('./repl.js');

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  const moduleManager = new ModuleManager(filenameFullPath);
  await Repl.start(moduleManager);
};

module.exports = { run };
