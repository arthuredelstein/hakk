const repl = require('node:repl');
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const hakkModules = require('./hakk_modules.js');
const fs = require('fs');
const path = require('node:path');
const { prepareCode } = require('./transform.js');

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
  e.reasonCode === 'UnterminatedTemplate' &&
  code[code.length - 1] === '\n';

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
  replServer.eval = async (code, context, filename, callback) => {
    try {
      const modifiedCode = prepareCode(code);
      if (modifiedCode.trim().length === 0) {
        return callback(null);
      }
      const result = await hakkModules.evalCodeInModule(
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

const updatePrompt = (replServer) => {
  replServer.setPrompt(fileBasedPrompt(modulePathManager.current()));
  replServer.prompt();
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
        updatePrompt(replServer);
      } else if (key.name === 'b') {
        modulePathManager.back();
        updatePrompt(replServer);
      }
    }
    originalTtyWrite(d, key);
  };
  return replServer;
};

module.exports = { createReplServer, modulePathManager, updatePrompt };