/* eslint-env jest */

const { prepareCode } = require('./transform.js');

const cleanString = (x) =>
  x.replace(/\s+/g, ' ');

const testTransform = (name, before, after) =>
  test(name, () => {
    expect(cleanString(prepareCode(before)))
      .toBe(cleanString(after));
  });

// ## variable declarations

testTransform('convert const to var', 'const x = 1;', 'var x = 1;');

testTransform('convert let to var', 'let x = 1;', 'var x = 1;');

testTransform('convert var assignment to await to two statements','var x = await Promise.resolve(1);', 'var x; x = await Promise.resolve(1);');

testTransform('convert let assignment to await to two statements', 'let x = await Promise.resolve(2);', 'var x; x = await Promise.resolve(2);');

testTransform('convert const assignment to await to two statements', 'const x = await Promise.resolve(3);', 'var x; x = await Promise.resolve(3);');

testTransform(
  'convert multiple variable declarations to var',
  'const x = 1, y = 2, z = 3;',
  `var x = 1;
    var y = 2;
    var z = 3;`);

// ## function declarations

testTransform('add a layer of indirection to an async function',
  'const f = async() => { await Promise.resolve(4); }',
  `var f_hakk_ = async () => { await Promise.resolve(4); };
  var f = (...args) => f_hakk_(...args);`);

testTransform('add a layer of indirection to an async function with a variable assignment',
  'const f = async() => { var y = await Promise.resolve(4); }',
  `var f_hakk_ = async () => { var y = await Promise.resolve(4); };
  var f = (...args) => f_hakk_(...args);`);

// ## class declarations and expressions

testTransform('convert class declaration to class expression',
  'class A {}', 'var A = class A {};');

testTransform(
  'convert class method declaration to class expression',
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
  'convert class field declaration to class expression',
  `class A {
    field1 = 3;
  }`,
  `var A = class A {};
  A.prototype.field1 = 3;`);

testTransform(
  'convert class private method declaration to class expression',
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
  'convert class private field declaration to class expression',
  `class A {
  #field1 = 7;
}`,
  `var A = class A {};
A.prototype._PRIVATE_field1 = 7;`);

testTransform(
  'convert class extends declaration to class expression',
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
  'convert static block to IIFE call',
  `class Counter {
    static count = 0;
    static {
      this.count = 42;
    }
  }`,
  `var Counter = class Counter {};
  Counter.count = 0;
  (function () {
    this.count = 42;
  }).call(Counter);`);

testTransform(
  'ensure static fields and static blocks are evaluated in the correct order',
  `class Config {
    static a = 1;
    static b = 2;
    static c = 3;
    static {
      this.a = 4;
      this.b = 5;
      this.c = 6;
    }
    static d = 7;
  }`,
  `var Config = class Config {};
  Config.a = 1;
  Config.b = 2;
  Config.c = 3;
  (function () {
    this.a = 4;
    this.b = 5;
    this.c = 6;
  }).call(Config);
  Config.d = 7;`);

testTransform(
  'convert static method declaration to class expression',
  `class Utils {
    static helper() {
      return 'help';
    }
  }`,
  `var Utils = class Utils {};
  Utils.helper = function () {
    return 'help';
  };`);

testTransform(
  'convert static field declaration to class expression',
  `class Config {
    static version = '1.0.0';
  }`,
  `var Config = class Config {};
  Config.version = '1.0.0';`);

testTransform(
  'convert static getter declaration to class expression',
  `class Data {
    static get info() {
      return { name: 'test' };
    }
  }`,
  `var Data = class Data {};
  Object.defineProperty(Data, "info", {
    get: function () {
      return { name: 'test' };
    },
    configurable: true
  });`);

testTransform(
  'convert static setter declaration to class expression',
  `class Data {
    static set value(v) {
      this._value = v;
    }
  }`,
  `var Data = class Data {};
  Object.defineProperty(Data, "value", {
    set: function (v) {
      this._value = v;
    },
    configurable: true
  });`);

testTransform(
  'convert class with mixed static and instance members',
  `class Example {
    static staticField = 'static';
    instanceField = 'instance';
    static staticMethod() {
      return 'static method';
    }
    instanceMethod() {
      return 'instance method';
    }
  }`,
  `var Example = class Example {};
  Example.staticField = 'static';
  Example.prototype.instanceField = 'instance';
  Example.staticMethod = function () {
    return 'static method';
  };
  Example.prototype.instanceMethod = function () {
    return 'instance method';
  };`);

