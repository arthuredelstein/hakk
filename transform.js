const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
const staticBlockPlugin = require('@babel/plugin-proposal-class-static-block').default;
const { sha256 } = require('./utils.js');

// TODO: const hoistVariables = require('@babel/helper-hoist-variables').default;

// Parse JS code into a babel ast.
const parse = (code) => parser.parse(code, { sourceType: 'module' });

// ## AST transformation visitors

const copyLocation = (fromNode, toNode) => {
  toNode.start = fromNode.start;
  toNode.end = fromNode.end;
  toNode.loc = fromNode.loc;
}

const getEnclosingFunction = path => path.findParent((path) => path.isFunction());

const getEnclosingVariableDeclarator = path => path.findParent((path) => path.isVariableDeclarator());

const findNestedIdentifierValues = (node) => {
  const identifierValuesFound = [];
  if (types.isObjectPattern(node)) {
    for (const property of node.properties) {
      if (types.isIdentifier(property.value)) {
        identifierValuesFound.push(property.value.name);
      } else {
        const moreValuesFound = findNestedIdentifierValues(property.value);
        identifierValuesFound.push(...moreValuesFound);
      }
    }
  } else if (types.isArrayPattern(node)) {
    for (const element of node.elements) {
      if (types.isIdentifier(element)) {
        identifierValuesFound.push(element.name);
      } else {
        const moreValuesFound = findNestedIdentifierValues(element);
        identifierValuesFound.push(...moreValuesFound);
      }
    }
  } else if (types.isIdentifier(node)) {
    identifierValuesFound.push(node.name);
  }
  return identifierValuesFound;
};

const handleAwaitExpression = (path) => {
  if (getEnclosingFunction(path)) {
    return;
  }
  const topPath = path.find((path) => path.parentPath.isProgram());
  topPath.node._topLevelAwait = true;
  const declarator = getEnclosingVariableDeclarator(path);
  if (declarator) {
    if (!types.isProgram(declarator.parentPath.parentPath)) {
      return;
    }
    const identifierNames = findNestedIdentifierValues(declarator.node.id);
    const syncDeclarator = template.ast(`var ${identifierNames.join(', ')};`)
    copyLocation(declarator, syncDeclarator);
    const asyncAssignment = {
      type: 'ExpressionStatement',
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: declarator.node.id,
        right: declarator.node.init
      }
    };
    copyLocation(declaration.node.id, asyncAssignment);
    const outputs = [
      syncDeclarator,
      asyncAssignment
    ];
    declarator.parentPath.replaceWithMultiple(outputs);
  }
};

const awaitVisitor = {
  AwaitExpression (path) {
    handleAwaitExpression(path);
  }
};

const handleVariableDeclarationEnter = (path) => {
  if (!types.isProgram(path.parentPath)) {
    return;
  }
  if (path.node.kind !== 'var' || path.node.declarations.length > 1) {
    const outputNodes = path.node.declarations.map(
      d => types.variableDeclaration('var', [d]));
    for (let i = 0; i < path.node.declarations.length; ++i) {
      copyLocation(path.node.declarations[i], outputNodes[i]);
    }
    path.replaceWithMultiple(outputNodes);
  }
};

const handleVariableDeclarationExit = (path) => {
  if (!types.isProgram(path.parentPath)) {
    return;
  }
  const identifierValues = [];
  for (const declarator of path.node.declarations) {
    identifierValues.push(...findNestedIdentifierValues(declarator.id));
  }
  path.node._definedVars = identifierValues;
  path.node._removeCode = identifierValues
    .map(identifier => `${identifier} = undefined;`)
    .join('\n');
};

const handleCallExpressionWithRequireOrImport = (path) => {
  if (path.node.callee && types.isImport(path.node.callee)) {
    path.node.callee.type = 'Identifier';
    path.node.callee.name = '__import';
  }
  if (getEnclosingFunction(path)) {
    return;
  }
  const topPath = path.find((path) => path.parentPath.isProgram());
  if (path.node.callee && path.node.arguments[0]) {
    const firstArgument = path.node.arguments[0].value;
    if (path.node.callee.name === '__import') {
      topPath.node._topLevelImport = firstArgument;
    }
    if (path.node.callee.name === 'require') {
      topPath.node._topLevelRequire = firstArgument;
    }
  }
};

