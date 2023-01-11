const { prepareCode } = require('./index.js');

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
  "var { default: defaultExport } = await import('module-name');");

testTransform('import * as name from "module-name";',
  "var name = await import('module-name');");

testTransform('import { export1 } from "module-name";',
  "var { export1 } = await import('module-name');");

testTransform('import { export1 as alias1 } from "module-name";',
  "var { export1: alias1 } = await import('module-name');");

testTransform('import { default as alias } from "module-name";',
  "var { default: alias } = await import('module-name');");

testTransform('import { export1, export2 } from "module-name";',
  "var { export1, export2 } = await import('module-name');");

testTransform('import { export1, export2 as alias2 } from "module-name";',
  "var { export1, export2: alias2 } = await import('module-name');");

testTransform('import { "string name" as alias } from "module-name";',
  "var { 'string name': alias } = await import('module-name');");

testTransform('import defaultExport, { export1 } from "module-name";',
  "var { default: defaultExport, export1 } = await import('module-name');");

testTransform('import defaultExport, * as name from "module-name";',
  `var name = await import('module-name');
  var { default: defaultExport } = name;`);

testTransform('import "module-name";',
  "await import('module-name');");

// ## `export` syntax
// TODO: Test all cases shown in
// https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export#syntax

testTransform('let x = 1, y = 2; export { x, y }',
  'var x = 1; var y = 2; module.exports.x = x; module.exports.y = y;');

testTransform('let x = 1, y = 2; export { x as name1, y as name2}',
  'var x = 1; var y = 2; module.exports.name1 = x; module.exports.name2 = y;');

testTransform('let x = 1, y = 2; export { x as "name1", y as "name2"}',
  'var x = 1; var y = 2; module.exports[\'name1\'] = x; module.exports[\'name2\'] = y;');

testTransform('let x = 1; export { x as default}',
  'var x = 1; module.exports.default = x;');

testTransform('export * from "my-module-name"',
  `(function () {
    const requireObject = require('my-module-name');
    const propertyNames = Object.getOwnPropertyNames(requireObject);
    for (const propertyName of propertyNames) {
      if (propertyName !== 'default') {
        module.exports[propertyName] = requireObject[propertyName];
      }
    }
  })();`);
