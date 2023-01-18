const path = require('node:path');
const { Module } = require('node:module');
const { syncScopedEvaluator } = require('./sync-eval.js');
const { changedNodesToCodeFragments, prepareAST } = require('./transform.js');
const fs = require('node:fs');

const hakkModuleMap = new Map();

const isFileAsync = (path) => {
  if (path.endsWith(".mjs")) {
    return true;
  }
};

const isLocalPath = (path) =>
  path.startsWith("./") || path.startsWith("../") ||
  path.startsWith("/");

let moduleCreationListeners = new Set();
let moduleUpdateListeners = new Set();

const watchForFileChanges = (path, interval, callback) => {
  fs.watchFile(
    path, { interval, persistent: false },
    (current, previous) => {
      if (current.mtime !== previous.mtime) {
        callback();
      }
    });
};

const notifyListeners = (listeners, filePath) => {
  for (const listener of listeners) {
    listener(filePath);
  }
};

const originalRequire = require;

class HakkModule {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    hakkModuleMap.set(filePath, this);
    this.isAsync = isFileAsync(this.filePath);
    this.eval = syncScopedEvaluator(
      this.exports,
      (path) => this.require(path),
      this,
      this.filePath,
      this.dirPath,
      (path) => this.importFunction(path));
    const update = this.isAsync
      ? () => this.updateFileAsync()
      : () => this.updateFileSync();
    update();
    watchForFileChanges(filePath, 100, () => {
      notifyListeners(moduleUpdateListeners, filePath);
      update();
    });
    notifyListeners(moduleCreationListeners, filePath);
  }
  require (requirePath) {
    const fullRequirePath = Module._resolveFilename(
      requirePath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(requirePath)) {
      const module = getModule(fullRequirePath);
      module.updateFileSync();
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  }
  async importFunction (importPath) {
    const fullImportPath = Module._resolveFilename(
      importPath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(importPath)) {
      const module = getModule(fullImportPath);
      await module.updateFileAsync();
      return module.exports;
    } else {
      return await import(fullImportPath);
    }
  }
  getLatestFragments () {
    const contents = fs.readFileSync(this.filePath, { encoding: "utf8" }).toString();
    return changedNodesToCodeFragments(prepareAST(contents).program.body, this.filePath);
  }
  updateFileSync () {
    for (const codeFragment of this.getLatestFragments()) {
      this.eval(codeFragment);
    }
  }
  async updateFileAsync () {
    for (const codeFragment of this.getLatestFragments()) {
      try {
        this.eval(codeFragment);
      } catch (e) {
        if (e.message.includes("await is only valid in async functions")) {
          await this.eval(`(async () => { ${codeFragment} })();`);
        } else {
          throw e;
        }
      }
    }
  }
};

var getModule = (filePath) => {
  if (hakkModuleMap.has(filePath)) {
    return hakkModuleMap.get(filePath);
  } else {
    return new HakkModule(filePath);
  }
};

const addModuleCreationListener = (callback) => {
  moduleCreationListeners.add(callback);
};

const addModuleUpdateListener = (callback) => {
  moduleUpdateListeners.add(callback);
};

module.exports = {
  getModule,
  addModuleCreationListener,
  addModuleUpdateListener,
};
