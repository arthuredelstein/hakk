const fs = require("fs");
const fsPromises = require('node:fs/promises');
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;

const repl = require('node:repl');
const options = { useColors: true };

const watchForFileChanges = (path, interval, callback) => {
  const readAndCallback = async () => {
    const contents = await fsPromises.readFile(path, { encoding: 'utf8' });
    callback(contents);
  };
  readAndCallback();
  fs.watchFile(
    path, { interval, persistent: false },
    async (current, previous) => {
      if (current.mtime !== previous.mtime) {
        await readAndCallback();
      }
    });
};

const makeTopLevelDeclarationsMutable = (tree) => {
  const topLevelNodes = tree.program.body;
  for (let node of topLevelNodes) {
    if (node.type === "VariableDeclaration") {
      if (node.kind === "const" || node.kind === "let") {
        node.kind = "var";
      }
    }
  }
  return tree;
};

const createEvalWithMutableTopLevel = (originalEval) => {
  return async (code, ...args) => {
    try {
      const tree = parse(code);
      const tree2 = makeTopLevelDeclarationsMutable(tree);
      const generatorResult = generate(tree2, {}, code);
//      console.log(generatorResult.code);
      await originalEval(generatorResult.code, ...args);
    } catch (e) {
//      console.log(e);
      await originalEval(code, ...args);
    }
  };
};

let previousFragments = new Set();

const evaluateChangedCodeFragments = (c) => {
  //  console.log(c);
  const tree = parse(c);
  const currentFragments = new Set();
  for (let node of tree.program.body) {
    const fragment = generate(node, {}, "").code;
    currentFragments.add(fragment);
    if (previousFragments.has(fragment)) {
      previousFragments.delete(fragment);
    } else {
//      console.log(fragment);
      newEval(fragment, replServer.context, undefined, () => {});
    }
  }
  for (let fragment of previousFragments) {
    // TODO: remove old fragment
  }
  previousFragments = currentFragments;
};

const replServer = new repl.REPLServer(options);
const newEval = createEvalWithMutableTopLevel(replServer.eval);
replServer.eval = newEval;
watchForFileChanges("test.js", 100, evaluateChangedCodeFragments);
