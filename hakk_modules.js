const path = require('node:path');
const { Module } = require('node:module');
const { syncScopedEvaluator } = require('./sync-eval.js');
const { asyncScopedEvaluator } = require('./async-eval.js');
var originalRequire = require;

var evalCodeInModule;

let moduleCreationListeners = new Set();

const hakkModuleMap = new Map();

let addModuleSync = undefined;
let addModule = undefined;

const isFileAsync = (path) => {
  if (path.endsWith(".mjs")) {
    return true;
  }
};

const isLocalPath = (path) =>
  path.startsWith("./") || path.startsWith("../") ||
  path.startsWith("/");


class HakkModule {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    hakkModuleMap.set(filePath, this);
  }
  require (requirePath) {
    const fullRequirePath = Module._resolveFilename(
      requirePath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(requirePath)) {
      const module = getModuleSync(fullRequirePath);
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  }
  async importFunction (importPath) {
    const fullImportPath = Module._resolveFilename(
      importPath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(importPath)) {
      addModule(fullImportPath);
      const module = await getModule(fullImportPath);
      return module.exports;
    } else {
      return await import(fullImportPath);
    }
  }
};

var createModuleSync = (filePath) => {
  const module = new HakkModule(filePath);
  module.eval = syncScopedEvaluator(
    module.exports,
    (path) => module.require(path),
    module,
    module.filePath,
    module.dirPath,
    (path) => module.importFunction(path));
  for (const moduleCreationListener of moduleCreationListeners) {
    moduleCreationListener(filePath, false);
  }
  return module;
};

var createModule = async (filePath) => {
  const isAsync = isFileAsync(filePath);
  if (isAsync) {
    const module = new HakkModule(filePath);
    module.eval = await asyncScopedEvaluator(
      module.exports,
      (path) => module.require(path),
      module,
      module.filePath,
      module.dirPath,
      (path) => module.importFunction(path));
    for (const moduleCreationListener of moduleCreationListeners) {
      moduleCreationListener(filePath, true);
    }
    return module;
  } else {
    return createModuleSync(filePath);
  }
};

var getModuleSync = (filePath) => {
  if (hakkModuleMap.has(filePath)) {
    return hakkModuleMap.get(filePath);
  } else {
    return createModuleSync(filePath);
  }
};

var getModule = async (filePath) => {
  if (hakkModuleMap.has(filePath)) {
    return hakkModuleMap.get(filePath);
  } else {
    return createModule(filePath);
  }
};

evalCodeInModule = async (code, modulePath) => {
  const module = await getModule(modulePath);
  return module.eval(code);
};

const setModuleLoader = (moduleLoaderFunction) => {
  addModule = moduleLoaderFunction;
};

const addModuleCreationListener = (callback) => {
  moduleCreationListeners.add(callback);
};

module.exports = { evalCodeInModule, getModule, setModuleLoader, addModuleCreationListener };