testTransform(
  'convert class with private static field',
  `class Data {
    static #secret = 'hidden';
  }`,
  `var Data = class Data {};
  Data._PRIVATE_secret = 'hidden';`);

testTransform(
  'convert class with private static method',
  `class Utils {
    static #helper() {
      return 'private help';
    }
  }`,
  `var Utils = class Utils {};
  Utils._PRIVATE_helper = function () {
    return 'private help';
  };`);

testTransform(
  'convert class with private static getter',
  `class Config {
    static get #value() {
      return this._internal;
    }
  }`,
  `var Config = class Config {};
  Object.defineProperty(Config, "_PRIVATE_value", {
    get: function () {
      return this._internal;
    },
    configurable: true
  });`);

testTransform(
  'convert class with private static setter',
  `class Config {
    static set #value(v) {
      this._internal = v;
    }
  }`,
  `var Config = class Config {};
  Object.defineProperty(Config, "_PRIVATE_value", {
    set: function (v) {
      this._internal = v;
    },
    configurable: true
  });`);

testTransform(
  'convert class with mixed private static and instance members',
  `class Example {
    static #staticPrivate = 'static private';
    #instancePrivate = 'instance private';
    static #staticPrivateMethod() {
      return 'static private method';
    }
    #instancePrivateMethod() {
      return 'instance private method';
    }
  }`,
  `var Example = class Example {};
  Example._PRIVATE_staticPrivate = 'static private';
  Example.prototype._PRIVATE_instancePrivate = 'instance private';
  Example._PRIVATE_staticPrivateMethod = function () {
    return 'static private method';
  };
  Example.prototype._PRIVATE_instancePrivateMethod = function () {
    return 'instance private method';
  };`);

testTransform(
  'convert class with computed property names',
  `const key = 'dynamic';
  class Example {
    [key] = 'value';
    ['static'] = 'static value';
    [key]() {
      return 'method';
    }
  }`,
  `var key = 'dynamic';
  var Example = class Example {};
  Example.prototype[key] = 'value';
  Example.prototype['static'] = 'static value';
  Example.prototype[key] = function () {
    return 'method';
  };`);

testTransform(
  'convert class with computed static property names',
  `const methodName = 'helper';
  class Utils {
    static [methodName]() {
      return 'help';
    }
    static ['version'] = '1.0.0';
  }`,
  `var methodName = 'helper';
  var Utils = class Utils {};
  Utils[methodName] = function () {
    return 'help';
  };
  Utils['version'] = '1.0.0';`);

// ## super keyword handling

testTransform(
  'convert super method call in instance method',
  `class Child extends Parent {
    method() {
      return super.parentMethod('arg');
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.method = function () {
    return Parent.prototype.parentMethod.call(this, 'arg');
  };`);

testTransform(
  'convert super method call in static method',
  `class Child extends Parent {
    static staticMethod() {
      return super.parentStaticMethod('arg');
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.staticMethod = function () {
    return Parent.parentStaticMethod.call('arg');
  };`);

testTransform(
  'convert super property access in static method',
  `class Child extends Parent {
    static getValue() {
      return super.staticProperty;
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.getValue = function () {
    return Parent.staticProperty;
  };`);

testTransform(
  'convert super property access in instance method',
  `class Child extends Parent {
    getValue() {
      return super.instanceProperty;
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.getValue = function () {
    return Parent.prototype.instanceProperty;
  };`);

testTransform(
  'convert super method call with multiple arguments',
  `class Child extends Parent {
    method(a, b, c) {
      return super.parentMethod(a, b, c);
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.method = function (a, b, c) {
    return Parent.prototype.parentMethod.call(this, a, b, c);
  };`);

testTransform(
  'convert super method call with no arguments',
  `class Child extends Parent {
    method() {
      return super.parentMethod();
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.method = function () {
    return Parent.prototype.parentMethod.call(this);
  };`);

testTransform(
  'convert super method call in async method',
  `class Child extends Parent {
    async method() {
      return await super.parentMethod();
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.method = async function () {
    return await Parent.prototype.parentMethod.call(this);
  };`);

