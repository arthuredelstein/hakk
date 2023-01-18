const repl = require('node:repl');
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const modules = require('./modules.js');
const fs = require('fs');
const path = require('node:path');
const { prepareAstNodes, generate } = require('./transform.js');

// TODO: Get source mapping with something like:
// generate(ast, {sourceMaps: true, sourceFileName: "test"})
// (The `generate` API requires `sourceFileName` to be included for source maps
// to be generated.)
// Q: Can we use https://www.npmjs.com/package/babel-plugin-source-map-support
// and https://www.npmjs.com/package/source-map-support ?
// How do these work? See also https://v8.dev/docs/stack-trace-api

// Take a string and return the sha256 digest in a hex string (64 characters).
const sha256 = (text) =>
  createHash('sha256').update(text, 'utf8').digest().toString('hex');

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
  e.reasonCode === 'UnterminatedTemplate';

const incompleteCode = (code, e) =>
  unexpectedNewLine(code, e) || unterminatedTemplate(code, e);

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
      throw new Error(`module '${path}' not found`);
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

const replEval = async (code, context, filename, callback) => {
  let nodes;
  try {
    nodes = prepareAstNodes(code);
  } catch (e) {
    if (incompleteCode(e)) {
      return callback(new repl.Recoverable(e));
    } else {
      return callback(e);
    }
  }
  if (nodes.length === 0) {
    return callback(null);
  }
  let module = modules.getModule(modulePathManager.current());
  let result;
  for (const node of nodes) {
    let modifiedCode = generate(node).code;
    try {
      if (node._topLevelAwait) {
        result = await module.eval(
          `(async () => { return ${modifiedCode} })()`);
      } else {
        result = module.eval(modifiedCode);
      }
    } catch (e) {
      return callback(e);
    }
  }
  return callback(null, result);
};

const fileBasedPrompt = (filenameFullPath) => {
  const filename = path.basename(filenameFullPath);
  return `${filename}> `;
};

const updatePrompt = (replServer) => {
  replServer.setPrompt(fileBasedPrompt(modulePathManager.current()));
  replServer.prompt();
};

const historyDir = () => {
  const histDir = path.join(homedir, '.hakk', 'history');
  fs.mkdirSync(histDir, { recursive: true });
  return histDir;
};

const updateRepl = (replServer, filenameFullPath) => {
  // Trigger preview update in case the file has updated a function
  // that will produce a new result for the pending REPL input.
  if (replServer) {
    replServer._ttyWrite(null, {});
  }
  modulePathManager.jump(filenameFullPath);
  updatePrompt(replServer);
};

const monitorSpecialKeys = (replServer) => {
  const originalTtyWrite = replServer._ttyWrite;
  replServer._ttyWrite = async (d, key) => {
    if (key.meta === true && key.shift === false && key.ctrl === false) {
      if (key.name === 'f') {
        modulePathManager.forward();
        updatePrompt(replServer);
      } else if (key.name === 'b') {
        modulePathManager.back();
        updatePrompt(replServer);
      }
    }
    originalTtyWrite(d, key);
  };
};

const initializeReplHistory = async (replServer, filenameFullPath) =>
  new Promise(resolve => replServer.setupHistory(
    path.join(historyDir(), sha256(filenameFullPath)), resolve));

const createReplServer = async (filenameFullPath) => {
  const options = {
    useColors: true,
    prompt: fileBasedPrompt(filenameFullPath),
    eval: replEval,
  };
  const replServer = new repl.REPLServer(options);
  monitorSpecialKeys(replServer);
  await initializeReplHistory(replServer, filenameFullPath);
  modules.addModuleCreationListener((path) => modulePathManager.add(path));
  modules.addModuleUpdateListener((path) => updateRepl(replServer, path));
  return replServer;
};

module.exports = { createReplServer, modulePathManager, updatePrompt };