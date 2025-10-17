const generate = require('@babel/generator').default;
const parser = require('@babel/parser');
const template = require('@babel/template').default;
const traverse = require('@babel/traverse').default;
const types = require('@babel/types');
const { sha256 } = require('./utils.js');

// TODO: const hoistVariables = require('@babel/helper-hoist-variables').default;

// Parse JS code into a babel ast.
const parse = (code) => parser.parse(code, { sourceType: 'module' });

// ## AST transformation visitors

const copyLocation = (fromNode, toNode) => {
  toNode.start = fromNode.start;
  toNode.end = fromNode.end;
  toNode.loc = fromNode.loc;
};

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
    const syncDeclarator = template.ast(`var ${identifierNames.join(', ')};`);
    copyLocation(declarator.node, syncDeclarator);
    // TODO: Make more precise by pointing to individual identifiers:
    for (const declaration of syncDeclarator.declarations) {
      copyLocation(declarator.node, declaration);
      copyLocation(declarator.node, declaration.id);
    }
    const asyncAssignment = {
      type: 'ExpressionStatement',
      expression: {
        type: 'AssignmentExpression',
        operator: '=',
        left: declarator.node.id,
        right: declarator.node.init
      }
    };
    copyLocation(declarator.node, asyncAssignment);
    const outputs = [
      syncDeclarator,
      asyncAssignment
    ];
    declarator.parentPath.replaceWithMultiple(outputs);
  }
};

const handleForOfStatement = (path) => {
  if (getEnclosingFunction(path)) {
    return;
  }
  if (path.node.await) {
    const topPath = path.find((path) => path.parentPath.isProgram());
    topPath.node._topLevelForOfAwait = true;
  }
};

const awaitVisitor = {
  AwaitExpression (path) {
    handleAwaitExpression(path);
  },
  ForOfStatement (path) {
    handleForOfStatement(path);
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
  if (namespaceId && specifiers.length > 0) {
    copyLocation(path.node, newAst[0]);
    path.replaceWithMultiple(newAst);
  } else {
    copyLocation(path.node, newAst);
    if (newAst.declarations) {
      for (let i = 0; i < newAst.declarations.length; ++i) {
        copyLocation(path.node.specifiers[i], newAst.declarations[i]);
      }
    }
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
    // For instance methods, super.property access should return undefined
    // because class fields are instance properties, not prototype properties
    path.replaceWith(template.ast('undefined'));
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
      } else if (classBodyNode.kind === 'method' ||
        classBodyNode.kind === 'get' ||
        classBodyNode.kind === 'set') {
        const keyExpression = classBodyNode.computed ? generate(classBodyNode.key).code : classBodyNode.key.name;
        const target = classBodyNode.static ? className : `${className}.prototype`;
        let fun;
        if (classBodyNode.kind === 'method') {
          const propertyAccess = classBodyNode.computed ? `[${keyExpression}]` : `.${keyExpression}`;
          templateAST = template.ast(
            `${target}${propertyAccess} = ${classBodyNode.async ? 'async ' : ''}function${classBodyNode.generator ? '*' : ''} () {}`
          );
          fun = templateAST.expression.right;
        } else {
          const propertyName = classBodyNode.computed ? keyExpression : `"${keyExpression}"`;
          templateAST = template.ast(
            `Object.defineProperty(${target}, ${propertyName}, {
               ${classBodyNode.kind}: function () { },
               configurable: true
             });`
          );
          fun = templateAST.expression.arguments[2].properties[0].value;
        }
        fun.body = classBodyNode.body;
        fun.params = classBodyNode.params;
        copyLocation(classBodyNode, templateAST);
        templateAST._removeCode = `if (${className}) { delete ${target}${classBodyNode.computed ? '[' + keyExpression + ']' : '.' + keyExpression} }`;
      } else {
        throw new Error(`Unexpected ClassMethod kind ${classBodyNode.kind}`);
      }
    } else if (classBodyNode.type === 'ClassProperty') {
      const keyExpression = classBodyNode.computed ? generate(classBodyNode.key).code : classBodyNode.key.name;
      if (classBodyNode.static) {
        // Static fields go on the class constructor
        const target = className;
        const propertyAccess = classBodyNode.computed ? `[${keyExpression}]` : `.${keyExpression}`;
        templateAST = template.ast(
          `${target}${propertyAccess} = undefined;`
        );
        copyLocation(classBodyNode, templateAST);
        if (classBodyNode.value !== null) {
          templateAST.expression.right = classBodyNode.value;
        }
        templateAST._removeCode = `if (${className}) { delete ${target}${classBodyNode.computed ? '[' + keyExpression + ']' : '.' + keyExpression} }`;
      } else {
        // Instance fields: values are stored in a WeakMap
        const propertyName = classBodyNode.computed ? keyExpression : `"${keyExpression}"`;
        templateAST = template.ast(
          `(function (initValue) {
            const valueMap = new WeakMap();
            Object.defineProperty(${className}.prototype, ${propertyName}, {
              get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
              set(newValue) { valueMap.set(this, newValue); },
              configurable: true
            });
          })(undefined);`
        );
        templateAST.expression.arguments[0] = classBodyNode.value || types.identifier('undefined');
        copyLocation(classBodyNode, templateAST);
        templateAST._removeCode = `delete ${className}.prototype[${propertyName}];`;
      }
    } else if (classBodyNode.type === 'StaticBlock') {
      templateAST = template.ast(
        `(function () {}).call(${className})`
      );
      copyLocation(classBodyNode, templateAST);
      templateAST.expression.callee.object.body = {
        type: 'BlockStatement',
        body: classBodyNode.body
      };
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
  path.parentPath.parentPath.insertAfter(outputNodes);
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
  }
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
  declaration.init.params = functionNode.params;
  copyLocation(functionNode, expression);
  copyLocation(functionNode, declaration);
  copyLocation(functionNode.id, declaration.id);
  copyLocation(functionNode, declaration.init);
  path.replaceWith(expression);
};

