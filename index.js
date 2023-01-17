const fs = require('fs');
const path = require('node:path');
const hakkModules = require('./hakk_modules.js');
const { prepareAST, generate, changedNodesToCodeFragments } = require('./transform.js');
const { createReplServer, modulePathManager, updatePrompt } = require('./repl.js');
// ## Utility functions

const readFile = (path) => fs.readFileSync(path, { encoding: 'utf8' });

const watchForFileChanges = (path, interval, callback) => {
  const readAndCallback = (init) => {
    callback(readFile(path), init);
  };
  readAndCallback(true);
  fs.watchFile(
    path, { interval, persistent: false },
    (current, previous) => {
      if (current.mtime !== previous.mtime) {
        readAndCallback(false);
      }
    });
};

// ## REPL setup

// TODO: Get source mapping with something like:
// generate(ast, {sourceMaps: true, sourceFileName: "test"})
// (The `generate` API requires `sourceFileName` to be included for source maps
// to be generated.)
// Q: Can we use https://www.npmjs.com/package/babel-plugin-source-map-support
// and https://www.npmjs.com/package/source-map-support ?
// How do these work? See also https://v8.dev/docs/stack-trace-api


const evaluateChangedCodeFragments = async (ast, path) => {
  const codeFragments = changedNodesToCodeFragments(ast.program.body, path);
  for (const codeFragment of codeFragments) {
    await hakkModules.evalCodeInModule(codeFragment, path);
  }
};

const evaluateChangedCodeFragmentsSync = (ast, path) => {
  const codeFragments = changedNodesToCodeFragments(ast.program.body, path);
  for (const codeFragment of codeFragments) {
    hakkModules.evalCodeInModule(codeFragment, path);
  }
};

const updateRepl = (init, replServer, filenameFullPath) => {
  // Trigger preview update in case the file has updated a function
  // that will produce a new result for the pending REPL input.
  if (replServer) {
    replServer._ttyWrite(null, {});
  }
  if (!init) {
    modulePathManager.jump(filenameFullPath);
    updatePrompt(replServer);
  }
};

const respond = async (code, init, filenameFullPath, replServer) => {
  try {
    await evaluateChangedCodeFragments(prepareAST(code), filenameFullPath);
    updateRepl(init, replServer, filenameFullPath);
  } catch (e) {
    console.log(e);
  }
};

const respondSync = (code, init, filenameFullPath, replServer) => {
  try {
    evaluateChangedCodeFragmentsSync(prepareAST(code), filenameFullPath);
    updateRepl(init, replServer, filenameFullPath);
  } catch (e) {
    console.log(e);
  }
};

const attachToModule = (filenameFullPath, isAsync, replServer) => {
  watchForFileChanges(
    filenameFullPath, 100,
    isAsync ? (code, init) => respond(code, init, filenameFullPath, replServer)
      : (code, init) => respondSync(code, init, filenameFullPath, replServer));
};

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  const replServer = await createReplServer(filenameFullPath);
  hakkModules.addModuleCreationListener((path, isAsync) => attachToModule(path, isAsync, replServer));
  hakkModules.getModule(filenameFullPath);
};

module.exports = { run };
