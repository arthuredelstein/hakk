const path = require('node:path');
const { Module } = require('node:module');
const { syncScopedEvaluator } = require('./sync-eval.js');

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
    this.eval = syncScopedEvaluator(
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
