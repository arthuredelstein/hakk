const path = require('node:path');
const { Module: OriginalModule } = require('node:module');
const { scopedEvaluator } = require('./evaluator.js');
const { webEvaluator } = require('./html.js');
const { changedNodesToCodeFragments, prepareAST } = require('./transform.js');
const fs = require('node:fs');
const url = require('url');
const errors = require('./errors.js');

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
    console.error(e);
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
    localPath, { filename: dirPath }, false, { paths: [dirPath] });

class Module {
  constructor (filePath, moduleManager, isAsync, isWeb) {
    this.isWeb = isWeb;
    this.filePath = path.resolve(filePath);
    this.moduleManager_ = moduleManager;
    this.dirPath = path.dirname(filePath);
    this.exports = {};
    this.isAsync = isAsync;
    this.previousNodes = new Map();
    this.currentVars = new Set();
    this.dependingModules_ = new Set();
    const __import = (path) => this.__import(path);
    __import.meta = { url: url.pathToFileURL(this.filePath).href };
    const require = (path) => this.require(path);
    require.resolve = (path) => originalResolveFilename(path, this.dirPath);
    this.eval = isWeb
      ? webEvaluator(
        this.exports,
        require,
        this,
        this.filePath,
        this.dirPath,
        __import)
      : scopedEvaluator(
        this.exports,
        require,
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
    if (isLocalPath(requirePath) && !requirePath.endsWith('.json')) {
      const module = this.moduleManager_.getModuleSync(fullRequirePath);
      module.addDependingModule(this);
      return module.exports;
    } else {
      return originalRequire(fullRequirePath);
    }
  }

  async __import (importPath) {
    const fullImportPath = originalResolveFilename(importPath, this.dirPath);
    if (isLocalPath(importPath)) {
      const module = await this.moduleManager_.getModuleAsync(fullImportPath);
      module.addDependingModule(this);
      return module.exports;
    } else {
      return await import(fullImportPath);
    }
  }

  async evalAsync ({ code, sourceURL, isAsync }) {
    if (isAsync) {
      await this.eval({ code: `(async () => { ${code}\n })();`, sourceURL });
    } else {
      this.eval({ code, sourceURL });
    }
  }

  getLatestFragments () {
    const contents = this.isWeb ? '' : fs.readFileSync(this.filePath, { encoding: 'utf8' }).toString();
    const ast = prepareAST(contents);
    const body = ast.program ? ast.program.body : [];
    const { latestNodes, fragments, offsetsMap } = changedNodesToCodeFragments(
      this.previousNodes, body, this.filePath);
    this.previousNodes = latestNodes;
    errors.updateOffsets(offsetsMap);
    return fragments;
  }

  addDependingModule (module) {
    this.dependingModules_.add(module);
  }

  updateRequire (filePath) {
    try {
      for (const [code, node] of this.previousNodes.entries()) {
        if (node._topLevelRequire) {
          const fullRequirePath = originalResolveFilename(node._topLevelRequire, this.dirPath);
          if (fullRequirePath === filePath) {
            this.eval({ code, sourceURL: filePath });
          }
        }
      }
    } catch (e) {
      console.error(`Error updating required module ${filePath}:\n${e}`);
    }
  }

  async updateImport (filePath) {
    try {
      for (const [code, node] of this.previousNodes.entries()) {
        if (node._topLevelImport) {
          const fullImportPath = originalResolveFilename(node._topLevelImport, this.dirPath);
          if (fullImportPath === filePath) {
            await this.evalAsync({ code, sourceURL: filePath, isAsync: true });
          }
        }
      }
    } catch (e) {
      console.error(`Error updating imported module ${filePath}:\n${e} ${e.stack}`);
    }
  }

  updateDependingModuleRequires () {
    for (const dependingModule of this.dependingModules_) {
      dependingModule.updateRequire(this.filePath);
    }
  }

  async updateDependingModuleImports () {
    for (const dependingModule of this.dependingModules_) {
      dependingModule.updateImport(this.filePath);
    }
  }

  handleVarUpdates ({ deletedVars, addedOrChangedVars }) {
    if (deletedVars) {
      deletedVars.forEach(v => this.currentVars.delete(v));
      for (const deletedVar of deletedVars) {
        if (Object.hasOwn(this.exports, deletedVar)) {
          delete this.exports[deletedVar];
        }
      }
    }
    if (addedOrChangedVars) {
      addedOrChangedVars.forEach(v => this.currentVars.add(v));
      for (const addedOrChangedVar of addedOrChangedVars) {
        if (Object.hasOwn(this.exports, addedOrChangedVar)) {
          this.eval({ code: `module.exports.${addedOrChangedVar} = ${addedOrChangedVar};` });
        }
      }
    }
  }

  updateFileSync () {
    try {
      const latestFragments = this.getLatestFragments();
      // First screen for top-level awaits.
      for (const { isAsync } of latestFragments) {
        if (isAsync) {
          throw new UnexpectedTopLevelAwaitFoundError(
            `Found an unexpected top-level await in file '${this.filePath}'.`);
        }
      }
      // Now evaluate each line of code.
      for (const { code, addedOrChangedVars, deletedVars, tracker } of latestFragments) {
        this.eval({ code, sourceURL: tracker });
        this.handleVarUpdates({ addedOrChangedVars, deletedVars });
      }
    } catch (e) {
      console.error(e);
    }
    this.updateDependingModuleRequires();
  }

  async updateFileAsync () {
    try {
      for (const { code, isAsync, addedOrChangedVars, deletedVars, tracker } of this.getLatestFragments()) {
        await this.evalAsync({ code, sourceURL: tracker, isAsync });
        this.handleVarUpdates({ addedOrChangedVars, deletedVars });
      }
    } catch (e) {
      console.error(e);
    }
    await this.updateDependingModuleImports();
  }
}

class ModuleManager {
  constructor (isWeb) {
    this.isWeb = isWeb;
    this.moduleCreationListeners_ = new Set();
    this.moduleUpdateListeners_ = new Set();
    this.moduleMap_ = new Map();
    Error.stackTraceLimit = Infinity;
    errors.setupStackTraces();
  }

  static async create (rootModulePath, isWeb) {
    const rootModuleFullPath = path.resolve(rootModulePath);
    const moduleManager = new ModuleManager(isWeb);
    let fileIsAsync = isWeb || isFileAsync(rootModuleFullPath);
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
      const module = new Module(filePath, this, false, this.isWeb);
      this.moduleMap_.set(filePath, module);
      console.log('loading ' + path.relative('.', filePath));
      module.updateFileSync();
      this.moduleCreationListeners_.forEach(listener => listener(filePath));
      return module;
    }
  }

  async getModuleAsync (filePath) {
    if (this.moduleMap_.has(filePath)) {
      return this.moduleMap_.get(filePath);
    } else {
      const module = new Module(filePath, this, true, this.isWeb);
      this.moduleMap_.set(filePath, module);
      console.log('loading ' + path.relative('.', filePath));
      await module.updateFileAsync();
      this.moduleCreationListeners_.forEach(listener => listener(filePath));
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
    const result = module.eval({ code });
    module.handleVarUpdates({ addedOrChangedVars: definedVars });
    return result;
  }

  getModulePaths () {
    return [...this.moduleMap_.keys()];
  }

  getVars (filePath) {
    return [...this.moduleMap_.get(filePath).currentVars].sort();
  }
}

module.exports = {
  ModuleManager
};
