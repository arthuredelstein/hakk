const repl = require('node:repl');
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const hakkModules = require('./hakk_modules.js');
const fs = require('fs');
const path = require('node:path');
const { prepareCode } = require('./transform.js');

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
  e.reasonCode === 'UnterminatedTemplate' &&
  code[code.length - 1] === '\n';

const incompleteCode = (code, e) =>
  unexpectedNewLine(code, e) || unterminatedTemplate(code, e);

const modulePathManager = {
  modulePaths: [],
  add (path) {
    console.log("Attaching", path);
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
  let modifiedCode;
  try {
    modifiedCode = prepareCode(code);
  } catch (e) {
    if (incompleteCode(code, e)) {
      return callback(new repl.Recoverable(e));
    } else {
      return callback(e);
    }
  }
  if (modifiedCode.trim().length === 0) {
    return callback(null);
  }
  let module = hakkModules.getModule(modulePathManager.current());
  try {
    const result = module.eval(modifiedCode);
    return callback(null, result);
  } catch (e) {
    if (e.message.includes("await is only valid in async functions")) {
      try {
        const result = await module.eval(
          `(async () => { return ${modifiedCode} })()`);
        return callback(null, result);
      } catch (e1) {
        return callback(e1);
      }
    } else {
      return callback(e);
    }
  }
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

const createReplServer = async (filenameFullPath) => {
  const options = { useColors: true, prompt: fileBasedPrompt(filenameFullPath) };
  const replServer = new repl.REPLServer(options);
  await new Promise(resolve => replServer.setupHistory(path.join(historyDir(), sha256(filenameFullPath)), resolve));
  replServer.eval = replEval;
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
  hakkModules.addModuleCreationListener((path) => {
    modulePathManager.add(path);
  });
  hakkModules.addModuleUpdateListener((path) => {
    updateRepl(replServer, path);
  });
  return replServer;
};

module.exports = { createReplServer, modulePathManager, updatePrompt };