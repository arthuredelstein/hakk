const fs = require('fs');
const path = require('node:path');
const repl = require('node:repl');
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const hakkModules = require('./hakk_modules.js');
const { prepareAST, prepareCode, generate } = require('./transform.js');

// ## Utility functions

const watchForFileChanges = (path, interval, callback) => {
  const readAndCallback = async () => {
    const contents = fs.readFileSync(path, { encoding: 'utf8' });
    callback(contents);
  };
  readAndCallback();
  fs.watchFile(
    path, { interval, persistent: false },
    (current, previous) => {
      if (current.mtime !== previous.mtime) {
        readAndCallback();
      }
    });
};

// Take a string and return the sha256 digest in a hex string (64 characters).
const sha256 = (text) =>
  createHash('sha256').update(text, 'utf8').digest().toString('hex');

// TODO:
// `Extends` and `super` using https://stackoverflow.com/questions/15192722/javascript-extending-class

// ## REPL setup

/*
// TODO:: Detect use of top-level await and if it's
// found, wrap everything but the vars in (async () => { ... })()
const hoistTopLevelVars = (ast) => {
  traverse(ast, {
    Program (path) {
      const varNames = [];
      hoistVariables(path, varData => varNames.push(varData.name));
      for (const varName of varNames) {
        const varDeclarationAST = template.ast(`var ${varName};`);
        path.node.body.unshift(varDeclarationAST);
      }
    }
  });
  return ast;
};
*/

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

let currentReplFilePath;

const setupReplEval = (replServer) => {
  replServer.eval = (code, context, filename, callback) => {
    try {
      const modifiedCode = prepareCode(code);
      if (modifiedCode.trim().length === 0) {
        return callback(null);
      }
      const result = hakkModules.evalCodeInModule(
        modifiedCode, currentReplFilePath);
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

let replServer;

const modulePaths = [];

let currentReplPathIndex = 0;

const loadModule = (filenameFullPath) => {
  if (!modulePaths.includes(filenameFullPath)) {
    modulePaths.push(filenameFullPath);
  }
  watchForFileChanges(
    filenameFullPath, 100,
    (code) => {
      try {
        evaluateChangedCodeFragments(prepareAST(code), filenameFullPath);
        // Trigger preview update in case the file has updated a function
        // that will produce a new result for the pending REPL input.
        if (replServer) {
          replServer._ttyWrite(null, {});
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

const fileBasedPrompt = (filenameFullPath) => {
  const filename = path.basename(filenameFullPath);
  return `${filename}> `;
};

const nextRepl = (replServer, forward) => {
  currentReplPathIndex = (currentReplPathIndex + modulePaths.length + (forward ? 1 : -1)) % modulePaths.length;
  currentReplFilePath = modulePaths[currentReplPathIndex];
  replServer.setPrompt(fileBasedPrompt(currentReplFilePath));
  replServer.prompt();
};

const createReplServer = async (filenameFullPath) => {
  const options = { useColors: true, prompt: fileBasedPrompt(filenameFullPath) };
  const replServer = new repl.REPLServer(options);
  await new Promise(resolve => replServer.setupHistory(path.join(historyDir(), sha256(filenameFullPath)), resolve));
  setupReplEval(replServer, filenameFullPath);
  const originalTtyWrite = replServer._ttyWrite;
  replServer._ttyWrite = async (d, key) => {
    if (key.meta === true && key.shift === false && key.ctrl === false) {
      if (key.name === 'b') {
        nextRepl(replServer, false);
      } else if (key.name === 'f') {
        nextRepl(replServer, true);
      }
    }
    originalTtyWrite(d, key);
  };
  return replServer;
};

const run = async (filename) => {
  hakkModules.setModuleLoader(loadModule);
  const filenameFullPath = path.resolve(filename);
  currentReplFilePath = filenameFullPath;
  replServer = await createReplServer(filenameFullPath);
  loadModule(filenameFullPath);
};

module.exports = { run };
