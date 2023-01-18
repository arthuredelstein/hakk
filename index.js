const path = require('node:path');
const hakkModules = require('./hakk_modules.js');
const { createReplServer } = require('./repl.js');

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  await createReplServer(filenameFullPath);
  hakkModules.getModule(filenameFullPath);
};

module.exports = { run };
