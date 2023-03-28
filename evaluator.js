module.exports = {
  scopedEvaluator: (exports, require, module, filePath, dirPath, __import) => {
    // Create a generator that reads a value on yield
    // evaluates it, and sends the result back.
    const generator = function * (exports, require, module, __filename, __dirname, __import) {
      let valueToSend;
      while (true) {
        const {code, sourceURL} = yield valueToSend;
        if (code === '.end') {
          break;
        }
        const annotatedCode = code + `
          //# sourceURL=${sourceURL}`;
        try {
          valueToSend = { result: eval(annotatedCode) }; // eslint-disable-line no-eval
        } catch (e) {
          valueToSend = { error: e };
        }
      }
    };
    // Run the generator.
    const iterator = generator(exports, require, module, filePath, dirPath, __import);
    // Discard first empty value.
    iterator.next();
    // Return an evaluation function that takes code and returns the result of
    // eval run in the generator scope. If evaluation causes an error, then
    // throw that error instead.
    return function ({code, sourceURL}) {
      const { result, error } = iterator.next({code, sourceURL}).value;
      if (error) {
        throw error;
      } else {
        return result;
      }
    };
  }
};
