const path = require('node:path');
const { Module: OriginalModule } = require('node:module');
const { scopedEvaluator } = require('./evaluator.js');
const { changedNodesToCodeFragments, prepareAST } = require('./transform.js');
const fs = require('node:fs');
const url = require('url');

class UnexpectedTopLevelAwaitFoundError extends Error { }

const findPackageFile = (startingDir) => {
  const testPackageFile = path.join(path.resolve(startingDir), 'package.json');
  if (fs.existsSync(testPackageFile)) {
    return testPackageFile;
  } else {
    const parent = path.dirname(startingDir);
    if (parent !== startingDir) {
      return findPackageFile(path.dirname(startingDir));
    } else {
      return undefined;
    }
  }
};

const isFileAsync = (filePath) => {
  if (filePath.endsWith('.mjs')) {
    return true;
  }
  try {
    const packageFile = findPackageFile(path.dirname(filePath));
    if (packageFile !== undefined) {
      const packageFileContents = fs.readFileSync(packageFile).toString();
      const packageObject = JSON.parse(packageFileContents);
      if (packageObject.type === 'module') {
        return true;
      }
    }
  } catch (e) {
    console.log(e);
  }
  return false;
};

const isLocalPath = (path) =>
  path.startsWith('./') || path.startsWith('../');

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

const originalResolveFilename = (localPath, dirPath) =>
  OriginalModule._resolveFilename(
    localPath, null, false, { paths: [dirPath] });

class Module {
  constructor (filePath, moduleManager, isAsync) {
    this.filePath = path.resolve(filePath);
    this.moduleManager_ = moduleManager;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    this.isAsync = isAsync;
    this.previousNodes = new Map();
    this.currentVars = new Set();
    const __import = (path) => this.__import(path);
    __import.meta = { url: url.pathToFileURL(this.filePath).href };
    this.eval = scopedEvaluator(
      this.exports,
      (path) => this.require(path),
      this,
      this.filePath,
      this.dirPath,
      __import);
    const update = this.isAsync
      ? () => this.updateFileAsync()
      : () => this.updateFileSync();
    watchForFileChanges(this.filePath, 100, () => {
      moduleManager.onUpdate(this.filePath);
      update();
    });
  }

  require (requirePath) {
    const fullRequirePath = originalResolveFilename(requirePath, this.dirPath);
    if (isLocalPath(requirePath)) {
      const module = this.moduleManager_.getModuleSync(fullRequirePath);
      module.updateFileSync();
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  }

  async __import (importPath) {
    const fullImportPath = originalResolveFilename(importPath, this.dirPath);
    if (isLocalPath(importPath)) {
      const module = await this.moduleManager_.getModuleAsync(fullImportPath);
      await module.updateFileAsync();
      return module.exports;
    } else {
      return await import(fullImportPath);
    }
  }

  getLatestFragments () {
    const contents = fs.readFileSync(this.filePath, { encoding: 'utf8' }).toString();
    const { latestNodes, fragments } = changedNodesToCodeFragments(
      this.previousNodes, prepareAST(contents).program.body);
    this.previousNodes = latestNodes;
    return fragments;
  }

  updateFileSync () {
    const latestFragments = this.getLatestFragments();
    // First screen for top-level awaits.
    for (const { isAsync } of latestFragments) {
      if (isAsync) {
        throw new UnexpectedTopLevelAwaitFoundError(
          'Found a top-level await in a sync module.');
      }
    }
    // Now evaluate each line of code.
    try {
      for (const { code, addedVars, deletedVars } of latestFragments) {
        this.eval(code);
        if (deletedVars) {
          deletedVars.forEach(v => this.currentVars.delete(v));
        }
        if (addedVars) {
          addedVars.forEach(v => this.currentVars.add(v));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async updateFileAsync () {
    try {
      for (const { code, isAsync, addedVars, deletedVars } of this.getLatestFragments()) {
        if (!isAsync) {
          this.eval(code);
        } else {
          await this.eval(`(async () => { ${code} })();`);
        }
        if (deletedVars) {
          deletedVars.forEach(v => this.currentVars.delete(v));
        }
        if (addedVars) {
          addedVars.forEach(v => this.currentVars.add(v));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

class ModuleManager {
  constructor () {
    this.moduleCreationListeners_ = new Set();
    this.moduleUpdateListeners_ = new Set();
    this.moduleMap_ = new Map();
  }

  static async create (rootModulePath) {
    const rootModuleFullPath = path.resolve(rootModulePath);
    const moduleManager = new ModuleManager();
    let fileIsAsync = isFileAsync(rootModuleFullPath);
    if (!fileIsAsync) {
      try {
        moduleManager.getModuleSync(rootModuleFullPath);
      } catch (e) {
        if (e instanceof UnexpectedTopLevelAwaitFoundError) {
          fileIsAsync = true;
        } else {
          throw e;
        }
      }
    }
    if (fileIsAsync) {
      await moduleManager.getModuleAsync(rootModuleFullPath);
    }
    return moduleManager;
  }

  getModuleSync (filePath) {
    if (this.moduleMap_.has(filePath)) {
      return this.moduleMap_.get(filePath);
    } else {
      const module = new Module(filePath, this, false);
      module.updateFileSync();
      this.moduleMap_.set(filePath, module);
      this.moduleCreationListeners_.forEach(listener => listener(filePath));
      console.log('loaded CommonJS module: ' + path.relative('.', filePath));
      return module;
    }
  }

  async getModuleAsync (filePath) {
    if (this.moduleMap_.has(filePath)) {
      return this.moduleMap_.get(filePath);
    } else {
      const module = new Module(filePath, this, true);
      await module.updateFileAsync();
      this.moduleMap_.set(filePath, module);
      this.moduleCreationListeners_.forEach(listener => listener(filePath));
      console.log('loaded ES module: ' + path.relative('.', filePath));
      return module;
    }
  }

  addModuleCreationListener (callback) {
    this.moduleCreationListeners_.add(callback);
  }

  addModuleUpdateListener (callback) {
    this.moduleUpdateListeners_.add(callback);
  }

  onUpdate (filePath) {
    this.moduleUpdateListeners_.forEach(listener => listener(filePath));
  }

  evalInModule (filePath, code, definedVars) {
    const module = this.moduleMap_.get(filePath);
    const result = module.eval(code);
    if (definedVars) {
      definedVars.forEach(v => module.currentVars.add(v));
    }
    return result;
  }

  getModulePaths () {
    return [...this.moduleMap_.keys()].reverse();
  }

  getVars (filePath) {
    return [...this.moduleMap_.get(filePath).currentVars].sort();
  }
}

module.exports = {
  ModuleManager
};
