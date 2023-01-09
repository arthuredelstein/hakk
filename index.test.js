const { prepareCode } = require('./index.js');

const cleanString = (x) =>
  x.replace(/\s+/g, ' ');

const testTransform = (description, before, after) =>
  test(description, () => {
    expect(cleanString(prepareCode(before)))
      .toBe(cleanString(after));
  });

testTransform('const changed to var', 'const x = 1;', 'var x = 1;');

testTransform('let changed to var', 'let x = 1;', 'var x = 1;');

testTransform('class declaration changed to class expression',
  'class A {}', 'var A = class A {};');

testTransform('hoist class method',
  `class A {
    method1(a, b) {
      return a + b;
    }
  }`,
  `var A = class A {};
  A.prototype.method1 = function (a, b) {
    return a + b;
  };`);

testTransform('hoist class field',
  `class A {
    field1 = 3;
  }`,
  `var A = class A {};
  A.prototype.field1 = 3;`);

testTransform('mangle private method',
  `class A {
    #method1(a, b) {
      return a + b;
    }
  }`,
  `var A = class A {};
  A.prototype._PRIVATE_method1 = function (a, b) {
    return a + b;
  };`);

testTransform('mangle private field',
`class A {
  #field1 = 7;
}`,
`var A = class A {};
A.prototype._PRIVATE_field1 = 7;`);

testTransform('keep the original constructor',
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

testTransform('split compound declaration into simple',
  'const x = 1, y = 2, z = 3;',
  `var x = 1;
   var y = 2;
   var z = 3;`);

testTransform('import default',
  'import defaultExport from "module-name";',
  "var { default: defaultExport } = await import('module-name');");

testTransform('import wildcard',
  'import * as name from "module-name";',
  "var name = await import('module-name');");

testTransform('import with simple export',
  'import { export1 } from "module-name";',
  "var { export1 } = await import('module-name');");

testTransform('import with simple alias',
  'import { export1 as alias1 } from "module-name";',
  "var { export1: alias1 } = await import('module-name');");

testTransform('import with default as alias',
  'import { default as alias } from "module-name";',
  "var { default: alias } = await import('module-name');");

testTransform('import with multiple exports',
  'import { export1, export2 } from "module-name";',
  "var { export1, export2 } = await import('module-name');");

testTransform('import with multiple exports and one alias',
  'import { export1, export2 as alias2 } from "module-name";',
  "var { export1, export2: alias2 } = await import('module-name');");

testTransform('import with a string alias',
  'import { "string name" as alias } from "module-name";',
  "var { 'string name': alias } = await import('module-name');");

testTransform('import default, plus one export',
  'import defaultExport, { export1 } from "module-name";',
  "var { default: defaultExport, export1 } = await import('module-name');");

testTransform('import default and wildcard',
  'import defaultExport, * as name from "module-name";',
  `var name = await import('module-name');
  var { default: defaultExport } = name;`);

testTransform('import just the module',
  'import "module-name";',
  "await import('module-name');");

testTransform('named exports, simple',
  'let x = 1, y = 2; export { x, y }',
  'var x = 1; var y = 2; module.exports.x = x; module.exports.y = y;')

testTransform('named exports with aliases',
  'let x = 1, y = 2; export { x as name1, y as name2}',
  'var x = 1; var y = 2; module.exports.name1 = x; module.exports.name2 = y;');

testTransform('named exports with string aliases',
  'let x = 1, y = 2; export { x as "name1", y as "name2"}',
  'var x = 1; var y = 2; module.exports[\'name1\'] = x; module.exports[\'name2\'] = y;');

testTransform('named export as default',
  'let x = 1; export { x as default}',
  'var x = 1; module.exports.default = x;');