const path = require('node:path');
const { Module } = require('node:module');

const scopedEvaluator = (the_exports, require, module, filePath, dirPath) => {
  // Create a generator that reads a value on yield
  // evaluates it, and sends the result back.
  const generator = function* (exports, require, module, __filename, __dirname) {
    let valueToSend;
    while (true) {
      const receivedValue = yield valueToSend;
      if (receivedValue === '.end') {
        break;
      }
      try {
        valueToSend = { result: eval(receivedValue) };
      } catch (e) {
        valueToSend = { error: e };
      }
    }
  };
  // Run the generator.
  const iterator = generator(the_exports, require, module, filePath, dirPath);
  // Discard first empty value.
  iterator.next();
  // Return an evaluation function that
  // takes code and returns the result of eval
  // run in the generator scope.
  // If evaluation causes an error, then throw
  // that error instead.
  return function (code) {
    const { result, error } = iterator.next(code).value;
    if (error) {
      throw error;
    } else {
      return result;
    }
  };
};

var originalRequire = require;

var evalCodeInModule;

const hakkModuleMap = new Map();

let loadModule = undefined;

class HakkModule {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    const thisModule = this;
    this.eval = scopedEvaluator(
      thisModule.exports,
      (path) => thisModule.require(path),
      thisModule,
      thisModule.filePath,
      thisModule.dirPath);
  }
  require (requirePath) {
    const fullRequirePath = Module._resolveFilename(
      requirePath, null, false, { paths: [this.dirPath] });
    if (requirePath.startsWith("./") || requirePath.startsWith("../") ||
      requirePath.startsWith("/")) {
      loadModule(fullRequirePath);
      const module = getModule(fullRequirePath);
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  };
}

var getModule = (path) => {
  if (hakkModuleMap.has(path)) {
    return hakkModuleMap.get(path);
  } else {
    const module = new HakkModule(path);
    hakkModuleMap.set(path, module);
    return module;
  }
};

evalCodeInModule = (code, modulePath) => {
  const module = getModule(modulePath);
  return module.eval(code);
};

const setModuleLoader = (moduleLoaderFunction) => {
  loadModule = moduleLoaderFunction;
};

module.exports = { evalCodeInModule, setModuleLoader };
