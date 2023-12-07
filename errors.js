// Map from hash-based code fragment tracker to the latest offset for that
// code fragment.
let offsets = {};

// Receive the latest offsets for each known code fragment. Overwrites old
// offset values for existing code fragments and adds offsets for any new
// code fragments.
const updateOffsets = (offsetsMap) => {
  offsets = Object.assign(offsets, offsetsMap);
};

// A regular expression that allows us to extract the path, tracker hash, lineNo
// and column from a raw stack line.
const rawStackLineRegex = /\((.+?)\|([a-f,0-9]+):(\d+):(\d+)\)/;

// Takes a raw stack trace, rewrites all stack lines with a hash-based tracker
// to file:line:column with the latest correct source line number, and removes
// stack lines corresponding to the hakk evaluator.
const reformatStack = (stack) => {
  const lines = stack.split('\n');
  const newLines = [];
  let pendingLine = undefined;
  for (let line of lines) {
    if (line.includes('hakk/evaluator.js') && line.includes('<anonymous>')) {
      newLines.push('    at hakk repl input');
      break;
    }
    if (line.includes('hakk/evaluator.js') && line.includes('at generator')) {
      break;
    }
    // Collapse the stack lines for wrapper functions.
    if (pendingLine !== undefined) {
      const [pendingFragment] = pendingLine.match(rawStackLineRegex);
      const [lineFragment] = line.match(rawStackLineRegex);
      line = line.replace(lineFragment, pendingFragment);
      pendingLine = undefined;
    }
    // We have a stack line for a wrapper function.
    if (line.includes('_hakk_')) {
      pendingLine = line;
      continue;
    }
    try {
      const [fragment, path, hash, lineNo, column] = line.match(rawStackLineRegex);
      const trueLineNo = parseInt(lineNo) + offsets[hash] - 1;
      const finalForm = `(${path}:${trueLineNo}:${column})`;
      newLines.push(line.replaceAll(fragment, finalForm));
    } catch (e) {
      newLines.push(line);
    }
  }
  return newLines.join('\n');
};

// Enable stack rewriting for all errors.
const setupStackTraces = () => {
  Error.prepareStackTrace = (err, callsites) => {
    return reformatStack(err.stack);
  };
};

module.exports = { setupStackTraces, updateOffsets };