testTransform(
  'convert super method call in generator method',
  `class Child extends Parent {
    *method() {
      yield super.parentMethod();
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.method = function* () {
    yield Parent.prototype.parentMethod.call(this);
  };`);

testTransform(
  'convert super method call in getter',
  `class Child extends Parent {
    get value() {
      return super.parentGetter();
    }
  }`,
  `var Child = class Child extends Parent {};
  Object.defineProperty(Child.prototype, "value", {
    get: function () {
      return Parent.prototype.parentGetter.call(this);
    },
    configurable: true
  });`);

testTransform(
  'convert super method call in setter',
  `class Child extends Parent {
    set value(v) {
      super.parentSetter(v);
    }
  }`,
  `var Child = class Child extends Parent {};
  Object.defineProperty(Child.prototype, "value", {
    set: function (v) {
      Parent.prototype.parentSetter.call(this, v);
    },
    configurable: true
  });`);

testTransform(
  'convert super method call in private method',
  `class Child extends Parent {
    #privateMethod() {
      return super.parentMethod();
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype._PRIVATE_privateMethod = function () {
    return Parent.prototype.parentMethod.call(this);
  };`);

testTransform(
  'convert super method call in private static method',
  `class Child extends Parent {
    static #privateStaticMethod() {
      return super.parentStaticMethod();
    }
  }`,
  `var Child = class Child extends Parent {};
  Child._PRIVATE_privateStaticMethod = function () {
    return Parent.parentStaticMethod.call();
  };`);

// ## object literals and methods

testTransform(
  'convert object method declaration to property assignment',
  `const obj = {
    method() {
      return 'hello';
    }
  };`,
  `var obj = {};
  obj.method = function () {
    return 'hello';
  };`);

testTransform(
  'convert object getter declaration to Object.defineProperty',
  `const obj = {
    get value() {
      return this._value;
    }
  };`,
  `var obj = {};
  Object.defineProperty(obj, "value", {
    get: function () {
      return this._value;
    },
    configurable: true
  });`);

testTransform(
  'convert object setter declaration to Object.defineProperty',
  `const obj = {
    set value(v) {
      this._value = v;
    }
  };`,
  `var obj = {};
  Object.defineProperty(obj, "value", {
    set: function (v) {
      this._value = v;
    },
    configurable: true
  });`);

testTransform(
  'convert object with computed property names',
  `const key = 'dynamic';
  const obj = {
    [key]: 'value',
    ['static']: 'static value'
  };`,
  `var key = 'dynamic';
  var obj = {};
  obj[key] = 'value';
  obj['static'] = 'static value';`);

testTransform(
  'convert object with shorthand property names',
  `const x = 1, y = 2;
  const obj = { x, y };`,
  `var x = 1;
  var y = 2;
  var obj = {};
  obj.x = x;
  obj.y = y;`);

testTransform(
  'convert object with mixed property types',
  `const name = 'test';
  const obj = {
    regular: 'value',
    [name]: 'computed',
    method() {
      return 'method';
    },
    get getter() {
      return this._value;
    },
    set setter(v) {
      this._value = v;
    }
  };`,
  `var name = 'test';
  var obj = {};
  obj.regular = 'value';
  obj[name] = 'computed';
  obj.method = function () {
    return 'method';
  };
  Object.defineProperty(obj, "getter", {
    get: function () {
      return this._value;
    },
    configurable: true
  });
  Object.defineProperty(obj, "setter", {
    set: function (v) {
      this._value = v;
    },
    configurable: true
  });`);

// ## function types

testTransform(
  'convert generator function declaration to function expression',
  `function* generator() {
    yield 1;
    yield 2;
  }`,
  `var generator_hakk_ = function* generator() {
    yield 1;
    yield 2;
  };
  var generator = (...args) => generator_hakk_(...args);`);

testTransform(
  'convert async generator function declaration to function expression',
  `async function* asyncGenerator() {
    yield await Promise.resolve(1);
  }`,
  `var asyncGenerator_hakk_ = async function* asyncGenerator() {
    yield await Promise.resolve(1);
  };
  var asyncGenerator = (...args) => asyncGenerator_hakk_(...args);`);

