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

const replServer = new repl.REPLServer(options);
const eval1 = replServer.eval;
const eval2 = async (code, ...args) => {
  const tree = parse(code);
  const tree2 = makeTopLevelDeclarationsMutable(tree);
  const generatorResult = generate(tree2, {}, code);
  await eval1(generatorResult.code, ...args);
};
replServer.eval = eval2;
