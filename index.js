const fs = require('fs');
const fsPromises = require('node:fs/promises');
const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const path = require('node:path');
const repl = require('node:repl');
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
const hoistVariables = require('@babel/helper-hoist-variables').default;
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const staticBlockPlugin = require('@babel/plugin-proposal-class-static-block').default;

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

// Take a string and return the sha256 digest in a hex string (64 characters).
const sha256 = (text) =>
  createHash('sha256').update(text, 'utf8').digest().toString('hex');

// ## AST transformation visitors

const programVisitor = {
  Program (path) {
    const topLevelNodes = path.node.body;
    for (const node of topLevelNodes) {
      if (node.type === 'VariableDeclaration') {
        if (node.kind === 'const' || node.kind === 'let') {
          node.kind = 'var';
        }
      }
    }
  }
};

const importVisitor = {
  MetaProperty (path) {
    if (path.node.meta.name === 'import') {
      path.replaceWith(template.ast('_IMPORT_'));
    }
  },
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
};

const getEnclosingClass = path => path.findParent((path) => path.isClassDeclaration());

const getEnclosingSuperClassName = path => getEnclosingClass(path).node.superClass.name;

const getEnclosingMethod = path => path.findParent((path) => path.isMethod());

const getEnclosingProperty = path => path.findParent((path) => path.isProperty());

const handleCallExpression = (path) => {
  let ast;
  if (path.node.callee.type === 'Super') {
    const superClassName = getEnclosingSuperClassName(path);
    ast = template.ast(`${superClassName}.prototype._CONSTRUCTOR_.call(this)`);
  } else if (path.node.callee.type === 'MemberExpression' &&
             path.node.callee.object.type === 'Super') {
    const methodName = path.node.callee.property.name;
    const methodPath = getEnclosingMethod(path);
    const isStatic = methodPath.node.static;
    const superClassName = getEnclosingSuperClassName(path);
    ast = template.ast(`${superClassName}${isStatic ? '' : '.prototype'}.${methodName}.call(${isStatic ? '' : 'this'})`);
  } else {
    return;
  }
  const expressionAST = ast.expression;
  expressionAST.arguments = expressionAST.arguments.concat(path.node.arguments);
  path.replaceWith(expressionAST);
};

const handleMemberExpression = (path) => {
  const object = path.node.object;
  if (object.type === 'Super') {
    const enclosure = getEnclosingProperty(path) ?? getEnclosingMethod(path);
    const superClassName = getEnclosingSuperClassName(path);
    if (enclosure.node.static) {
      object.type = "Identifier";
      object.name = superClassName;
    } else {
      path.replaceWith(template.ast('undefined'));
//      throw new Error("super found in the wrong place!");
    }
  }
};

