const path = require('node:path');
const modules = require('./modules.js');
const { createReplServer } = require('./repl.js');

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  await createReplServer(filenameFullPath);
  modules.getModule(filenameFullPath);
};

module.exports = { run };
