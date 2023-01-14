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

const moduleMap = new Map();

var originalRequire = require;
var require = (path) => {
  if (path.startsWith(".")) {
    console.log({ path });
    let module;
    if (moduleMap.has(path)) {
      module = moduleMap.has(path);
    } else {
      module = new HakkModule(path);
      moduleMap.add(path, module);
    }
  } else {
    return originalRequire(path);
  }
};

var exports = {};

class HakkModule {
  constructor(filePath, dirPath) {
    this.eval = scopedEvaluator(exports, require, { exports }, filePath, dirPath);
  }
}

