const fs = require("fs");
const fsPromises = require('node:fs/promises');
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;
const { transformSync } = require("@babel/core");
const repl = require('node:repl');
const options = { useColors: true };
const minimist = require('minimist');

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
    // TODO:
    // Make class declarations mutable by transforming to prototype
    // construction.
    //
    // class A {
    //   constructor() {
    //     this.q = 1;
    //   }
    //   inc() {
    //     ++this.q;
    //   }
    // }
    //  ... gets transformed to ...
    // var A = function () { this.q = 1; }
    // A.prototype.inc = function () { ++this.q; }
    //
    // The modified prototype gets applied to existing instances!
    // I need to detect when the constructor gets redefined so we can re-evaluate
    // all method definitions.
  }
  return tree;
};

const useEvalWithMutableTopLevel = (replServer) => {
  const originalEval = replServer.eval;
  const newEval = (code, ...args) => {
    try {
      const tree = parse(code);
      const tree2 = makeTopLevelDeclarationsMutable(tree);
      const generatorResult = generate(tree2, {}, code);
      originalEval(generatorResult.code,
                   ...args);
    } catch (e) {
      originalEval(code, ...args);
    }
  };
  replServer.eval = newEval;
};

let previousFragments = new Set();

const evaluateChangedCodeFragments = async (replServer, code) => {
  const tree = parse(code);
  const newFragments = new Set();
  for (let node of tree.program.body) {
    const fragment = generate(node, {}, "").code;
    newFragments.add(fragment);
    if (previousFragments.has(fragment)) {
      previousFragments.delete(fragment);
    } else {
      replServer.eval(fragment, replServer.context, undefined, () => {});
    }
  }
  for (let fragment of previousFragments) {
    // TODO: remove old fragment
  }
  previousFragments = newFragments;
};

const main = () => {
  const argv = minimist(process.argv.slice(2));
  console.log(argv);
  const replServer = new repl.REPLServer(options);
  const newEval = useEvalWithMutableTopLevel(replServer);
  watchForFileChanges("test.js", 100,
                      (code) => evaluateChangedCodeFragments(replServer, code));
};

if (require.main === module) {
  main();
}
