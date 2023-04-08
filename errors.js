let offsets = {};

const updateOffsets = (offsetsMap) => {
  offsets = Object.assign(offsets, offsetsMap);
}

const rawStackLineRegex = /\((.+?)\|([a-f,0-9]+)\:(\d+)\:(\d+)\)/;

const reformatStack = (stack) => {
  const lines = stack.split("\n");
  const newLines = [];
  for (const line of lines) {
    try {
      const [fragment, path, hash, lineNo, column] = line.match(rawStackLineRegex);
      const trueLineNo = parseInt(lineNo) + offsets[hash] - 1;
      const finalForm =  "(" + path + ":" + trueLineNo + ":" + column + ")";
      newLines.push(line.replaceAll(fragment, finalForm));
    } catch (e) {
      newLines.push(line);
    }
  }
  return newLines.join("\n");
}

const setupStackTraces = () => {
  Error.prepareStackTrace = (err, callsites) => {
    return reformatStack(err.stack);
  }
}

module.exports = { setupStackTraces, updateOffsets };