// Convert private methods and fields to public methods
// and fields  with a `_PRIVATE_` prefix.
const handlePrivateProperty = (path, propertyType) => {
  path.node.type = propertyType;
  path.node.key.type = 'Identifier';
  path.node.key.name = '_PRIVATE_' + path.node.key.id.name;
  path.node.key.id = undefined;
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
//
// See also: good stuff at
// https://github.com/AMorgaut/babel-plugin-transform-class/blob/master/src/index.js
const classVisitor = {
  PrivateName: {
    enter (path) {
      path.replaceWith(path.node.id);
      path.node.name = '_PRIVATE_' + path.node.name;
    }
  },
  ClassPrivateMethod (path) {
    handlePrivateProperty(path, 'ClassMethod');
  },
  ClassPrivateProperty (path) {
    handlePrivateProperty(path, 'ClassProperty');
  },
  ClassDeclaration: {
    exit (path) {
      let className, superClassName, classBodyNodes;
      const classNode = path.node;
      if (classNode.id.type === 'Identifier') {
        className = classNode.id.name;
      }
      if (classNode.superClass &&
          classNode.superClass.type === 'Identifier') {
        superClassName = classNode.superClass.name;
      }
      if (classNode.body.type === 'ClassBody') {
        classBodyNodes = classNode.body.body;
      }
      const outputNodes = [];
      let constructorFound = false;
      for (const classBodyNode of classBodyNodes) {
        let templateAST;
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
      if (superClassName === undefined) {
        // Create a constructor delegate if there wasn't one
        // already explicitly declared and there's no superclas.
        if (!constructorFound) {
          const constructorAST = template.ast(
            `${className}.prototype._CONSTRUCTOR_ = function () {};`);
          outputNodes.unshift(constructorAST);
        }
      } else {
        outputNodes.unshift(template.ast(
          `Object.setPrototypeOf(${className}, ${superClassName});`));
        outputNodes.unshift(template.ast(
          `Object.setPrototypeOf(${className}.prototype, ${superClassName}.prototype);`));
      }
      // Delegate this class's constructor to `this._CONSTRUCTOR_` so
      // that user can replace it dynamically.
      const declarationAST = template.ast(
        `var ${className} = function (...args) { this._CONSTRUCTOR_(...args); }`
      );
      outputNodes.unshift(declarationAST);
      path.replaceWithMultiple(outputNodes);
    }
  }
};

const superVisitor = {
  CallExpression (path) {
    handleCallExpression(path);
  },
  MemberExpression (path) {
    handleMemberExpression(path);
  }
};

const staticBlockVisitor = staticBlockPlugin({
  types, template, assertVersion: () => undefined}).visitor;


const isTopLevelDeclaredObject = (path) =>
  types.isVariableDeclarator(path.parentPath) &&
  types.isVariableDeclaration(path.parentPath.parentPath) &&
  types.isProgram(path.parentPath.parentPath.parentPath);

const objectVisitor = {
  ObjectExpression (path) {
    if (!isTopLevelDeclaredObject(path)) {
      return;
    }
    const originalProperties = path.node.properties;
    path.node.properties = [];
    const name = path.parentPath.node.id.name;
    let outputASTs = [];
    for (const property of originalProperties) {
      let ast;
      if (types.isObjectProperty(property)) {
        const key = property.key;
        if (types.isIdentifier(key)) {
          ast = template.ast(`${name}.${key.name} = undefined;`);
        }
        if (types.isStringLiteral(key)) {
          ast = template.ast(`${name}['${key.value}'] = undefined;`);
        }
        ast.expression.right = property.value;
      } else if (types.isObjectMethod(property)) {
        const key = property.key;
        if (types.isIdentifier(key)) {
          ast = template.ast(`${name}.${key.name} = function () { };`);
          const expressionRight = ast.expression.right;
          expressionRight.params = property.params;
          expressionRight.async = property.async;
          expressionRight.generator = property.generator;
          expressionRight.body = property.body;
        }
      } else {
        throw new Error("Unexpected object member ${propety.type}.");
      }
      outputASTs.push(ast);
    }
    for (let outputAST of outputASTs.reverse()) {
      path.parentPath.parentPath.insertAfter(outputAST);
    }
  }
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

const transform = (ast, visitors) => {
  for (const visitor of visitors) {
    traverse(ast, visitor);
  }
  return ast;
};

const prepare = (code) => {
  if (code.trim().length === 0) {
    return '\n';
  }
  let ast = parse(code);
  ast = transform(
    ast, [importVisitor, superVisitor, staticBlockVisitor,
          objectVisitor, classVisitor, programVisitor]);
  return generate(ast).code;
};

// Returns true if the inputted code is incomplete.
const incompleteCode = (code, e) =>
  e &&
  e.code === "BABEL_PARSER_SYNTAX_ERROR" &&
  e.reasonCode === "UnexpectedToken" &&
  e.loc &&
  e.loc.index === code.length &&
  code[code.length - 1] === '\n';

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

const run = async (filename) => {
  const options = { useColors: true, prompt: `${filename}> ` };
  const replServer = new repl.REPLServer(options);
  const filenameFullPath = path.resolve(filename);
  const historyDir = path.join(homedir, '.hakk', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  await new Promise(resolve => replServer.setupHistory(path.join(historyDir, sha256(filenameFullPath)), resolve));
  useEvalWithCodeModifications(replServer, prepare);
  const setGlobalsCommand = `
    __filename = '${filenameFullPath}';
    __dirname = '${path.dirname(filenameFullPath)}';
    let exports = {};
    var _IMPORT_ = { meta: ''};
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
