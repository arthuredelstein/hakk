const path = require('node:path');
const { Module: OriginalModule } = require('node:module');
const { scopedEvaluator } = require('./evaluator.js');
const { changedNodesToCodeFragments, prepareAST } = require('./transform.js');
const fs = require('node:fs');

const isFileAsync = (path) => {
  if (path.endsWith(".mjs")) {
    return true;
  }
};

const isLocalPath = (path) =>
  path.startsWith("./") || path.startsWith("../") ||
  path.startsWith("/");

const watchForFileChanges = (path, interval, callback) => {
  fs.watchFile(
    path, { interval, persistent: false },
    (current, previous) => {
      if (current.mtime !== previous.mtime) {
        callback();
      }
    });
};

const originalRequire = require;

class Module {
  constructor(filePath, moduleManager) {
    this.filePath = filePath;
    this.moduleManager_ = moduleManager;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    this.isAsync = isFileAsync(this.filePath);
    this.eval = scopedEvaluator(
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
      moduleManager.onUpdate();
      update();
    });
  }
  require (requirePath) {
    const fullRequirePath = OriginalModule._resolveFilename(
      requirePath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(requirePath)) {
      const module = this.moduleManager_.getModule(fullRequirePath);
      module.updateFileSync();
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  }
  async importFunction (importPath) {
    const fullImportPath = OriginalModule._resolveFilename(
      importPath, null, false, { paths: [this.dirPath] });
    if (isLocalPath(importPath)) {
      const module = this.moduleManager_.getModule(fullImportPath);
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

class ModuleManager {
  moduleCreationListeners_ = new Set();
  moduleUpdateListeners_ = new Set();
  moduleMap_ = new Map();
  constructor(rootModulePath) {
    this.getModule(rootModulePath);
  }
  getModule = (filePath) => {
    if (this.moduleMap_.has(filePath)) {
      return this.moduleMap_.get(filePath);
    } else {
      const module = new Module(filePath, this);
      this.moduleMap_.set(filePath, module);
      this.moduleCreationListeners_.forEach(listener => listener(filePath));
      return module;
    }
  };
  addModuleCreationListener (callback) {
    this.moduleCreationListeners_.add(callback);
  }
  addModuleUpdateListener (callback) {
    this.moduleUpdateListeners_.add(callback);
  }
  onUpdate (filePath) {
    this.moduleUpdateListeners_.forEach(listener => listener(filePath));
  }
  evalInModule (filePath, code) {
    return this.getModule(filePath).eval(code);
  }
  getModulePaths () {
    return [...this.moduleMap_.keys()].reverse();
  }
}

module.exports = {
  ModuleManager
};
