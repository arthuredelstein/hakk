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

// Make class declarations mutable by transforming to prototype
// construction.
//
// class A {
//   constructor() {
//     this.q_ = 1;
//   }
//   inc() {
//     ++this.q_;
//   }
//   get q() {
//     return this.q_;
//   }
//   set q(value) {
//     this.q_ = value;
//   }
// }
//  ... gets transformed to ...
// var A = function () { this.q_ = 1; }
// A.prototype.inc = function () { ++this.q_; }
// Object.defineProperty(A.prototype, "q",
//   { get: function () { return this.q_; },
//     configurable: true });
// Object.defineProperty(A.prototype, "q",
//   { set: function (value) { this.q_ = value; }
//     configurable: true });
const transformClass = (ast) => {
  traverse(ast, {
    ClassDeclaration(path) {
      let className, classBodyNodes;
      const classNode = path.node;
      if (classNode.id.type === "Identifier") {
        className = classNode.id.name;
      }
      if (classNode.body.type === "ClassBody") {
        classBodyNodes = classNode.body.body;
      }
      let outputNodes = [];
      for (const classBodyNode of classBodyNodes) {
        let templateAST = undefined;
        if (classBodyNode.type === "ClassMethod") {
          if (classBodyNode.kind === "constructor") {
            templateAST = template.ast(
              `var ${className} = function () {}`);
            fun = templateAST.declarations[0].init;
          } else if (classBodyNode.kind === "method") {
            templateAST = template.ast(
              `${className}.${classBodyNode.static ? "" : "prototype."}${classBodyNode.key.name} = ${classBodyNode.async ? "async " : ""}function${classBodyNode.generator ? "*" : ""} () {}`
            );
            fun = templateAST.expression.right;
          } else if (classBodyNode.kind === "get" ||
                     classBodyNode.kind === "set") {
            templateAST = template.ast(
              `Object.defineProperty(${className}.prototype, "${classBodyNode.key.name}", {
                 ${classBodyNode.kind}: function () { },
                 configurable: true
               });`
            );
            fun = templateAST.expression.arguments[2].properties[0].value;
          } else {
            throw new Error(`Unexpected kind ${classBodyNode.kind}`);
          }
          fun.body = classBodyNode.body;
          fun.params = classBodyNode.params;
        } else if (classBodyNode.type === "ClassProperty") {
          templateAST = template.ast(
            `${className}.${classBodyNode.static ? "" : "prototype."}${classBodyNode.key.name} = undefined;`
          );
          if (classBodyNode.value !== null) {
            templateAST.expression.right = classBodyNode.value;
          }
        }
        if (templateAST !== undefined) {
          outputNodes.push(templateAST);
        }
      }
      path.replaceWithMultiple(outputNodes);
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
      transformClass(
        transformImport(
          parse(code))))).code;
  return result;
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

const run = (filename) => {
  const options = { useColors: true, prompt: `${filename}> ` };
  const replServer = new repl.REPLServer(options);
  useEvalWithCodeModifications(replServer, prepare);
  const filenameFullPath = path.resolve(filename);
  const setGlobalsCommand = `
    __filename = '${filenameFullPath}';
    __dirname = '${path.dirname(filenameFullPath)}';
    let exports = {};
  `;
  evaluateChangedCodeFragments(replServer, setGlobalsCommand);
  watchForFileChanges(
    filename, 100,
    (code) => {
      try {
        replServer._refreshLine();
        replServer
        evaluateChangedCodeFragments(replServer, prepare(code))
      } catch (e) {
        console.log(e);
      };
    });
};

exports.run = run;