const varVisitor = {
  VariableDeclaration: {
    enter (path) {
      handleVariableDeclarationEnter(path);
    },
    exit (path) {
      handleVariableDeclarationExit(path);
    }
  },
  CallExpression: {
    exit (path) {
      handleCallExpressionWithRequireOrImport(path);
    }
  }
};

const handleImportDotMeta = (path) => {
  if (path.node.meta.name === 'import') {
    const originalPathNode = path.node;
    path.replaceWith(template.ast('__import.meta'));
    copyLocation(originalPathNode, path.node);
    copyLocation(originalPathNode.meta, path.node.object);
    copyLocation(originalPathNode.property, path.node.property);
  }
};

const handleImportDeclaration = (path) => {
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
  const sourceString = `await __import('${source}')`;
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
  copyLocation(path.node, newAst);
  if (namespaceId && specifiers.length > 0) {
    path.replaceWithMultiple(newAst);
  } else {
    path.replaceWith(newAst);
  }
};

const importVisitor = {
  MetaProperty (path) {
    handleImportDotMeta(path);
  },
  ImportDeclaration (path) {
    handleImportDeclaration(path);
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

const handleCallExpressionEnter = (path) => {
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
  copyLocation(path.node, ast);
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
        copyLocation(classBodyNode, templateAST);
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
        copyLocation(classBodyNode, templateAST);
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
      copyLocation(classBodyNode, templateAST);
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
    outputNode._parentLabel = className;
  });
  return { retainedNodes, outputNodes };
};

const handleClassExpression = (path) => {
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
  path.parentPath.parentPath.node._segmentLabel = className;
  for (const outputNode of outputNodes) {
    path.parentPath.parentPath.insertAfter(outputNode);
  }
};

const handleClassDeclaration = (path) => {
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
  copyLocation(classNode, expression);
  copyLocation(classNode, declaration.init);
  copyLocation(classNode.id, declaration.id);
  path.replaceWith(expression);
};

const handleFunctionDeclaration = (path) => {
  if (!types.isProgram(path.parentPath)) {
    return;
  }
  const functionNode = path.node;
  const expression = template.ast('var aFunction = function aFunction () {}');
  const declaration = expression.declarations[0];
  declaration.id.name = functionNode.id.name;
  declaration.init.id.name = functionNode.id.name;
  declaration.init.body = functionNode.body;
  declaration.init.async = functionNode.async;
  declaration.init.generator = functionNode.generator;
  copyLocation(functionNode, expression);
  copyLocation(functionNode, declaration);
  copyLocation(functionNode.id, declaration.id);
  copyLocation(functionNode, declaration.init);
  path.replaceWith(expression);
};

const handlePrivateName = (path) => {
  path.replaceWith(path.node.id);
  path.node.name = '_PRIVATE_' + path.node.name;
};

// Make class declarations mutable by transforming to class
// expressions assigned to a var, with member declarations
// hoisted out of the class body.
const classVisitor = {
  PrivateName: {
    enter (path) {
      handlePrivateName(path);
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
      handleClassExpression(path);
    }
  },
  ClassDeclaration: {
    enter (path) {
      handleClassDeclaration(path);
    }
  },
  FunctionDeclaration: {
    enter (path) {
      handleFunctionDeclaration(path);
    }
  }
};

const superVisitor = {
  CallExpression: {
    enter (path) {
      handleCallExpressionEnter(path);
    }
  },
  MemberExpression (path) {
    handleMemberExpression(path);
  }
};

const staticBlockVisitor = staticBlockPlugin({ types, template, assertVersion: () => undefined }).visitor;