testTransform(
  'convert arrow function with different parameter patterns',
  `const noParams = () => 'hello';
  const singleParam = x => x * 2;
  const multipleParams = (a, b) => a + b;
  const restParams = (...args) => args.length;`,
  `var noParams_hakk_ = () => 'hello';
  var noParams = (...args) => noParams_hakk_(...args);
  var singleParam_hakk_ = x => x * 2;
  var singleParam = (...args) => singleParam_hakk_(...args);
  var multipleParams_hakk_ = (a, b) => a + b;
  var multipleParams = (...args) => multipleParams_hakk_(...args);
  var restParams_hakk_ = (...args) => args.length;
  var restParams = (...args) => restParams_hakk_(...args);`);

testTransform(
  'convert function expression with name to wrapper',
  `const namedFunc = function myFunction() {
    return 'named';
  };`,
  `var namedFunc_hakk_ = function myFunction() {
    return 'named';
  };
  var namedFunc = (...args) => namedFunc_hakk_(...args);`);

testTransform(
  'convert async arrow function to wrapper',
  `const asyncArrow = async () => {
    return await Promise.resolve('async');
  };`,
  `var asyncArrow_hakk_ = async () => {
    return await Promise.resolve('async');
  };
  var asyncArrow = (...args) => asyncArrow_hakk_(...args);`);

testTransform(
  'convert generator arrow function to wrapper',
  `const genArrow = function* () {
    yield 1;
  };`,
  `var genArrow_hakk_ = function* () {
    yield 1;
  };
  var genArrow = (...args) => genArrow_hakk_(...args);`);

// ## `import()` calls

testTransform('convert import statement to await import',
  'var {test} = await import("./test.js");',
  'var test; ({ test } = await __import("./test.js"));');

// ## `import` syntax
// Testing all cases in
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#syntax

testTransform("convert `import defaultExport from 'module-name'` to await import",
  "import defaultExport from 'module-name';",
  "var defaultExport; ({ default: defaultExport } = await __import('module-name'));");

testTransform("convert `import * as name from 'module-name'` to await import",
  "import * as name from 'module-name';",
  "var name; name = await __import('module-name');");

testTransform("convert `import { export1 } from 'module-name'` to await import",
  "import { export1 } from 'module-name';",
  "var export1; ({ export1 } = await __import('module-name'));");

testTransform("convert `import { export1 as alias1 } from 'module-name'` to await import",
  "import { export1 as alias1 } from 'module-name';",
  "var alias1; ({ export1: alias1 } = await __import('module-name'));");

testTransform("convert `import { default as alias } from 'module-name'` to await import",
  "import { default as alias } from 'module-name';",
  "var alias; ({ default: alias } = await __import('module-name'));");

testTransform("convert `import { export1, export2 } from 'module-name'` to await import",
  "import { export1, export2 } from 'module-name';",
  "var export1; var export2; ({ export1, export2 } = await __import('module-name'));");

testTransform("convert `import { export1, export2 as alias2 } from 'module-name'` to await import",
  "import { export1, export2 as alias2 } from 'module-name';",
  "var export1; var alias2; ({ export1, export2: alias2 } = await __import('module-name'));");

testTransform("convert `import { 'string name' as alias } from 'module-name'` to await import",
  "import { 'string name' as alias } from 'module-name';",
  "var alias; ({ 'string name': alias } = await __import('module-name'));");

testTransform("convert `import defaultExport, { export1 } from 'module-name'` to await import",
  "import defaultExport, { export1 } from 'module-name';",
  "var defaultExport; var export1; ({ default: defaultExport, export1 } = await __import('module-name'));");

testTransform("convert `import defaultExport, * as name from 'module-name'` to await import",
  "import defaultExport, * as name from 'module-name';",
  `var name; name = await __import('module-name');
  var { default: defaultExport } = name;`);

testTransform("convert `import 'module-name'` to await import",
  "import 'module-name';",
  "await __import('module-name');");

// ## `export` syntax
// TODO: Test all cases shown in
// https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export#syntax

// ### Exporting declarations

