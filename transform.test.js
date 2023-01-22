/* eslint-env jest */

const { prepareCode } = require('./transform.js');

const cleanString = (x) =>
  x.replace(/\s+/g, ' ');

const testTransform = (before, after) =>
  test(cleanString(before), () => {
    expect(cleanString(prepareCode(before)))
      .toBe(cleanString(after));
  });

// ## variable declarations

testTransform('const x = 1;', 'var x = 1;');

testTransform('let x = 1;', 'var x = 1;');

testTransform('var x = await Promise.resolve(1);', 'var x; x = await Promise.resolve(1);');

testTransform('let x = await Promise.resolve(2);', 'var x; x = await Promise.resolve(2);');

testTransform('const x = await Promise.resolve(3);', 'var x; x = await Promise.resolve(3);');

testTransform('const f = async() => { await Promise.resolve(4); }', 'var f = async () => { await Promise.resolve(4); };');

testTransform('const f = async() => { var y = await Promise.resolve(4); }', 'var f = async () => { var y = await Promise.resolve(4); };');

// ## class declarations and expressions

testTransform('class A {}', 'var A = class A {};');

testTransform(
  `class A {
    method1(a, b) {
      return a + b;
    }
  }`,
  `var A = class A {};
  A.prototype.method1 = function (a, b) {
    return a + b;
  };`);

testTransform(
  `class A {
    field1 = 3;
  }`,
  `var A = class A {};
  A.prototype.field1 = 3;`);

testTransform(
  `class A {
    #method1(a, b) {
      return a + b;
    }
  }`,
  `var A = class A {};
  A.prototype._PRIVATE_method1 = function (a, b) {
    return a + b;
  };`);

testTransform(
  `class A {
  #field1 = 7;
}`,
  `var A = class A {};
A.prototype._PRIVATE_field1 = 7;`);

testTransform(
  `class A extends B {
  constructor(b, a) {
    super(a, b);
  }
  method1(x) {
    return x;
  }
}`,
  `var A = class A extends B {
  constructor(b, a) {
    super(a, b);
  }
};
A.prototype.method1 = function (x) {
  return x;
};`);

testTransform(
  'const x = 1, y = 2, z = 3;',
  `var x = 1;
   var y = 2;
   var z = 3;`);

// ## `import` syntax
// Testing all cases in
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#syntax

testTransform('import defaultExport from "module-name";',
  "var defaultExport; ({ default: defaultExport } = await __import('module-name'));");

testTransform('import * as name from "module-name";',
  "var name; name = await __import('module-name');");

testTransform('import { export1 } from "module-name";',
  "var export1; ({ export1 } = await __import('module-name'));");

testTransform('import { export1 as alias1 } from "module-name";',
  "var alias1; ({ export1: alias1 } = await __import('module-name'));");

testTransform('import { default as alias } from "module-name";',
  "var alias; ({ default: alias } = await __import('module-name'));");

testTransform('import { export1, export2 } from "module-name";',
  "var export1, export2; ({ export1, export2 } = await __import('module-name'));");

testTransform('import { export1, export2 as alias2 } from "module-name";',
  "var export1, alias2; ({ export1, export2: alias2 } = await __import('module-name'));");

testTransform('import { "string name" as alias } from "module-name";',
  "var alias; ({ 'string name': alias } = await __import('module-name'));");

testTransform('import defaultExport, { export1 } from "module-name";',
  "var defaultExport, export1; ({ default: defaultExport, export1 } = await __import('module-name'));");

testTransform('import defaultExport, * as name from "module-name";',
  `var name; name = await __import('module-name');
  var { default: defaultExport } = name;`);

testTransform('import "module-name";',
  "await __import('module-name');");

// ## `export` syntax
// TODO: Test all cases shown in
// https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export#syntax

// ### Exporting declarations

testTransform('export let name1, name2',
  `var name1;
   var name2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform('export const name1 = 1, name2 = 2;',
  `var name1 = 1;
   var name2 = 2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform('export function functionName() { /* … */ }',
  `function functionName() {/* … */}
  module.exports.functionName = functionName;`);

testTransform('export class ClassName { /* … */ }',
  `var ClassName = class ClassName {/* … */};
  module.exports.ClassName = ClassName;`);

testTransform('export function* generatorFunctionName() { /* … */ }',
  `function* generatorFunctionName() {/* … */}
  module.exports.generatorFunctionName = generatorFunctionName;`);

testTransform('export const { name1, name2: bar } = o;',
  `var { name1, name2: bar } = o;
   module.exports.name1 = o.name1;
   module.exports.bar = o.name2;`);

testTransform('export const [ name1, name2 ] = array;',
  `var [name1, name2] = array;
   module.exports.name1 = array[0];
   module.exports.name2 = array[1];`);

// ### Export list

testTransform('let x = 1, y = 2; export { x, y }',
  'var x = 1; var y = 2; module.exports.x = x; module.exports.y = y;');

testTransform('let x = 1, y = 2; export { x as name1, y as name2}',
  'var x = 1; var y = 2; module.exports.name1 = x; module.exports.name2 = y;');

testTransform('let x = 1, y = 2; export { x as "name1", y as "name2"}',
  'var x = 1; var y = 2; module.exports[\'name1\'] = x; module.exports[\'name2\'] = y;');

testTransform('let x = 1; export { x as default}',
  'var x = 1; module.exports.default = x;');

// ### Default exports

testTransform('export default expression;',
  'module.exports.default = expression;');

testTransform('export default function functionName() { /* … */ }',
  'module.exports.default = function functionName() {/* … */};');

testTransform('export default class ClassName { /* … */ }',
  'module.exports.default = class ClassName {/* … */};');

testTransform('export default function* generatorFunctionName() { /* … */ }',
  'module.exports.default = function* generatorFunctionName() {/* … */};');

testTransform('export default function () { /* … */ }',
  'module.exports.default = function () {/* … */};');

testTransform('export default class { /* … */ }',
  'module.exports.default = class {/* … */};');

testTransform('export default function* () { /* … */ }',
  'module.exports.default = function* () {/* … */};');

// ### Aggregating modules

testTransform('export * from "my-module-name"',
  `await async function () {
    const importedObject = await __import('my-module-name');
    const propertyNames = Object.getOwnPropertyNames(importedObject);
    for (const propertyName of propertyNames) {
      if (propertyName !== 'default') {
        module.exports[propertyName] = importedObject[propertyName];
      }
    }
  }();`);

testTransform('export * as name1 from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    const propertyNames = Object.getOwnPropertyNames(importedObject);
    for (const propertyName of propertyNames) {
      if (propertyName !== 'default') {
        module.exports.name1[propertyName] = importedObject[propertyName];
      }
    }
  }();`);

testTransform('export { name1, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.name1;
    module.exports.nameN = importedObject.nameN;
  }();`);

testTransform('export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.import1;
    module.exports.name2 = importedObject.import2;
    module.exports.nameN = importedObject.nameN;
}();`);

testTransform('export { default, /* …, */ } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.default = importedObject.default;
}();`);