const handleFunctionExpression = (path) => {
  const grandparentPath = path.parentPath.parentPath;
  if (!types.isVariableDeclaration(grandparentPath) ||
      !types.isProgram(grandparentPath.parentPath)) {
    return;
  }
  const name = path.parentPath.node.id.name;
  if (grandparentPath.node._dontWrap) {
    return;
  }
  const implName = name + '_hakk_';
  path.parentPath.node.id.name = implName;
  const wrapperAST = template.ast(
    `var ${name} = (...args) => ${implName}(...args);`);
  wrapperAST._dontWrap = true;
  copyLocation(path.parentPath.node, wrapperAST.declarations[0]);
  grandparentPath.insertAfter(wrapperAST);
};

const functionVisitor = {
  FunctionDeclaration: {
    enter (path) {
      handleFunctionDeclaration(path);
    }
  },
  FunctionExpression: {
    enter (path) {
      handleFunctionExpression(path);
    }
  },
  ArrowFunctionExpression: {
    enter (path) {
      handleFunctionExpression(path);
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


const handleObjectExpression = (path) => {
  if (!isTopLevelDeclaredObject(path)) {
    return;
  }
  const originalProperties = path.node.properties;
  const name = path.parentPath.node.id.name;
  const outputASTs = [];
  let identifierNames = [];
  if (name !== undefined) {
    path.node.properties = [];
  } else {
    identifierNames = findNestedIdentifierValues(path.parentPath.node.id);
    const declarator = template.ast(`var ${identifierNames.join(', ')};`);
    path.parentPath.node.init = undefined;
    path.parentPath.parentPath.replaceWith(declarator);
  }
  for (const property of originalProperties) {
    const key = property.key;
    let ast;
    let keyExpression;
    if (types.isObjectProperty(property)) {
      // Use generate() for all key types - handles Identifier, StringLiteral, MemberExpression, BinaryExpression, etc.
      keyExpression = generate(key).code;
      if (name === undefined) {
        if (identifierNames.includes(keyExpression)) {
          ast = template.ast(`${keyExpression} = undefined;`);
        }
      } else {
        // Use bracket notation for all computed properties, dot notation for simple identifiers
        if (property.computed || !types.isIdentifier(key)) {
          ast = template.ast(`${name}[${keyExpression}] = undefined;`);
        } else {
          ast = template.ast(`${name}.${keyExpression} = undefined;`);
        }
      }
      if (ast) {
        copyLocation(property, ast);
        ast.expression.right = property.value;
        copyLocation(property, ast.expression);
        copyLocation(property.key, ast.expression.left);
      }
    } else if (types.isObjectMethod(property)) {
      // Use generate() for all key types
      keyExpression = generate(key).code;
      
      if (property.kind === 'get' || property.kind === 'set') {
        // Handle getters and setters
        if (name === undefined) {
          if (identifierNames.includes(keyExpression)) {
            ast = template.ast(`Object.defineProperty(${keyExpression}, "${keyExpression}", { ${property.kind}: function () { }, configurable: true });`);
          }
        } else {
          // For Object.defineProperty, we need the property name as a string literal
          const propertyName = types.isIdentifier(key) ? `"${key.name}"` : keyExpression;
          ast = template.ast(`Object.defineProperty(${name}, ${propertyName}, { ${property.kind}: function () { }, configurable: true });`);
        }
        if (ast) {
          copyLocation(property, ast);
          const accessor = ast.expression.arguments[2].properties[0].value;
          accessor.body = property.body;
          accessor.params = property.params;
        }
      } else {
        // Handle regular methods
        if (name === undefined) {
          if (identifierNames.includes(keyExpression)) {
            ast = template.ast(`${keyExpression} = function () { };`);
          }
        } else {
          // Use bracket notation for computed properties, dot notation for simple identifiers
          if (property.computed || !types.isIdentifier(key)) {
            ast = template.ast(`${name}[${keyExpression}] = function () { };`);
          } else {
            ast = template.ast(`${name}.${keyExpression} = function () { };`);
          }
        }
        if (ast) {
          copyLocation(property, ast);
          const expressionRight = ast.expression.right;
          expressionRight.params = property.params;
          expressionRight.async = property.async;
          expressionRight.generator = property.generator;
          expressionRight.body = property.body;
          copyLocation(property.body, ast.expression);
          copyLocation(property.key, ast.expression.left);
        }
      }
    } else {
      throw new Error(`Unexpected object member '${property.type}'.`);
    }
    
    if (ast) {
      if (types.isIdentifier(key)) {
        ast._removeCode = `delete ${name || key.name}['${key.name}']`;
      } else {
        ast._removeCode = `delete ${name}[${keyExpression}]`;
      }
      outputASTs.push(ast);
    }
  }
  path.parentPath.parentPath.insertAfter(outputASTs);
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
            copyLocation(property, resultsAST);
            outputASTs.push(resultsAST);
          }
        } else if (types.isArrayPattern(declarator.id)) {
          let i = 0;
          const arrayName = declarator.init.name;
          for (const element of declarator.id.elements) {
            const resultsAST = astCodeToAddToModuleExports(element, `${arrayName}[${i}]`);
            copyLocation(element, resultsAST);
            outputASTs.push(resultsAST);
            ++i;
          }
        } else if (types.isIdentifier(declarator.id)) {
          const resultsAST = astCodeToAddToModuleExports(declarator.id, declarator.id.name);
          copyLocation(declarator, resultsAST);
          outputASTs.push(resultsAST);
        }
      }
    }
    if (types.isFunctionDeclaration(declaration) ||
      types.isClassDeclaration(declaration)) {
      const identifier = declaration.id;
      const resultsAST = astCodeToAddToModuleExports(identifier, identifier.name);
      copyLocation(declaration, resultsAST);
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

const functionDeclarationsFirst = (nodes) => {
  const head = [];
  const tail = [];
  for (const node of nodes) {
    if (types.isFunctionDeclaration(node)) {
      head.push(node);
    } else {
      tail.push(node);
    }
  }
  return [...head, ...tail];
};

const prepareAST = (code) => {
  if (code.trim().length === 0) {
    return '';
  }
  const ast = parse(code);
  ast.program.body = functionDeclarationsFirst(ast.program.body);
  return transform(ast,
    [importVisitor, exportVisitor, superVisitor,
      objectVisitor, classVisitor,
      awaitVisitor, functionVisitor, varVisitor]);
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

const findCodeToRemove = (previousNodes, addedOrChangedVarsSeen) => {
  // Removal code for previousNodes that haven't been found in new version.
  const toRemove = [];
  for (const node of previousNodes.values()) {
    if (node._removeCode) {
      const deletedVars = node._definedVars ? node._definedVars.filter(v => !addedOrChangedVarsSeen.includes(v)) : undefined;
      // Remove in reverse order:
      toRemove.unshift({ code: node._removeCode, isAsync: false, deletedVars });
    }
  }
  return toRemove;
};

const findVarsToDeclare = (addedOrChangedVarsSeen) => {
  // Any defined variables should be declared at the top because sometimes
  // vars are referenced forward.
  const toDeclare = [];
  if (addedOrChangedVarsSeen.length > 0) {
    const declareFirstFragment = {
      code: `var ${addedOrChangedVarsSeen.join(', ')};`,
      isAsync: false
    };
    toDeclare.unshift(declareFirstFragment);
  }
  return toDeclare;
};

const getCodeAndOriginalOffset = (node, filePath) => {
  const { code: codeRaw, rawMappings } = generate(node, {
    comments: true, retainLines: true, sourceMaps: true, sourceFileName: filePath
  }, '');
  const code = codeRaw.trim();
  let originalOffset;
  try {
    originalOffset = rawMappings[0].original.line;
  } catch (e) {
    console.log('Failed to compute offset: ', code, node);
    originalOffset = 0;
  }
  return { code, originalOffset };
};

const changedNodesToCodeFragments = (previousNodes, nodes, filePath) => {
  const currentNodes = new Map();
  const updatedParentLabels = new Set();
  const toWrite = [];
  const addedOrChangedVarsSeen = [];
  const offsetsMap = {};
  for (const node of nodes) {
    const { code, originalOffset } = getCodeAndOriginalOffset(node, filePath);
    const codeNormalized = code.replace(/\s+/g, ' ');
    const codeHash = sha256(filePath + '\n' + code).substring(0, 16);
    const tracker = filePath + '|' + codeHash;
    offsetsMap[codeHash] = originalOffset;
    currentNodes.set(codeNormalized, node);
    if (previousNodes.has(codeNormalized) &&
      !(node._parentLabel &&
        updatedParentLabels.has(node._parentLabel))) {
      previousNodes.delete(codeNormalized);
    } else {
      if (node._segmentLabel) {
        updatedParentLabels.add(node._segmentLabel);
      }
      toWrite.push({
        code,
        isAsync: node._topLevelAwait || node._topLevelForOfAwait,
        addedOrChangedVars: node._definedVars,
        tracker
      });
      addedOrChangedVarsSeen.push(...(node._definedVars ?? []));
    }
  }
  const toRemove = findCodeToRemove(previousNodes, addedOrChangedVarsSeen);
  const toDeclare = findVarsToDeclare(addedOrChangedVarsSeen);
  const fragments = [...toDeclare, ...toRemove, ...toWrite];
  return { fragments, latestNodes: currentNodes, offsetsMap };
};

module.exports = { generate, parse, prepareAstNodes, prepareCode, prepareAST, changedNodesToCodeFragments };
