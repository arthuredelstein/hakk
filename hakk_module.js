const fs = require('node:fs');
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

const hakkModuleMap = new Map();

const listOfModules = hakkModuleMap.keys();


class HakkModule {
  constructor(filePath) {
    const dirPath = path.dirname(filePath);
    this.eval = scopedEvaluator(this.exports, require, { exports: this.exports }, filePath, dirPath);
  }
  exports = {};
  requireHandler = null;
}

const getModule = (path) => {
  let module;
  if (hakkModuleMap.has(path)) {
    hakkModuleMap.get(path);
  } else {
    module = new HakkModule(path);
    hakkModuleMap.set(path, module);
  }
  return module;
};

const evalCodeInModule = (path, code) => {
  const module = getModule(path);
  module.eval(code);
};

var originalRequire = require;
var require = (path) => {
  if (path.startsWith(".")) {
    const code = requireHandler(path);
    evalCodeInModule(path, code);
  } else {
    return originalRequire(path);
  }
};

let requireHandler = undefined;

const setRequireHandler = (handlerFunction) => {
  requireHandler = handlerFunction;
};

module.exports = { evalCodeInModule, setRequireHandler };