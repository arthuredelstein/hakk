const fs = require('fs');
const path = require('node:path');
const hakkModules = require('./hakk_modules.js');
const { prepareAST, generate } = require('./transform.js');
const { createReplServer, modulePathManager, updatePrompt } = require('./repl.js');
// ## Utility functions

const watchForFileChanges = (path, interval, callback) => {
  const readAndCallback = async (init) => {
    const contents = fs.readFileSync(path, { encoding: 'utf8' });
    callback(contents, init);
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

const previousNodesByFile = new Map();

// TODO: Get source mapping with something like:
// generate(ast, {sourceMaps: true, sourceFileName: "test"})
// (The `generate` API requires `sourceFileName` to be included for source maps
// to be generated.)
// Q: Can we use https://www.npmjs.com/package/babel-plugin-source-map-support
// and https://www.npmjs.com/package/source-map-support ?
// How do these work? See also https://v8.dev/docs/stack-trace-api

const changedNodesToCodeFragments = (nodes, path) => {
  const toWrite = [];
  const toRemove = [];
  const previousNodes = previousNodesByFile.get(path) ?? new Map();
  const currentNodes = new Map();
  const updatedParentFragments = new Set();
  for (const node of nodes) {
    const fragment = generate(node, { comments: false }, '').code.trim();
    currentNodes.set(fragment, node);
    if (previousNodes.has(fragment) &&
      !(node.parentFragmentLabel &&
        updatedParentFragments.has(node.parentFragmentLabel))) {
      previousNodes.delete(fragment);
    } else {
      if (node.fragmentLabel) {
        updatedParentFragments.add(node.fragmentLabel);
      }
      toWrite.push(fragment);
    }
  }
  // Removal code for previousNodes that haven't been found in new file version.
  for (const node of previousNodes.values()) {
    if (node._removeCode) {
      toRemove.push(node._removeCode);
    }
  }
  previousNodesByFile.set(path, currentNodes);
  return [].concat(toRemove, toWrite);
};

const evaluateChangedCodeFragments = (ast, path) => {
  const codeFragments = changedNodesToCodeFragments(ast.program.body, path);
  for (const codeFragment of codeFragments) {
    hakkModules.evalCodeInModule(codeFragment, path);
  }
};

const loadModule = (filenameFullPath, replServer) => {
  if (modulePathManager.has(filenameFullPath)) {
    // Already loaded module and watching it.
    return;
  }
  modulePathManager.add(filenameFullPath);
  watchForFileChanges(
    filenameFullPath, 100,
    (code, init) => {
      try {
        evaluateChangedCodeFragments(prepareAST(code), filenameFullPath);
        // Trigger preview update in case the file has updated a function
        // that will produce a new result for the pending REPL input.
        if (replServer) {
          replServer._ttyWrite(null, {});
        }
        if (!init) {
          modulePathManager.jump(filenameFullPath);
          updatePrompt(replServer);
        }
      } catch (e) {
        console.log(e);
      }
    });
};

const run = async (filename) => {
  const filenameFullPath = path.resolve(filename);
  const replServer = await createReplServer(filenameFullPath);
  hakkModules.setModuleLoader(path => loadModule(path, replServer));
  loadModule(filenameFullPath, replServer);
};

module.exports = { run };
