const path = require('node:path');
const { ModuleManager } = require('./modules.js');
const { Repl } = require('./repl.js');

const run = async (filename) => {
  if (filename === undefined) {
    console.log("Please specify a valid filename: `hakk my-file.js`");
    process.exitCode = 1;
    return;
  }
  const filenameFullPath = path.resolve(filename);
  const moduleManager = await ModuleManager.create(filenameFullPath);
  await Repl.start(moduleManager);
};

module.exports = { run };
