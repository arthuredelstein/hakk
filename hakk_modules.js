const path = require('node:path');

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

let fetchCode = undefined;

class HakkModule {
  constructor(filePath) {
    this.filePath = filePath;
    this.dirPath = path.dirname(filePath);
    this.eval = scopedEvaluator(this.exports, (path) => this.require(path), { exports: this.exports }, this.filePath, this.dirPath);
  }
  require (requirePath) {
    if (requirePath.startsWith(".")) {
      const fullRequirePath = path.resolve(this.dirPath, requirePath);
      const code = fetchCode(fullRequirePath);
      const module = getModule(fullRequirePath);
      module.eval(code);
      return module.exports;
    } else {
      return originalRequire(requirePath);
    }
  };
  exports = {};
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

evalCodeInModule = (path, code) => {
  const module = getModule(path);
  return module.eval(code);
};

const setCodeFetcher = (fetcherFunction) => {
  fetchCode = fetcherFunction;
};

module.exports = { evalCodeInModule, setCodeFetcher };
