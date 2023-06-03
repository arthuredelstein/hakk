const repl = require('node:repl');
const homedir = require('os').homedir();
const fs = require('fs');
const path = require('node:path');
const { prepareAstNodes, generate } = require('./transform.js');
const { sha256 } = require('./utils.js');

// TODO: Get source mapping with something like:
// generate(ast, {sourceMaps: true, sourceFileName: "test"})
// (The `generate` API requires `sourceFileName` to be included for source maps
// to be generated.)
// Q: Can we use https://www.npmjs.com/package/babel-plugin-source-map-support
// and https://www.npmjs.com/package/source-map-support ?
// How do these work? See also https://v8.dev/docs/stack-trace-api

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

class ModulePathManager {
  constructor (paths) {
    this.modulePaths_ = paths;
  }

  add (path) {
    if (!this.modulePaths_.includes(path)) {
      this.modulePaths_.push(path);
    }
  }

  forward () {
    this.modulePaths_.push(this.modulePaths_.shift());
  }

  back () {
    this.modulePaths_.unshift(this.modulePaths_.pop());
  }

  jump (path) {
    if (!this.modulePaths_.includes(path)) {
      throw new Error(`module '${path}' not found`);
    }
    // Step forward one step, so user can hit "back" to return
    this.forward();
    this.modulePaths_ = this.modulePaths_.filter(p => p !== path);
    this.modulePaths_.unshift(path);
  }

  current () {
    return this.modulePaths_[0];
  }

  has (path) {
    return this.modulePaths_.includes(path);
  }
}

const caselessStartsWith = (a, b) =>
  a.toLowerCase().startsWith((b ?? '').toLowerCase());

const fileBasedPrompt = (filenameFullPath) => {
  const filename = path.relative('.', filenameFullPath);
  return `${filename}> `;
};

const updatePrompt = (replServer, modulePathManager) => {
  replServer.setPrompt(fileBasedPrompt(modulePathManager.current()));
  replServer.prompt();
};

const historyDir = () => {
  const histDir = path.join(homedir, '.hakk', 'history');
  fs.mkdirSync(histDir, { recursive: true });
  return histDir;
};

const monitorSpecialKeys = (replServer, modulePathManager) => {
  const originalTtyWrite = replServer._ttyWrite;
  replServer._ttyWrite = async (d, key) => {
    const shiftOnly = key.meta === false && key.shift === true && key.ctrl === false;
    if (shiftOnly && key.name === 'right') {
      modulePathManager.forward();
      updatePrompt(replServer, modulePathManager);
    } else if (shiftOnly && key.name === 'left') {
      modulePathManager.back();
      updatePrompt(replServer, modulePathManager);
    } else if (key.name === 'd' && key.ctrl === true) {
      process.exit(0);
    } else {
      originalTtyWrite(d, key);
    }
  };
};

class Repl {
  static async start (moduleManager) {
    const repl = new Repl(moduleManager);
    await repl.initializeHistory();
    return repl;
  }

  constructor (moduleManager) {
    this.moduleManager_ = moduleManager;
    this.modulePathManager_ = new ModulePathManager(moduleManager.getModulePaths());
    this.moduleManager_.addModuleCreationListener((path) => {
      this.modulePathManager_.add(path);
    });
    const options = {
      useColors: true,
      prompt: fileBasedPrompt(this.modulePathManager_.current()),
      eval: (code, context, filename, callback) =>
        this.eval(code, context, filename, callback),
      preview: false
    };
    console.log('Use shift+left and shift+right to switch between modules.');
    this.replServer_ = new repl.REPLServer(options);
    const originalCompleter = this.replServer_.completer;
    this.replServer_.completer = (text, cb) => {
      originalCompleter(text, (error, [completions, stub]) => {
        const vars = moduleManager.getVars(this.modulePathManager_.current());
        completions.push('', ...vars.filter(v => caselessStartsWith(v, stub)));
        cb(error, [completions, stub ?? '']);
      });
    };
    this.moduleManager_.addModuleUpdateListener(filename => this.update(filename));
    monitorSpecialKeys(this.replServer_, this.modulePathManager_);
  }

  initializeHistory () {
    return new Promise(resolve => this.replServer_.setupHistory(
      path.join(historyDir(), sha256(this.modulePathManager_.current())), resolve));
  }

  update (filenameFullPath) {
    // Trigger preview update in case the file has updated a function
    // that will produce a new result for the pending REPL input.
    this.replServer_._ttyWrite(null, {});
    // Switch the repl to the current file.
    this.modulePathManager_.jump(filenameFullPath);
    updatePrompt(this.replServer_, this.modulePathManager_);
  }

  updateUnderscores (lastResult) {
    const vars = this.moduleManager_.getVars(this.modulePathManager_.current());
    global.________ = global._______;
    global._______ = global.______;
    global.______ = global._____;
    global._____ = global.____;
    global.____ = global.___;
    global.___ = global.__;
    if (vars.includes('_')) {
      global.__ = lastResult;
    } else {
      global.__ = global._;
      global._ = lastResult;
    }
  }

  async eval (code, context, filename, callback) {
    let nodes;
    try {
      nodes = prepareAstNodes(code);
    } catch (e) {
      if (incompleteCode(code, e)) {
        return callback(new repl.Recoverable(e));
      } else {
        return callback(e);
      }
    }
    if (nodes.length === 0) {
      return callback(null);
    }
    const evalInCurrentModule = (code, definedVars) =>
      this.moduleManager_.evalInModule(
        this.modulePathManager_.current(), code, definedVars);
    let result;
    for (const node of nodes) {
      const modifiedCode = generate(node).code;
      try {
        if (node._topLevelAwait) {
          result = await evalInCurrentModule(
            `(async () => { return ${modifiedCode}\n })()`, node._definedVars);
        } else if (node._topLevelForOfAwait) {
          await evalInCurrentModule(
            `(async () => { ${modifiedCode} \n })()`, node._definedVars);
        } else {
          result = evalInCurrentModule(modifiedCode, node._definedVars);
        }
        this.updateUnderscores(result);
      } catch (e) {
        return callback(e);
      }
    }
    return callback(null, result);
  }
}

module.exports = { Repl };