testTransform('convert export let declarations to module.exports',
  'export let name1, name2',
  `var name1;
   var name2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform('convert export const declarations to module.exports',
  'export const name1 = 1, name2 = 2;',
  `var name1 = 1;
   var name2 = 2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform(
  'convert export function declarations to module.exports',
  'export function functionName() { /* … */ }',
  `var functionName_hakk_ = function functionName() {/* … */};
  var functionName = (...args) => functionName_hakk_(...args);
  module.exports.functionName = functionName;`);

testTransform(
  'convert export class declarations to module.exports',
  'export class ClassName { /* … */ }',
  `var ClassName = class ClassName {/* … */};
  module.exports.ClassName = ClassName;`);

testTransform(
  'convert export function* declarations to module.exports',
  'export function* generatorFunctionName() { /* … */ }',
  `var generatorFunctionName_hakk_ = function* generatorFunctionName() {/* … */};
  var generatorFunctionName  = (...args) => generatorFunctionName_hakk_(...args);
  module.exports.generatorFunctionName = generatorFunctionName;`);

testTransform(
  'convert export const { name1, name2: bar } = o; to module.exports',
  'export const { name1, name2: bar } = o;',
  `var { name1, name2: bar } = o;
   module.exports.name1 = o.name1;
   module.exports.bar = o.name2;`);

testTransform(
  'convert export const [ name1, name2 ] = array; to module.exports',
  'export const [ name1, name2 ] = array;',
  `var [name1, name2] = array;
   module.exports.name1 = array[0];
   module.exports.name2 = array[1];`);

// ### Export list

testTransform(
  'convert export list statements to module.exports',
  'let x = 1, y = 2; export { x, y }',
  'var x = 1; var y = 2; module.exports.x = x; module.exports.y = y;');

testTransform(
  'convert export list statements with aliases to module.exports',
  'let x = 1, y = 2; export { x as name1, y as name2}',
  'var x = 1; var y = 2; module.exports.name1 = x; module.exports.name2 = y;');

testTransform(
  'convert export list statements with string aliases to module.exports',
  'let x = 1, y = 2; export { x as "name1", y as "name2"}',
  'var x = 1; var y = 2; module.exports[\'name1\'] = x; module.exports[\'name2\'] = y;');

testTransform(
  'convert export list statements with default alias to module.exports',
  'let x = 1; export { x as default}',
  'var x = 1; module.exports.default = x;');

// ### Default exports

testTransform(
  'convert export default expression to module.exports',
  'export default expression;',
  'module.exports.default = expression;');

testTransform(
  'convert export default function declarations to module.exports',
  'export default function functionName() { /* … */ }',
  'module.exports.default = function functionName() {/* … */};');

testTransform(
  'convert export default class declarations to module.exports',
  'export default class ClassName { /* … */ }',
  'module.exports.default = class ClassName {/* … */};');

testTransform(
  'convert export default named function* declarations to module.exports',
  'export default function* generatorFunctionName() { /* … */ }',
  'module.exports.default = function* generatorFunctionName() {/* … */};');

testTransform(
  'convert export default function declarations to module.exports',
  'export default function () { /* … */ }',
  'module.exports.default = function () {/* … */};');

testTransform(
  'convert export default class declarations to module.exports',
  'export default class { /* … */ }',
  'module.exports.default = class {/* … */};');

testTransform(
  'convert export default anonymous function* declarations to module.exports',
  'export default function* () { /* … */ }',
  'module.exports.default = function* () {/* … */};');

// ### Aggregating modules

testTransform(
  'convert export * from "my-module-name" to module.exports',
  'export * from "my-module-name"',
  `await async function () {
    const importedObject = await __import('my-module-name');
    const propertyNames = Object.getOwnPropertyNames(importedObject);
    for (const propertyName of propertyNames) {
      if (propertyName !== 'default') {
        module.exports[propertyName] = importedObject[propertyName];
      }
    }
  }();`);

testTransform(
  'convert export * as name1 from "module-name" to module.exports',
  'export * as name1 from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    const propertyNames = Object.getOwnPropertyNames(importedObject);
    for (const propertyName of propertyNames) {
      if (propertyName !== 'default') {
        module.exports.name1[propertyName] = importedObject[propertyName];
      }
    }
  }();`);

testTransform(
  'convert export { name1, /* …, */ nameN } from "module-name" to module.exports',
  'export { name1, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.name1;
    module.exports.nameN = importedObject.nameN;
  }();`);

testTransform(
  'convert export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name" to module.exports',
  'export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.import1;
    module.exports.name2 = importedObject.import2;
    module.exports.nameN = importedObject.nameN;
}();`);

testTransform(
  'convert export { default, /* …, */ } from "module-name" to module.exports',
  'export { default, /* …, */ } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.default = importedObject.default;
}();`);
