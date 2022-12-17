const fs = require('fs');
const fsPromises = require('node:fs/promises');
const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const path = require('node:path');
const repl = require('node:repl');
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const hoistVariables = require('@babel/helper-hoist-variables').default;

// ## Utility functions

// Ensure we allow 'import' keyword.
const parse = (code) => parser.parse(code, { sourceType: 'module' });

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
  for (const node of topLevelNodes) {
    if (node.type === 'VariableDeclaration') {
      if (node.kind === 'const' || node.kind === 'let') {
        node.kind = 'var';
      }
    }
  }
  return tree;
};

const transformImport = (ast) => {
  traverse(ast, {
    ImportDeclaration (path) {
      const source = path.node.source.value;
      const specifiers = [];
      let namespaceId;
      for (const specifier of path.node.specifiers) {
        if (specifier.type === 'ImportDefaultSpecifier') {
          specifiers.push(`default: ${specifier.local.name}`);
        } else if (specifier.type === 'ImportSpecifier') {
          if (specifier.imported.type === 'Identifier' &&
              specifier.imported.name !== specifier.local.name) {
            specifiers.push(
              `${specifier.imported.name}: ${specifier.local.name}`);
          } else if (specifier.imported.type === 'StringLiteral' &&
                     specifier.imported.value !== specifier.local.name) {
            specifiers.push(
              `'${specifier.imported.value}': ${specifier.local.name}`);
          } else {
            specifiers.push(specifier.local.name);
          }
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          namespaceId = specifier.local.name;
        }
      }
      const sourceString = `await import('${source}')`;
      let line = '';
      if (namespaceId !== undefined) {
        line += `const ${namespaceId} = ${sourceString};`;
      }
      if (specifiers.length > 0) {
        line += `const {${specifiers.join(', ')}} = ${namespaceId ?? sourceString};`;
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
    PrivateName (path) {
      path.replaceWith(path.node.id);
      path.node.name = '_PRIVATE_' + path.node.name;
    },
    ClassDeclaration (path) {
      let className, classBodyNodes;
      const classNode = path.node;
      if (classNode.id.type === 'Identifier') {
        className = classNode.id.name;
      }
      if (classNode.body.type === 'ClassBody') {
        classBodyNodes = classNode.body.body;
      }
      const outputNodes = [];
      let constructorFound = false;
      for (const classBodyNode of classBodyNodes) {
        let templateAST;
        // Convert private methods and fields to public methods
        // and fields  with a `_PRIVATE_` prefix.
        if (classBodyNode.type === 'ClassPrivateMethod' ||
            classBodyNode.type === 'ClassPrivateProperty') {
          classBodyNode.type =
            {
              ClassPrivateMethod: 'ClassMethod',
              ClassPrivateProperty: 'ClassProperty'
            }[classBodyNode.type];
          classBodyNode.key.type = 'Identifier';
          classBodyNode.key.name = '_PRIVATE_' + classBodyNode.key.id.name;
          classBodyNode.key.id = undefined;
        }
        // Convert methods and fields declarations to separable
        // assignment statements.
        if (classBodyNode.type === 'ClassMethod') {
          let fun;
          if (classBodyNode.kind === 'constructor') {
            constructorFound = true;
            templateAST = template.ast(
              `${className}.prototype._CONSTRUCTOR_ = function () { }`);
            fun = templateAST.expression.right;
          } else if (classBodyNode.kind === 'method') {
            templateAST = template.ast(
              `${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} = ${classBodyNode.async ? 'async ' : ''}function${classBodyNode.generator ? '*' : ''} () {}`
            );
            fun = templateAST.expression.right;
          } else if (classBodyNode.kind === 'get' ||
                     classBodyNode.kind === 'set') {
            templateAST = template.ast(
              `Object.defineProperty(${className}.prototype, "${classBodyNode.key.name}", {
                 ${classBodyNode.kind}: function () { },
                 configurable: true
               });`
            );
            fun = templateAST.expression.arguments[2].properties[0].value;
          } else {
            throw new Error(`Unexpected ClassMethod kind ${classBodyNode.kind}`);
          }
          fun.body = classBodyNode.body;
          fun.params = classBodyNode.params;
        } else if (classBodyNode.type === 'ClassProperty') {
          templateAST = template.ast(
            `${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} = undefined;`
          );
          if (classBodyNode.value !== null) {
            templateAST.expression.right = classBodyNode.value;
          }
        } else {
          throw new Error(`Unexpected ClassBody node type ${classBodyNode.type}`);
        }
        if (templateAST !== undefined) {
          outputNodes.push(templateAST);
        }
      }
      // Create an empty constructor delegate if there wasn't one
      // explicitly declared.
      if (!constructorFound) {
        const constructorAST = template.ast(
          `${className}.prototype._CONSTRUCTOR_ = function () {}`);
        outputNodes.unshift(constructorAST);
      }
      // Delegate this class's constructor to `this._CONSTRUCTOR_` so
      // that user can replace it dynamically.
      const declarationAST = template.ast(
        `var ${className} = function (...args) { this._CONSTRUCTOR_(...args); }`
      );
      outputNodes.unshift(declarationAST);
      path.replaceWithMultiple(outputNodes);
    }
  });
  return ast;
};

// TODO:
// `Extends` and `super` using https://stackoverflow.com/questions/15192722/javascript-extending-class

// ## REPL setup

// TODO:: Detect use of top-level await and if it's
// found, wrap everything but the vars in (async () => { ... })()
const hoistTopLevelVars = (ast) => {
  traverse(ast, {
    Program (path) {
      const varNames = [];
      hoistVariables(path, varData => varNames.push(varData.name));
      for (const varName of varNames) {
        const varDeclarationAST = template.ast(`var ${varName};`);
        path.node.body.unshift(varDeclarationAST);
      }
    }
  });
  return ast;
};

let previousFragments = new Set();

const evaluateChangedCodeFragments = async (replServer, code, filename) => {
  try {
    const tree = parse(code);
    const newFragments = new Set();
    for (const node of tree.program.body) {
      // Remove trailing comments because they are redundant.
      node.trailingComments = undefined;
      const fragment = generate(node, {}, '').code;
      newFragments.add(fragment);
      if (previousFragments.has(fragment)) {
        previousFragments.delete(fragment);
      } else {
        await new Promise((resolve, reject) => {
          replServer.eval(fragment, replServer.context, filename,
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
    // for (const fragment of previousFragments) {
    // TODO: remove old fragment
    // }
    previousFragments = newFragments;
  } catch (e) {
    console.log(e);
  }
};

const prepare = (code) => {
  if (code.trim().length === 0) {
    return '\n';
  }
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
      // console.log(e);
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
        evaluateChangedCodeFragments(replServer, prepare(code), filename);
      } catch (e) {
        console.log(e);
      }
    });
};

exports.run = run;
