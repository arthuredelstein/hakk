const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;

const repl = require('node:repl');
const options = { useColors: true };

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
      await originalEval(generatorResult.code, ...args);
    } catch (e) {
      await originalEval(code, ...args);
    }
  };
};

const replServer = new repl.REPLServer(options);
replServer.eval = createEvalWithMutableTopLevel(replServer.eval);
