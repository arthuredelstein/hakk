const fs = require('fs');
const fsPromises = require('node:fs/promises');
const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const path = require('node:path');
const repl = require('node:repl');
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
// TODO: const hoistVariables = require('@babel/helper-hoist-variables').default;
const { createHash } = require('node:crypto');
const homedir = require('os').homedir();
const staticBlockPlugin = require('@babel/plugin-proposal-class-static-block').default;

// ## Utility functions

// Parse JS code into a babel ast.
const parse = (code) => parser.parse(code, { sourceType: 'module' });

const watchForFileChanges = (path, interval, callback) => {
  const readAndCallback = async () => {
    const contents = await fsPromises.readFile(path, { encoding: 'utf8' });
    await callback(contents);
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

const varVisitor = {
  VariableDeclaration (path) {
    if (!types.isProgram(path.parentPath)) {
      return;
    }
    if (path.node.kind !== 'var' || path.node.declarations.length > 1) {
      const outputNodes = path.node.declarations.map(
        d => types.variableDeclaration('var', [d]));
      path.replaceWithMultiple(outputNodes);
    }
    if (path.node && path.node.kind === 'var' && path.node.declarations.length === 1) {
      const varName = path.node.declarations[0].id.name;
      path.node._removeCode = `${varName} = undefined;`;
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

const isTopLevelDeclaredObject = (path) =>
  types.isVariableDeclarator(path.parentPath) &&
  types.isVariableDeclaration(path.parentPath.parentPath) &&
  types.isProgram(path.parentPath.parentPath.parentPath);

const handleCallExpression = (path) => {
  if (path.node.callee.type !== 'MemberExpression' ||
    path.node.callee.object.type !== 'Super') {
    return;
  }
  const methodPath = getEnclosingMethod(path);
  if (!methodPath || methodPath.kind === 'constructor') {
    return;
  }
  // if (TODO: !isTopLevelDeclaredObject(getEnclosingClass(path))) {
  //  return;
  // }
  const methodName = path.node.callee.property.name;
  const isStatic = methodPath.node.static;
  const superClassName = getEnclosingSuperClassName(path);
  const ast = template.ast(`${superClassName}${isStatic ? '' : '.prototype'}.${methodName}.call(${isStatic ? '' : 'this'})`);
  const expressionAST = ast.expression;
  expressionAST.arguments = expressionAST.arguments.concat(path.node.arguments);
  path.replaceWith(expressionAST);
};

const handleMemberExpression = (path) => {
  const object = path.node.object;
  if (object.type !== 'Super') { // ||
    // TODO: !isTopLevelDeclaredObject(getEnclosingClass(path))) {
    return;
  }
  const enclosure = getEnclosingProperty(path) ?? getEnclosingMethod(path);
  const superClassName = getEnclosingSuperClassName(path);
  if (enclosure.node.static) {
    object.type = 'Identifier';
    object.name = superClassName;
  } else {
    path.replaceWith(template.ast('undefined'));
    // throw new Error('super found in the wrong place!');
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

const nodesForClass = ({ className, classBodyNodes }) => {
  const outputNodes = []; const retainedNodes = [];
  for (const classBodyNode of classBodyNodes) {
    let templateAST;
    // Convert methods and fields declarations to separable
    // assignment statements.
    if (classBodyNode.type === 'ClassMethod') {
      if (classBodyNode.kind === 'constructor') {
        retainedNodes.push(classBodyNode);
      } else if (classBodyNode.kind === 'method') {
        templateAST = template.ast(
          `${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} = ${classBodyNode.async ? 'async ' : ''}function${classBodyNode.generator ? '*' : ''} () {}`
        );
        const fun = templateAST.expression.right;
        fun.body = classBodyNode.body;
        fun.params = classBodyNode.params;
        templateAST._removeCode = `if (${className}) { delete ${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} };`;
      } else if (classBodyNode.kind === 'get' ||
        classBodyNode.kind === 'set') {
        const keyName = classBodyNode.key.name;
        templateAST = template.ast(
          `Object.defineProperty(${className}.prototype, "${keyName}", {
             ${classBodyNode.kind}: function () { },
             configurable: true
           });`
        );
        const fun = templateAST.expression.arguments[2].properties[0].value;
        fun.body = classBodyNode.body;
        fun.params = classBodyNode.params;
        const getter = classBodyNode.kind === 'get';
        templateAST._removeCode = `if (${className}) Object.defineProperty(${className}.prototype, "${keyName}", {
          ${classBodyNode.kind}: function (${getter ? '' : 'value'}) {
            return this._PROPERTY_${keyName} ${getter ? '' : '= value'};
          },
          configurable: true
        });`;
      } else {
        throw new Error(`Unexpected ClassMethod kind ${classBodyNode.kind}`);
      }
    } else if (classBodyNode.type === 'ClassProperty') {
      templateAST = template.ast(
        `${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} = undefined;`
      );
      if (classBodyNode.value !== null) {
        templateAST.expression.right = classBodyNode.value;
      }
      templateAST._removeCode = `if (${className} { delete ${className}.${classBodyNode.static ? '' : 'prototype.'}${classBodyNode.key.name} }`;
    } else {
      throw new Error(`Unexpected ClassBody node type ${classBodyNode.type}`);
    }
    if (templateAST !== undefined) {
      outputNodes.push(templateAST);
    }
  }
  outputNodes.forEach(function (outputNode) {
    outputNode.parentFragmentLabel = className;
  });
  return { retainedNodes, outputNodes };
};

// Make class declarations mutable by transforming to class
// expressions assigned to a var, with member declarations
// hoisted out of the class body.
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
  ClassExpression: {
    exit (path) {
      // Only do top-level class variable declarations.
      if (!isTopLevelDeclaredObject(path)) {
        return;
      }
      const classNode = path.node;
      let className, classBodyNodes;
      if (types.isVariableDeclarator(path.parentPath)) {
        className = path.parentPath.node.id.name;
      }
      if (types.isClassBody(classNode.body)) {
        classBodyNodes = classNode.body.body;
      }
      const { retainedNodes, outputNodes } = nodesForClass(
        { classNode, className, classBodyNodes });
      classNode.body.body = retainedNodes;
      path.parentPath.parentPath.node.fragmentLabel = className;
      for (const outputNode of outputNodes) {
        path.parentPath.parentPath.insertAfter(outputNode);
      }
    }
  },
  ClassDeclaration: {
    exit (path) {
      // Only modify top-level class declarations.
      if (!types.isProgram(path.parentPath)) {
        return;
      }
      // Convert a class declaration into a class expression bound to a var.
      const classNode = path.node;
      const expression = template.ast('var AClass = class AClass { }');
      const declaration = expression.declarations[0];
      declaration.id.name = classNode.id.name;
      declaration.init.id.name = classNode.id.name;
      declaration.init.body = classNode.body;
      declaration.init.superClass = classNode.superClass;
      path.replaceWith(expression);
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

const staticBlockVisitor = staticBlockPlugin({ types, template, assertVersion: () => undefined }).visitor;

const objectVisitor = {
  ObjectExpression (path) {
    if (!isTopLevelDeclaredObject(path)) {
      return;
    }
    const originalProperties = path.node.properties;
    path.node.properties = [];
    const name = path.parentPath.node.id.name;
    const outputASTs = [];
    for (const property of originalProperties) {
      const key = property.key;
      let ast;
      if (types.isObjectProperty(property)) {
        if (types.isIdentifier(key)) {
          ast = template.ast(`${name}.${key.name} = undefined;`);
        }
        if (types.isStringLiteral(key)) {
          ast = template.ast(`${name}['${key.value}'] = undefined;`);
        }
        ast.expression.right = property.value;
      } else if (types.isObjectMethod(property)) {
        if (types.isIdentifier(key)) {
          ast = template.ast(`${name}.${key.name} = function () { };`);
          const expressionRight = ast.expression.right;
          expressionRight.params = property.params;
          expressionRight.async = property.async;
          expressionRight.generator = property.generator;
          expressionRight.body = property.body;
        } else {
          throw new Error(`Unexpected key type '${key.type}'.`);
        }
      } else {
        throw new Error(`Unexpected object member '${property.type}'.`);
      }
      ast._removeCode = `delete ${name}['${key.name}']`;
      outputASTs.push(ast);
    }
    for (const outputAST of outputASTs.reverse()) {
      path.parentPath.parentPath.insertAfter(outputAST);
    }
  }
};

const astCodeToAddToModuleExports = (identifier, localName) =>
  types.isStringLiteral(identifier)
    ? template.ast(`module.exports['${identifier.value}'] = ${localName}`)
    : template.ast(`module.exports.${identifier.name} = ${localName}`);

const wildcardExport = (namespaceIdentifier) => {
  const namespaceAccessorString = namespaceIdentifier
    ? (types.isStringLiteral(namespaceIdentifier)
      ? `['${namespaceIdentifier.value}']`
      : `.${namespaceIdentifier.name}`)
    : '';
  return template.ast(
    `const propertyNames = Object.getOwnPropertyNames(importedObject);
     for (const propertyName of propertyNames) {
       if (propertyName !== 'default') {
         module.exports${namespaceAccessorString}[propertyName] = importedObject[propertyName];
       }
     }`);
};

const wrapImportedObject = (moduleName, asts) => {
  const resultAST = template.ast(
    `await (async function () {
      const importedObject = await import('${moduleName}');
    })();`);
  resultAST.expression.argument.callee.body.body.push(...asts);
  return resultAST;
};

const handleExportNameDeclaration = (path) => {
  const outputASTs = [];
  const specifiers = path.node.specifiers;
  const declaration = path.node.declaration;
  if (specifiers && specifiers.length > 0 && (declaration === null || declaration === undefined)) {
    const specifierASTs = [];
    const source = path.node.source;
    for (const specifier of specifiers) {
      if (types.isExportSpecifier(specifier)) {
        const localName = `${source ? 'importedObject.' : ''}${specifier.local.name}`;
        const resultsAST = astCodeToAddToModuleExports(specifier.exported, localName);
        specifierASTs.push(resultsAST);
      } else if (types.isExportNamespaceSpecifier(specifier)) {
        specifierASTs.push(...wildcardExport(specifier.exported));
      }
    }
    if (source) {
      const moduleName = path.node.source.value;
      const resultAST = wrapImportedObject(moduleName, specifierASTs);
      outputASTs.push(resultAST);
    } else {
      outputASTs.push(...specifierASTs);
    }
  } else if (specifiers.length === 0 && declaration !== null) {
    outputASTs.push(declaration);
    if (types.isVariableDeclaration(declaration)) {
      for (const declarator of declaration.declarations) {
        if (types.isObjectPattern(declarator.id)) {
          console.log('isObjectPattern');
          const objectName = declarator.init.name;
          for (const property of declarator.id.properties) {
            const resultsAST = astCodeToAddToModuleExports(property.value, `${objectName}.${property.key.name}`);
            outputASTs.push(resultsAST);
          }
        } else if (types.isArrayPattern(declarator.id)) {
          let i = 0;
          const arrayName = declarator.init.name;
          for (const element of declarator.id.elements) {
            const resultsAST = astCodeToAddToModuleExports(element, `${arrayName}[${i}]`);
            outputASTs.push(resultsAST);
            ++i;
          }
        } else if (types.isIdentifier(declarator.id)) {
          const resultsAST = astCodeToAddToModuleExports(declarator.id, declarator.id.name);
          outputASTs.push(resultsAST);
        }
      }
    }
    if (types.isFunctionDeclaration(declaration) ||
      types.isClassDeclaration(declaration)) {
      const identifier = declaration.id;
      const resultsAST = astCodeToAddToModuleExports(identifier, identifier.name);
      outputASTs.push(resultsAST);
    }
  }
  path.replaceWithMultiple(outputASTs);
};

const handleExportDefaultDeclaration = (path) => {
  const outputAST = template.ast('module.exports.default = undefined');
  outputAST.expression.right = path.node.declaration;
  path.replaceWith(outputAST);
};

const handleExportAllDeclaration = (path) => {
  const moduleName = path.node.source.value;
  const lines = wildcardExport(null);
  path.replaceWith(wrapImportedObject(moduleName, lines));
};

const exportVisitor = {
  ExportNamedDeclaration: {
    exit (path) {
      handleExportNameDeclaration(path);
    }
  },
  ExportDefaultDeclaration: {
    exit (path) {
      handleExportDefaultDeclaration(path);
    }
  },
  ExportAllDeclaration: {
    exit (path) {
      handleExportAllDeclaration(path);
    }
  }
};

// TODO:
// `Extends` and `super` using https://stackoverflow.com/questions/15192722/javascript-extending-class

// ## REPL setup

/*
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
*/

let previousNodes = new Map();

// TODO: Get source mapping with something like:
// generate(ast, {sourceMaps: true, sourceFileName: "test"})
// (The `generate` API requires `sourceFileName` to be included for source maps
// to be generated.)
// Q: Can we use https://www.npmjs.com/package/babel-plugin-source-map-support
// and https://www.npmjs.com/package/source-map-support ?
// How do these work? See also https://v8.dev/docs/stack-trace-api

const changedNodesToCodeFragments = (nodes) => {
  const toWrite = [];
  const toRemove = [];
  const currentNodes = new Map();
  const updatedParentFragments = new Set();
  for (const node of nodes) {
    const fragment = generate(node, { comments: false }, '').code.trim();
    currentNodes.set(fragment, node);
    if (previousNodes.has(fragment) &&
      !(node.parentFragmentLabel &&
        updatedParentFragments.has(node.parentFragmentLabel))) {
      previousNodes.delete(fragment);
    } else {
      if (node.fragmentLabel) {
        updatedParentFragments.add(node.fragmentLabel);
      }
      toWrite.push(fragment);
    }
  }
  // Removal code for previousNodes that haven't been found in new file version.
  for (const node of previousNodes.values()) {
    if (node._removeCode) {
      toRemove.push(node._removeCode);
    }
  }
  previousNodes = currentNodes;
  return [].concat(toRemove, toWrite);
};

const evaluateCodeInRepl = (replServer, code, filename) =>
  new Promise((resolve, reject) => {
    replServer.eval(code, replServer.context, filename,
      (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
  });

const evaluateChangedCodeFragments = async (replServer, ast, filename) => {
  const fragments = changedNodesToCodeFragments(ast.program.body);
  for (const fragment of fragments) {
    await evaluateCodeInRepl(replServer, fragment, filename);
  }
};

const transform = (ast, visitors) => {
  for (const visitor of visitors) {
    traverse(ast, visitor);
  }
  return ast;
};

const prepareAST = (code) => {
  if (code.trim().length === 0) {
    return '';
  }
  const ast = parse(code);
  // console.log(varVisitor.VariableDeclaration.toString());
  return transform(ast,
    [importVisitor, exportVisitor, superVisitor, staticBlockVisitor,
      objectVisitor, classVisitor, varVisitor]);
};

const prepareCode = (code) => {
  if (code.length === 0) {
    return '';
  } else {
    return generate(prepareAST(code)).code;
  }
};

// Returns true if the inputted code is incomplete.
const unexpectedNewLine = (code, e) =>
  e &&
  e.code === 'BABEL_PARSER_SYNTAX_ERROR' &&
  e.reasonCode === 'UnexpectedToken' &&
  e.loc &&
  e.loc.index === code.length &&
  code[code.length - 1] === '\n';

const unterminatedTemplate = (code, e) =>
  e &&
  e.code === 'BABEL_PARSER_SYNTAX_ERROR' &&
  e.reasonCode === 'UnterminatedTemplate' &&
  code[code.length - 1] === '\n';

const incompleteCode = (code, e) =>
  unexpectedNewLine(code, e) || unterminatedTemplate(code, e);

const useEvalWithCodeModifications = (replServer, modifierFunction) => {
  const originalEval = replServer.eval;
  const newEval = (code, context, filename, callback) => {
    try {
      const modifiedCode = modifierFunction(code);
      if (modifiedCode.trim().length === 0) {
        return callback(null);
      }
      originalEval(modifiedCode, context, filename, callback);
    } catch (e) {
      if (incompleteCode(code, e)) {
        return callback(new repl.Recoverable(e));
      } else {
        return callback(e);
      }
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
  // Transform user input before evaluation.
  useEvalWithCodeModifications(replServer, prepareCode);
  const setGlobalsCommand = `
    __filename = '${filenameFullPath}';
    __dirname = '${path.dirname(filenameFullPath)}';
    let exports = {};
    var _IMPORT_ = { meta: ''};
  `;
  // Prepare the repl for a source file.
  evaluateCodeInRepl(replServer, prepareCode(setGlobalsCommand), filename);
  // Evaluate the source file once at start, and then every time it changes.
  watchForFileChanges(
    filename, 100,
    async (code) => {
      try {
        await evaluateChangedCodeFragments(replServer, prepareAST(code), filename);
        // Trigger preview update in case the file has updated a function
        // that will produce a new result for the pending REPL input.
        replServer._ttyWrite(null, {});
      } catch (e) {
        console.log(e);
      }
    });
};

module.exports = { run, prepareCode };
