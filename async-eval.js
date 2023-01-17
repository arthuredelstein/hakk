const asyncScopedEvaluator = async (the_exports, require, module, filePath, dirPath, importFunction) => {
  // Create a generator that reads a value on yield
  // evaluates it, and sends the result back.
  const generator = async function* (exports, require, module, __filename, __dirname, importFunction) {
    let valueToSend;
    while (true) {
      const receivedValue = yield valueToSend;
      if (receivedValue === '.end') {
        break;
      }
      try {
        valueToSend = { result: eval(receivedValue) };
      } catch (e) {
        if (e.message.includes("await")) {
          valueToSend = { result: await eval(`(async () => { return ${receivedValue} })()`) };
        } else {
          valueToSend = { error: e };
        }
      }
    }
  };
  // Run the generator.
  const asyncIterator = generator(the_exports, require, module, filePath, dirPath, importFunction);
  // Discard first empty value.
  await asyncIterator.next();
  // Return an evaluation function that
  // takes code and returns the result of eval
  // run in the generator scope.
  // If evaluation causes an error, then throw
  // that error instead.
  return async function (code) {
    const output = await asyncIterator.next(code);
    const { result, error } = output.value;
    if (error) {
      throw error;
    } else {
      return result;
    }
  };
};

module.exports = { asyncScopedEvaluator };
