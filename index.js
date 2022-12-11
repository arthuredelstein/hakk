const fs = require("fs");
const fsPromises = require('node:fs/promises');
const generate = require("@babel/generator").default;
const parser = require("@babel/parser");
const path = require('node:path');
const repl = require('node:repl');
const template = require("@babel/template").default;
const traverse = require("@babel/traverse").default;
const { transformSync } = require("@babel/core");

// ## Utility functions

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

// ## AST transformations

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
// The modified prototype then gets applied to existing instances!
// I need to detect when the constructor gets redefined so we can re-evaluate
// all method definitions.

const treeWithTopLevelDeclarationsMutable = (tree) => {
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

// ## REPL setup

let previousFragments = new Set();

const evaluateChangedCodeFragments = async (replServer, code) => {
  try {
    const tree = parse(code);
    const newFragments = new Set();
    for (let node of tree.program.body) {
      // Remove trailing comments because they are redundant.
      node.trailingComments = undefined;
      const fragment = generate(node, {}, "").code;
      newFragments.add(fragment);
      if (previousFragments.has(fragment)) {
        previousFragments.delete(fragment);
      } else {
        await new Promise((resolve, reject) => {
          replServer.eval(fragment, replServer.context, undefined,
                          (err, result) => {
                            if (err) {
                              reject(err);
                            } else {
                              resolve(result);
                            }
                          });
        });
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

const prepare = (code) => {
  const result = generate(
    treeWithTopLevelDeclarationsMutable(
      transformImport(
        parse(code)))).code;
//  console.log(result);
  return result;
};

const useEvalWithCodeModifications = (replServer, modifierFunction) => {
  const originalEval = replServer.eval;
  const newEval = (code, context, filename, callback) => {
    try {
      originalEval(modifierFunction(code), context, filename, callback);
    } catch (e) {
      console.log(`attempted to evaluate: ${code}`);
      //console.log(e);
    }
  };
  replServer.eval = newEval;
};

const run = (filename) => {
  const options = { useColors: true, prompt: `${filename}> ` };
  const replServer = new repl.REPLServer(options);
  useEvalWithCodeModifications(replServer, prepare);
  const filenameFullPath = path.resolve(filename);
  const setGlobalCommand = `
    __filename = '${filenameFullPath}';
    __dirname = '${path.dirname(filenameFullPath)}';
  `;
  evaluateChangedCodeFragments(replServer, setGlobalCommand);
  watchForFileChanges(filename, 100,
    (code) => evaluateChangedCodeFragments(replServer, prepare(code)));
};

exports.run = run;