const handleObjectExpression = (path) => {
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
        copyLocation(property, ast);
      }
      if (types.isStringLiteral(key)) {
        ast = template.ast(`${name}['${key.value}'] = undefined;`);
        copyLocation(property, ast);
      }
      ast.expression.right = property.value;
      copyLocation(property, ast.expression);
      copyLocation(property.key, ast.expression.left);
    } else if (types.isObjectMethod(property)) {
      if (types.isIdentifier(key)) {
        ast = template.ast(`${name}.${key.name} = function () { };`);
        copyLocation(property, ast)
        const expressionRight = ast.expression.right;
        expressionRight.params = property.params;
        expressionRight.async = property.async;
        expressionRight.generator = property.generator;
        expressionRight.body = property.body;
        copyLocation(property.body, ast.expression);
        copyLocation(property.key, ast.expression.left);
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
};

const objectVisitor = {
  ObjectExpression (path) {
    handleObjectExpression(path);
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
      const importedObject = await __import('${moduleName}');
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
        copyLocation(specifier, resultsAST);
        specifierASTs.push(resultsAST);
      } else if (types.isExportNamespaceSpecifier(specifier)) {
        specifierASTs.push(...wildcardExport(specifier.exported));
        copyLocation(specifier, specifiers);
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
  if (outputASTs.length > 0) {
    copyLocation(path.node, outputASTs[0]);
  }
  path.replaceWithMultiple(outputASTs);
};

const handleExportDefaultDeclaration = (path) => {
  const outputAST = template.ast('module.exports.default = undefined');
  outputAST.expression.right = path.node.declaration;
  copyLocation(path.node, outputAST);
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
  return transform(ast,
    [importVisitor, exportVisitor, superVisitor, staticBlockVisitor,
      objectVisitor, classVisitor, awaitVisitor, varVisitor]);
};

const prepareCode = (code) => {
  if (code.length === 0) {
    return '';
  } else {
    return generate(prepareAST(code)).code;
  }
};

const prepareAstNodes = (code) => {
  if (code.length === 0) {
    return [];
  } else {
    const program = prepareAST(code).program;
    return program ? program.body : [];
  }
};

const changedNodesToCodeFragments = (previousNodes, nodes, filePath) => {
  const currentNodes = new Map();
  const updatedParentLabels = new Set();
  const toWrite = [];
  const addedOrChangedVarsSeen = [];
  const offsetsMap = {};
  for (const node of nodes) {
    const { code: codeRaw, rawMappings } = generate(node, {
      comments: true, retainLines: true, sourceMaps: true, sourceFileName: filePath
    }, '');
    const code = codeRaw.trim();
    const originalOffset = rawMappings[0].original.line;
    const codeHash = sha256(filePath + "\n" + code).substring(0,16);
    const tracker = filePath + "|" + codeHash;
    offsetsMap[codeHash] = originalOffset;
    currentNodes.set(code, node);
    if (previousNodes.has(code) &&
      !(node._parentLabel &&
        updatedParentLabels.has(node._parentLabel))) {
      previousNodes.delete(code);
    } else {
      if (node._segmentLabel) {
        updatedParentLabels.add(node._segmentLabel);
      }
      toWrite.push({
        code,
        isAsync: node._topLevelAwait,
        addedOrChangedVars: node._definedVars,
        tracker,
      });
      addedOrChangedVarsSeen.push(...(node._definedVars ?? []));
    }
  }
  // Removal code for previousNodes that haven't been found in new version.
  const toRemove = [];
  for (const node of previousNodes.values()) {
    if (node._removeCode) {
      const deletedVars = node._definedVars ? node._definedVars.filter(v => !addedOrChangedVarsSeen.includes(v)) : undefined;
      toRemove.push({ code: node._removeCode, isAsync: false, deletedVars });
    }
  }
  const fragments = [...toRemove, ...toWrite];
  return { fragments, latestNodes: currentNodes, offsetsMap };
};

module.exports = { generate, parse, prepareAstNodes, prepareCode, prepareAST, changedNodesToCodeFragments };
