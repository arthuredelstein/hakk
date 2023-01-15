const fs = require('fs');
const path = require('node:path');
const repl = require('node:repl');
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const hakkModules = require('./hakk_modules.js');
const { prepareAST, prepareCode, generate } = require('./transform.js');
const { ROOT_CONFIG_FILENAMES } = require('@babel/core/lib/config/files/configuration.js');

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

// Take a string and return the sha256 digest in a hex string (64 characters).
const sha256 = (text) =>
  createHash('sha256').update(text, 'utf8').digest().toString('hex');

// TODO:
// `Extends` and `super` using https://stackoverflow.com/questions/15192722/javascript-extending-class

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

// Returns true if the inputted code is incomplete.
const unexpectedNewLine = (code, e) =>
  e &&
  e.code === 'BABEL_PARSER_SYNTAX_ERROR' &&
  e.reasonCode === 'UnexpectedToken' &&
  e.loc &&
  e.loc.index === code.length &&
  code[code.length - 1] === '\n';

const unterminatedTemplate = (code, e) =>
  e &&
  e.code === 'BABEL_PARSER_SYNTAX_ERROR' &&
  e.reasonCode === 'UnterminatedTemplate' &&
  code[code.length - 1] === '\n';

const incompleteCode = (code, e) =>
  unexpectedNewLine(code, e) || unterminatedTemplate(code, e);

let replServer;

const modulePathManager = {
  modulePaths: [],
  add (path) {
    if (!this.modulePaths.includes(path)) {
      this.modulePaths.push(path);
    }
  },
  forward () {
    this.modulePaths.push(this.modulePaths.shift());
  },
  back () {
    this.modulePaths.unshift(this.modulePaths.pop());
  },
  jump (path) {
    if (!this.modulePaths.includes(path)) {
      throw new Error("module not found");
    }
    // Step forward one step, so user can hit "back" to return
    this.forward();
    this.modulePaths = this.modulePaths.filter(p => p !== path);
    this.modulePaths.unshift(path);
  },
  current () {
    return this.modulePaths[0];
  },
  has (path) {
    return this.modulePaths.includes(path);
  }
};

const setupReplEval = (replServer) => {
  replServer.eval = (code, context, filename, callback) => {
    try {
      const modifiedCode = prepareCode(code);
      if (modifiedCode.trim().length === 0) {
        return callback(null);
      }
      const result = hakkModules.evalCodeInModule(
        modifiedCode, modulePathManager.current());
      return callback(null, result);
    } catch (e) {
      if (incompleteCode(code, e)) {
        return callback(new repl.Recoverable(e));
      } else {
        return callback(e);
      }
    }
  };
};

const fileBasedPrompt = (filenameFullPath) => {
  const filename = path.basename(filenameFullPath);
  return `${filename}> `;
};

const updatePrompt = () => {
  replServer.setPrompt(fileBasedPrompt(modulePathManager.current()));
  replServer.prompt();
};

const loadModule = (filenameFullPath) => {
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
          updatePrompt();
        }
      } catch (e) {
        console.log(e);
      }
    });
};

const historyDir = () => {
  const histDir = path.join(homedir, '.hakk', 'history');
  fs.mkdirSync(histDir, { recursive: true });
  return histDir;
};

const createReplServer = async (filenameFullPath) => {
  const options = { useColors: true, prompt: fileBasedPrompt(filenameFullPath) };
  const replServer = new repl.REPLServer(options);
  await new Promise(resolve => replServer.setupHistory(path.join(historyDir(), sha256(filenameFullPath)), resolve));
  setupReplEval(replServer, filenameFullPath);
  const originalTtyWrite = replServer._ttyWrite;
  replServer._ttyWrite = async (d, key) => {
    if (key.meta === true && key.shift === false && key.ctrl === false) {
      if (key.name === 'f') {
        modulePathManager.forward();
        updatePrompt();
      } else if (key.name === 'b') {
        modulePathManager.back();
        updatePrompt();
      }
    }
    originalTtyWrite(d, key);
  };
  return replServer;
};

const run = async (filename) => {
  hakkModules.setModuleLoader(loadModule);
  const filenameFullPath = path.resolve(filename);
  replServer = await createReplServer(filenameFullPath);
  loadModule(filenameFullPath);
};

module.exports = { run };
