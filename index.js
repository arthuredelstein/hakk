const fs = require("fs");
const fsPromises = require('node:fs/promises');
const parser = require("@babel/parser");
const generate = require("@babel/generator").default;
const { transformSync } = require("@babel/core");
const repl = require('node:repl');
const minimist = require('minimist');
const traverse = require("@babel/traverse").default;
const template = require("@babel/template").default;

// Ensure we allow 'import' keyword.
const parse = (code) => parser.parse(code, { 'sourceType': 'module'});

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

const treeWithTopLevelDeclarationsMutable = (tree) => {
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

const codeWithTopLevelDeclarationsMutable = (code) => {
  const tree = parse(code);
  const tree2 = treeWithTopLevelDeclarationsMutable(tree);
  const generatorResult = generate(tree2, {}, code);
  return generatorResult.code;
};

const useEvalWithCodeModifications = (replServer, modifierFunction) => {
  const originalEval = replServer.eval;
  const newEval = (code, context, filename, callback) => {
    try {
      originalEval(modifierFunction(code), context, filename, callback);
    } catch (e) {
      //console.log(e);
    }
  };
  replServer.eval = newEval;
};

let previousFragments = new Set();

const evaluateChangedCodeFragments = async (replServer, code) => {
  try {
    const tree = parse(code);
    const newFragments = new Set();
    for (let node of tree.program.body) {
      const fragment = generate(node, {}, "").code;
      newFragments.add(fragment);
      if (previousFragments.has(fragment)) {
        previousFragments.delete(fragment);
      } else {
        await replServer.eval(fragment, replServer.context, undefined, () => {});
        console.log(fragment);
      }
    }
    for (let fragment of previousFragments) {
      // TODO: remove old fragment
    }
    previousFragments = newFragments;
  } catch (e) {
    console.log(e);
  }
};

const inputCode = "import { minimistFun } from 'mininist';";
const outputCode = "const { minimistFun } = require('minimist');";

const transformImport = (ast) => {
  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      let specifiers = [];
      let namespaceId = undefined;
      for (let specifier of path.node.specifiers) {
        if (specifier.type === "ImportDefaultSpecifier") {
          specifiers.push(`default: ${specifier.local.name}`);
        } else if (specifier.type === "ImportSpecifier") {
          if (specifier.imported.type === "Identifier" &&
              specifier.imported.name !== specifier.local.name) {
            specifiers.push(
              `${specifier.imported.name}: ${specifier.local.name}`);
          } else if (specifier.imported.type === "StringLiteral" &&
                     specifier.imported.value !== specifier.local.name) {
            specifiers.push(
              `'${specifier.imported.value}': ${specifier.local.name}`);
          } else {
            specifiers.push(specifier.local.name);
          }
        } else if (specifier.type === "ImportNamespaceSpecifier") {
          namespaceId = specifier.local.name
        }
      };
      const sourceString = `await import('${source}')`;
      let line = "";
      if (namespaceId !== undefined) {
        line += `const ${namespaceId} = ${sourceString};`;
      }
      if (specifiers.length > 0) {
        line += `const {${specifiers.join(", ")}} = ${namespaceId ?? sourceString};`
      }
      if (namespaceId === undefined && specifiers.length === 0) {
        line = sourceString;
      }
      console.log(line);
      const newAst = template.ast(line);
      if (namespaceId && specifiers.length > 0) {
        path.replaceWithMultiple(newAst);
      } else {
        path.replaceWith(newAst);
      }
    }
  });
  return ast;
};

const prepare = (code) => {
  const result = generate(transformImport(parse(code))).code;
//  console.log(result);
  return result;
};

const main = () => {
  const argv = minimist(process.argv.slice(2));
  //console.log(argv);
  const filename = argv._[0];
  const options = { useColors: true, prompt: `${filename}> ` };
  const replServer = new repl.REPLServer(options);
  const newEval = useEvalWithCodeModifications(
    replServer, codeWithTopLevelDeclarationsMutable);
  watchForFileChanges(filename, 100,
    (code) => evaluateChangedCodeFragments(replServer, prepare(code)));
};

if (require.main === module) {
  main();
}
