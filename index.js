const path = require('node:path');
const { ModuleManager } = require('./modules.js');
const { Repl } = require('./repl.js');
const pjson = require('./package.json');
const { openLocalfileInBrowser } = require('./html.js');

const run = async (filename, flags) => {
  if (flags['version']) {
    console.log("v" + pjson.version);
    return;
  }
  if (filename === undefined) {
    console.log('Please specify a valid filename: `hakk my-file.js`');
    process.exitCode = 1;
    return;
  }
  const filenameFullPath = path.resolve(filename);
  const isWeb = filenameFullPath.endsWith(".html") || filenameFullPath.endsWith(".htm");
  if (isWeb) {
    await openLocalfileInBrowser(filenameFullPath);
  }
  const moduleManager = await ModuleManager.create(filenameFullPath, isWeb);
  await Repl.start(moduleManager);
};

module.exports = { run };
