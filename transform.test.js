/* eslint-env jest */

const { prepareCode } = require('./transform.js');

const cleanString = (x) =>
  x.replace(/\s+/g, ' ');

const testTransform = (name, before, after) =>
  test('transform: ' + name, () => {
    expect(cleanString(prepareCode(before)))
      .toBe(cleanString(after));
  });

const testParserError = (name, code, expectedErrorPattern) =>
  test('parser error: ' + name, () => {
    expect(() => prepareCode(code)).toThrow(expectedErrorPattern);
  });

// ## variable declarations

testTransform('const to var', 'const x = 1;', 'var x = 1;');

testTransform('let to var', 'let x = 1;', 'var x = 1;');

testTransform('var assignment to await to two statements', 'var x = await Promise.resolve(1);', 'var x; x = await Promise.resolve(1);');

testTransform('let assignment to await to two statements', 'let x = await Promise.resolve(2);', 'var x; x = await Promise.resolve(2);');

testTransform('const assignment to await to two statements', 'const x = await Promise.resolve(3);', 'var x; x = await Promise.resolve(3);');

testTransform(
  'multiple variable declarations to var',
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

testTransform('class declaration to class expression',
  'class A {}', 'var A = class A {};');

testTransform(
  'class method declaration to class expression',
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
  'class field declaration to class expression',
  `class A {
    field1 = 3;
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "field1", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(3);`);

testTransform(
  'class private method declaration to class expression',
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
  'class private field declaration to class expression',
  `class A {
  #field1 = 7;
}`,
  `var A = class A {};
(function (initValue) {
  const valueMap = new WeakMap();
  Object.defineProperty(A.prototype, "_PRIVATE_field1", {
    get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
    set(newValue) { valueMap.set(this, newValue); },
    configurable: true
  });
})(7);`);

testTransform(
  'class extends declaration to class expression',
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
  'static block to IIFE call',
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
  'static method declaration to class expression',
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
  'static field declaration to class expression',
  `class Config {
    static version = '1.0.0';
  }`,
  `var Config = class Config {};
  Config.version = '1.0.0';`);

testTransform(
  'static getter declaration to class expression',
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
  'static setter declaration to class expression',
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
  'class with mixed static and instance members',
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
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Example.prototype, "instanceField", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('instance');
  Example.staticMethod = function () {
    return 'static method';
  };
  Example.prototype.instanceMethod = function () {
    return 'instance method';
  };`);

testTransform(
  'class with private static field',
  `class Data {
    static #secret = 'hidden';
  }`,
  `var Data = class Data {};
  Data._PRIVATE_secret = 'hidden';`);

testTransform(
  'class with private static method',
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
  'class with private static getter',
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
  'class with private static setter',
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
  'class with mixed private static and instance members',
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
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Example.prototype, "_PRIVATE_instancePrivate", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('instance private');
  Example._PRIVATE_staticPrivateMethod = function () {
    return 'static private method';
  };
  Example.prototype._PRIVATE_instancePrivateMethod = function () {
    return 'instance private method';
  };`);

testTransform(
  'class with computed property names',
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
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Example.prototype, key, {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('value');
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Example.prototype, 'static', {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('static value');
  Example.prototype[key] = function () {
    return 'method';
  };`);

testTransform(
  'class with computed static property names',
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
  'super method call in instance method',
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
  'super method call in static method',
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
  'super property access in static method',
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
  'super property access in instance method (returns undefined for class fields)',
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
  'super method call vs super property access (different behaviors)',
  `class Child extends Parent {
    testSuper() {
      return {
        method: super.parentMethod(),
        property: super.instanceProperty
      };
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.testSuper = function () {
    return {
      method: Parent.prototype.parentMethod.call(this),
      property: Parent.prototype.instanceProperty
    };
  };`);

testTransform(
  'super method call with multiple arguments',
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
  'super method call with no arguments',
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
  'super method call in async method',
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
  'super method call in generator method',
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
  'super method call in getter',
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
  'super method call in setter',
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
  'super method call in private method',
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
  'super method call in private static method',
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
  'object method declaration to property assignment',
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
  'object getter declaration to Object.defineProperty',
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
  'object setter declaration to Object.defineProperty',
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
  'object with computed property names',
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
  'object with shorthand property names',
  `const x = 1, y = 2;
  const obj = { x, y };`,
  `var x = 1;
   var y = 2;
  var obj = {};
  obj.x = x;
  obj.y = y;`);

testTransform(
  'object with mixed property types',
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
  'generator function declaration to function expression',
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
  'async generator function declaration to function expression',
  `async function* asyncGenerator() {
    yield await Promise.resolve(1);
  }`,
  `var asyncGenerator_hakk_ = async function* asyncGenerator() {
    yield await Promise.resolve(1);
  };
  var asyncGenerator = (...args) => asyncGenerator_hakk_(...args);`);

testTransform(
  'arrow function with different parameter patterns',
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
  'function expression with name to wrapper',
  `const namedFunc = function myFunction() {
    return 'named';
  };`,
  `var namedFunc_hakk_ = function myFunction() {
    return 'named';
  };
  var namedFunc = (...args) => namedFunc_hakk_(...args);`);

testTransform(
  'async arrow function to wrapper',
  `const asyncArrow = async () => {
    return await Promise.resolve('async');
  };`,
  `var asyncArrow_hakk_ = async () => {
    return await Promise.resolve('async');
  };
  var asyncArrow = (...args) => asyncArrow_hakk_(...args);`);

testTransform(
  'generator arrow function to wrapper',
  `const genArrow = function* () {
    yield 1;
  };`,
  `var genArrow_hakk_ = function* () {
    yield 1;
  };
  var genArrow = (...args) => genArrow_hakk_(...args);`);

// ## Private Field Access

testTransform(
  'private field access in instance method',
  `class A {
    #field = 42;
    getValue() {
      return this.#field;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(42);
  A.prototype.getValue = function () {
    return this._PRIVATE_field;
  };`);

testTransform(
  'private field access in static method',
  `class A {
    static #field = 100;
    static getValue() {
      return this.#field;
    }
  }`,
  `var A = class A {};
  A._PRIVATE_field = 100;
  A.getValue = function () {
    return this._PRIVATE_field;
  };`);

testTransform(
  'private field access with assignment',
  `class A {
    #field = 0;
    increment() {
      this.#field++;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(0);
  A.prototype.increment = function () {
    this._PRIVATE_field++;
  };`);

testTransform(
  'private field access in getter',
  `class A {
    #field = 'secret';
    get secret() {
      return this.#field;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('secret');
  Object.defineProperty(A.prototype, "secret", {
    get: function () {
      return this._PRIVATE_field;
    },
    configurable: true
  });`);

testTransform(
  'private field access in setter',
  `class A {
    #field = null;
    set value(val) {
      this.#field = val;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(null);
  Object.defineProperty(A.prototype, "value", {
    set: function (val) {
      this._PRIVATE_field = val;
    },
    configurable: true
  });`);

testTransform(
  'private field access in constructor',
  `class A {
    #field = 10;
    constructor(value) {
      this.#field = value;
    }
  }`,
  `var A = class A {
    constructor(value) {
      this._PRIVATE_field = value;
    }
  };
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(10);`);

testTransform(
  'private field access with complex expressions',
  `class A {
    #field = [];
    addItem(item) {
      this.#field.push(item);
    }
    get length() {
      return this.#field.length;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })([]);
  A.prototype.addItem = function (item) {
    this._PRIVATE_field.push(item);
  };
  Object.defineProperty(A.prototype, "length", {
    get: function () {
      return this._PRIVATE_field.length;
    },
    configurable: true
  });`);

testTransform(
  'private field access in static block',
  `class A {
    static #field = 0;
    static {
      this.#field = 42;
    }
  }`,
  `var A = class A {};
  A._PRIVATE_field = 0;
  (function () {
    this._PRIVATE_field = 42;
  }).call(A);`);

testTransform(
  'private field access with multiple private fields',
  `class A {
    #field1 = 1;
    #field2 = 2;
    getSum() {
      return this.#field1 + this.#field2;
    }
  }`,
  `var A = class A {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field1", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(1);
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "_PRIVATE_field2", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(2);
  A.prototype.getSum = function () {
    return this._PRIVATE_field1 + this._PRIVATE_field2;
  };`);

// ## Object Literal Edge Cases

testTransform(
  'nested object with methods (nested objects not transformed)',
  `const config = {
    database: {
      host: 'localhost',
      connect() {
        return this.host;
      }
    }
  };`,
  `var config = {};
  config.database = {
    host: 'localhost',
    connect() {
      return this.host;
    }
  };`);

testTransform(
  'object with method referencing this',
  `const counter = {
    value: 0,
    increment() {
      this.value++;
      return this.value;
    },
    reset() {
      this.value = 0;
    }
  };`,
  `var counter = {};
  counter.value = 0;
  counter.increment = function () {
    this.value++;
    return this.value;
  };
  counter.reset = function () {
    this.value = 0;
  };`);

testTransform(
  'object with complex computed properties (now supported)',
  `const key1 = 'prop1';
  const key2 = 'prop2';
  const obj = {
    [key1 + key2]: 'combined',
    [key1.toUpperCase()]: 'uppercase',
    ['static_' + key2]: 'static_combined'
  };`,
  `var key1 = 'prop1';
  var key2 = 'prop2';
  var obj = {};
  obj[key1 + key2] = 'combined';
  obj[key1.toUpperCase()] = 'uppercase';
  obj['static_' + key2] = 'static_combined';`);

testTransform(
  'object with mixed property types and methods (Symbol.iterator now supported)',
  `const api = {
    baseUrl: 'https://api.example.com',
    version: 1,
    get endpoints() {
      return this._endpoints || [];
    },
    set endpoints(value) {
      this._endpoints = value;
    },
    async fetch(path) {
      return fetch(this.baseUrl + path);
    }
  };`,
  `var api = {};
  api.baseUrl = 'https://api.example.com';
  api.version = 1;
  Object.defineProperty(api, "endpoints", {
    get: function () {
      return this._endpoints || [];
    },
    configurable: true
  });
  Object.defineProperty(api, "endpoints", {
    set: function (value) {
      this._endpoints = value;
    },
    configurable: true
  });
  api.fetch = async function (path) {
    return fetch(this.baseUrl + path);
  };`);

testTransform(
  'object with nested computed properties (nested objects not transformed)',
  `const key = 'nested';
  const obj = {
    [key]: {
      [key + '_inner']: 'value',
      method() {
        return this[key + '_inner'];
      }
    }
  };`,
  `var key = 'nested';
  var obj = {};
  obj[key] = {
    [key + '_inner']: 'value',
    method() {
      return this[key + '_inner'];
    }
  };`);

testTransform(
  'object with method calling other methods',
  `const calculator = {
    add(a, b) {
      return a + b;
    },
    subtract(a, b) {
      return a - b;
    },
    calculate(operation, a, b) {
      return this[operation](a, b);
    }
  };`,
  `var calculator = {};
  calculator.add = function (a, b) {
    return a + b;
  };
  calculator.subtract = function (a, b) {
    return a - b;
  };
  calculator.calculate = function (operation, a, b) {
    return this[operation](a, b);
  };`);

testTransform(
  'object with getter and setter using private-like pattern',
  `const store = {
    _data: {},
    get(key) {
      return this._data[key];
    },
    set(key, value) {
      this._data[key] = value;
    },
    has(key) {
      return key in this._data;
    }
  };`,
  `var store = {};
  store._data = {};
  store.get = function (key) {
    return this._data[key];
  };
  store.set = function (key, value) {
    this._data[key] = value;
  };
  store.has = function (key) {
    return key in this._data;
  };`);

testTransform(
  'object with async methods and complex expressions',
  `const service = {
    timeout: 5000,
    async request(url, options = {}) {
      const config = {
        ...options,
        timeout: this.timeout
      };
      return fetch(url, config);
    },
    async retry(url, maxRetries = 3) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          return await this.request(url);
        } catch (error) {
          if (i === maxRetries - 1) throw error;
        }
      }
    }
  };`,
  `var service = {};
  service.timeout = 5000;
  service.request = async function (url, options = {}) {
    const config = {
      ...options,
      timeout: this.timeout
    };
    return fetch(url, config);
  };
  service.retry = async function (url, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await this.request(url);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
      }
    }
  };`);

testTransform(
  'object with generator methods',
  `const sequence = {
    start: 0,
    step: 1,
    *generate(count) {
      for (let i = 0; i < count; i++) {
        yield this.start + (i * this.step);
      }
    },
    *infinite() {
      let current = this.start;
      while (true) {
        yield current;
        current += this.step;
      }
    }
  };`,
  `var sequence = {};
  sequence.start = 0;
  sequence.step = 1;
  sequence.generate = function* (count) {
    for (let i = 0; i < count; i++) {
      yield this.start + i * this.step;
    }
  };
  sequence.infinite = function* () {
    let current = this.start;
    while (true) {
      yield current;
      current += this.step;
    }
  };`);

// ## `import()` calls

testTransform('import statement to await import',
  'var {test} = await import("./test.js");',
  'var test; ({ test } = await __import("./test.js"));');

// ## `import` syntax
// Testing all cases in
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import#syntax

testTransform("`import defaultExport from 'module-name'` to await import",
  "import defaultExport from 'module-name';",
  "var defaultExport; ({ default: defaultExport } = await __import('module-name'));");

testTransform("`import * as name from 'module-name'` to await import",
  "import * as name from 'module-name';",
  "var name; name = await __import('module-name');");

testTransform("`import { export1 } from 'module-name'` to await import",
  "import { export1 } from 'module-name';",
  "var export1; ({ export1 } = await __import('module-name'));");

testTransform("`import { export1 as alias1 } from 'module-name'` to await import",
  "import { export1 as alias1 } from 'module-name';",
  "var alias1; ({ export1: alias1 } = await __import('module-name'));");

testTransform("`import { default as alias } from 'module-name'` to await import",
  "import { default as alias } from 'module-name';",
  "var alias; ({ default: alias } = await __import('module-name'));");

testTransform("`import { export1, export2 } from 'module-name'` to await import",
  "import { export1, export2 } from 'module-name';",
  "var export1; var export2; ({ export1, export2 } = await __import('module-name'));");

testTransform("`import { export1, export2 as alias2 } from 'module-name'` to await import",
  "import { export1, export2 as alias2 } from 'module-name';",
  "var export1; var alias2; ({ export1, export2: alias2 } = await __import('module-name'));");

testTransform("`import { 'string name' as alias } from 'module-name'` to await import",
  "import { 'string name' as alias } from 'module-name';",
  "var alias; ({ 'string name': alias } = await __import('module-name'));");

testTransform("`import defaultExport, { export1 } from 'module-name'` to await import",
  "import defaultExport, { export1 } from 'module-name';",
  "var defaultExport; var export1; ({ default: defaultExport, export1 } = await __import('module-name'));");

testTransform("`import defaultExport, * as name from 'module-name'` to await import",
  "import defaultExport, * as name from 'module-name';",
  `var name; name = await __import('module-name');
  var { default: defaultExport } = name;`);

testTransform("`import 'module-name'` to await import",
  "import 'module-name';",
  "await __import('module-name');");

// ## `export` syntax
// TODO: Test all cases shown in
// https://developer.mozilla.org/en-US/docs/web/javascript/reference/statements/export#syntax

// ### Exporting declarations

testTransform('export let declarations to module.exports',
  'export let name1, name2',
  `var name1;
   var name2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform('export const declarations to module.exports',
  'export const name1 = 1, name2 = 2;',
  `var name1 = 1;
   var name2 = 2;
   module.exports.name1 = name1;
   module.exports.name2 = name2;`);

testTransform(
  'export function declarations to module.exports',
  'export function functionName() { /* … */ }',
  `var functionName_hakk_ = function functionName() {/* … */};
  var functionName = (...args) => functionName_hakk_(...args);
  module.exports.functionName = functionName;`);

testTransform(
  'export class declarations to module.exports',
  'export class ClassName { /* … */ }',
  `var ClassName = class ClassName {/* … */};
  module.exports.ClassName = ClassName;`);

testTransform(
  'export function* declarations to module.exports',
  'export function* generatorFunctionName() { /* … */ }',
  `var generatorFunctionName_hakk_ = function* generatorFunctionName() {/* … */};
  var generatorFunctionName  = (...args) => generatorFunctionName_hakk_(...args);
  module.exports.generatorFunctionName = generatorFunctionName;`);

testTransform(
  'export const { name1, name2: bar } = o; to module.exports',
  'export const { name1, name2: bar } = o;',
  `var { name1, name2: bar } = o;
   module.exports.name1 = o.name1;
   module.exports.bar = o.name2;`);

testTransform(
  'export const [ name1, name2 ] = array; to module.exports',
  'export const [ name1, name2 ] = array;',
  `var [name1, name2] = array;
   module.exports.name1 = array[0];
   module.exports.name2 = array[1];`);

// ### Export list

testTransform(
  'export list statements to module.exports',
  'let x = 1, y = 2; export { x, y }',
  'var x = 1; var y = 2; module.exports.x = x; module.exports.y = y;');

testTransform(
  'export list statements with aliases to module.exports',
  'let x = 1, y = 2; export { x as name1, y as name2}',
  'var x = 1; var y = 2; module.exports.name1 = x; module.exports.name2 = y;');

testTransform(
  'export list statements with string aliases to module.exports',
  'let x = 1, y = 2; export { x as "name1", y as "name2"}',
  'var x = 1; var y = 2; module.exports[\'name1\'] = x; module.exports[\'name2\'] = y;');

testTransform(
  'export list statements with default alias to module.exports',
  'let x = 1; export { x as default}',
  'var x = 1; module.exports.default = x;');

// ### Default exports

testTransform(
  'export default expression to module.exports',
  'export default expression;',
  'module.exports.default = expression;');

testTransform(
  'export default function declarations to module.exports',
  'export default function functionName() { /* … */ }',
  'module.exports.default = function functionName() {/* … */};');

testTransform(
  'export default class declarations to module.exports',
  'export default class ClassName { /* … */ }',
  'module.exports.default = class ClassName {/* … */};');

testTransform(
  'export default named function* declarations to module.exports',
  'export default function* generatorFunctionName() { /* … */ }',
  'module.exports.default = function* generatorFunctionName() {/* … */};');

testTransform(
  'export default function declarations to module.exports',
  'export default function () { /* … */ }',
  'module.exports.default = function () {/* … */};');

testTransform(
  'export default class declarations to module.exports',
  'export default class { /* … */ }',
  'module.exports.default = class {/* … */};');

testTransform(
  'export default anonymous function* declarations to module.exports',
  'export default function* () { /* … */ }',
  'module.exports.default = function* () {/* … */};');

// ### Aggregating modules

testTransform(
  'export * from "my-module-name" to module.exports',
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
  'export * as name1 from "module-name" to module.exports',
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
  'export { name1, /* …, */ nameN } from "module-name" to module.exports',
  'export { name1, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.name1;
    module.exports.nameN = importedObject.nameN;
  }();`);

testTransform(
  'export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name" to module.exports',
  'export { import1 as name1, import2 as name2, /* …, */ nameN } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.name1 = importedObject.import1;
    module.exports.name2 = importedObject.import2;
    module.exports.nameN = importedObject.nameN;
}();`);

testTransform(
  'export { default, /* …, */ } from "module-name" to module.exports',
  'export { default, /* …, */ } from "module-name";',
  `await async function () {
    const importedObject = await __import('module-name');
    module.exports.default = importedObject.default;
}();`);

// ## Import/Export Edge Cases

testTransform(
  'import with default and named imports',
  'import defaultExport, { named1, named2 as alias } from "module";',
  'var defaultExport; var named1; var alias; ({ default: defaultExport, named1, named2: alias } = await __import(\'module\'));');

testTransform(
  'import with string literal module names',
  'import { utils } from "./utils.js";',
  'var utils; ({ utils } = await __import(\'./utils.js\'));');

testTransform(
  'export with simple destructuring patterns',
  'export const { a, b, c } = obj;',
  `var { a, b, c } = obj;
module.exports.a = obj.a;
module.exports.b = obj.b;
module.exports.c = obj.c;`);

testTransform(
  'export with array destructuring',
  'export const [first, second, ...others] = array;',
  `var [first, second, ...others] = array;
module.exports.first = array[0];
module.exports.second = array[1];
module.exports.undefined = array[2];`);

testTransform(
  'export with function calls as values',
  'export const result = computeValue();',
  `var result = computeValue();
module.exports.result = result;`);

testTransform(
  'export with template literals as values',
  // eslint-disable-next-line no-template-curly-in-string
  'export const message = `Hello ${name}`;',
  `var message = \`Hello \${name}\`;
module.exports.message = message;`);

testTransform(
  'export with complex expressions',
  'export const sum = a + b * c;',
  `var sum = a + b * c;
module.exports.sum = sum;`);

testTransform(
  'export with class instantiation',
  'export const instance = new MyClass();',
  `var instance = new MyClass();
module.exports.instance = instance;`);

testTransform(
  'export with conditional expressions',
  'export const value = condition ? a : b;',
  `var value = condition ? a : b;
module.exports.value = value;`);

testTransform(
  'export with logical operators',
  'export const result = a && b || c;',
  `var result = a && b || c;
module.exports.result = result;`);

testTransform(
  'export with method calls',
  'export const processed = data.map(x => x * 2);',
  `var processed = data.map(x => x * 2);
module.exports.processed = processed;`);

testTransform(
  'export with async function calls',
  'export const result = await fetchData();',
  'var result; result = await fetchData(); module.exports.result = result;');

testTransform(
  'export with generator function calls',
  'export const sequence = generateSequence();',
  `var sequence = generateSequence();
module.exports.sequence = sequence;`);

testTransform(
  'export with array spread',
  'export const combined = [...arr1, ...arr2];',
  `var combined = [...arr1, ...arr2];
module.exports.combined = combined;`);

testTransform(
  'export with object spread (preserved as-is)',
  'export const merged = { ...obj1, ...obj2 };',
  `var merged = {
  ...obj1,
  ...obj2
};
module.exports.merged = merged;`);

testTransform(
  'export with mixed object properties and spread (preserved as-is)',
  'export const combined = { a: 1, ...obj1, b: 2 };',
  `var combined = {
  a: 1,
  ...obj1,
  b: 2
};
module.exports.combined = combined;`);

testTransform(
  'export with optional chaining',
  'export const value = obj?.prop?.method?.();',
  `var value = obj?.prop?.method?.();
module.exports.value = value;`);

testTransform(
  'export with nullish coalescing',
  'export const result = value ?? defaultValue;',
  `var result = value ?? defaultValue;
module.exports.result = result;`);

testTransform(
  'export with BigInt literals',
  'export const bigNumber = 123n;',
  `var bigNumber = 123n;
module.exports.bigNumber = bigNumber;`);

testTransform(
  'export with numeric separators',
  'export const largeNumber = 1_000_000;',
  `var largeNumber = 1_000_000;
module.exports.largeNumber = largeNumber;`);

testTransform(
  'export with regex literals',
  'export const pattern = /test/gi;',
  `var pattern = /test/gi;
module.exports.pattern = pattern;`);

testTransform(
  'export with tagged template literals',
  // eslint-disable-next-line no-template-curly-in-string
  'export const html = html`<div>${content}</div>`;',
  // eslint-disable-next-line no-template-curly-in-string
  'var html = html`<div>${content}</div>`; module.exports.html = html;');

testTransform(
  'export with complex nested expressions',
  'export const result = obj.method({ a: 1, b: [2, 3] }).filter(x => x > 1);',
  `var result = obj.method({ a: 1, b: [2, 3] }).filter(x => x > 1);
module.exports.result = result;`);

testTransform(
  'export with multiple variable declarations',
  'export const a = 1, b = 2, c = 3;',
  `var a = 1;
var b = 2;
var c = 3;
module.exports.a = a;
module.exports.b = b;
module.exports.c = c;`);

testTransform(
  'export with mixed declaration types',
  'export let x = 1; export const y = 2;',
  `var x = 1;
module.exports.x = x;
var y = 2;
module.exports.y = y;`);

testTransform(
  'export with computed property names',
  'export const { [key]: value } = obj;',
  `var { [key]: value } = obj;
module.exports.value = obj.key;`);

testTransform(
  'export with default values in destructuring',
  'export const { a = 1, b = 2 } = obj;',
  `var { a = 1, b = 2 } = obj;
module.exports.undefined = obj.a;
module.exports.undefined = obj.b;`);

testTransform(
  'export with nested destructuring',
  'export const { user: { name, age } } = data;',
  `var { user: { name, age } } = data;
module.exports.undefined = data.user;`);

// ## function edge cases

testTransform(
  'function with complex parameter destructuring',
  `function complexParams({ a, b = 1 }, [c, d = 2], ...rest) {
    return a + b + c + d + rest.length;
  }`,
  `var complexParams_hakk_ = function complexParams({ a, b = 1 }, [c, d = 2], ...rest) {
    return a + b + c + d + rest.length;
  };
  var complexParams = (...args) => complexParams_hakk_(...args);`);

testTransform(
  'function with default parameters and rest parameters',
  `function withDefaults(a = 1, b = 2, ...c) {
    return a + b + c.length;
  }`,
  `var withDefaults_hakk_ = function withDefaults(a = 1, b = 2, ...c) {
    return a + b + c.length;
  };
  var withDefaults = (...args) => withDefaults_hakk_(...args);`);

testTransform(
  'function with complex return statement',
  `function complexReturn() {
    return {
      value: 42,
      method() { return this.value; }
    };
  }`,
  `var complexReturn_hakk_ = function complexReturn() {
    return {
      value: 42,
      method() { return this.value; }
    };
  };
  var complexReturn = (...args) => complexReturn_hakk_(...args);`);

testTransform(
  'function with nested function declarations',
  `function outer() {
    function inner() {
      return 'nested';
    }
    return inner();
  }`,
  `var outer_hakk_ = function outer() {
    function inner() {
      return 'nested';
    }
    return inner();
  };
  var outer = (...args) => outer_hakk_(...args);`);

testTransform(
  'function with this binding and call/apply',
  `function boundFunction() {
    return this.value;
  }`,
  `var boundFunction_hakk_ = function boundFunction() {
    return this.value;
  };
  var boundFunction = (...args) => boundFunction_hakk_(...args);`);

testTransform(
  'function with try-catch-finally',
  `function withErrorHandling() {
    try {
      throw new Error('test');
    } catch (e) {
      return e.message;
    } finally {
      console.log('cleanup');
    }
  }`,
  `var withErrorHandling_hakk_ = function withErrorHandling() {
    try {
      throw new Error('test');
    } catch (e) {
      return e.message;
    } finally {
      console.log('cleanup');
    }
  };
  var withErrorHandling = (...args) => withErrorHandling_hakk_(...args);`);

testTransform(
  'function with switch statement',
  `function withSwitch(value) {
    switch (value) {
      case 1: return 'one';
      case 2: return 'two';
      default: return 'other';
    }
  }`,
  `var withSwitch_hakk_ = function withSwitch(value) {
    switch (value) {
      case 1: return 'one';
      case 2: return 'two';
      default: return 'other';
    }
  };
  var withSwitch = (...args) => withSwitch_hakk_(...args);`);

testTransform(
  'function with labeled statements',
  `function withLabels() {
    outer: for (let i = 0; i < 3; i++) {
      inner: for (let j = 0; j < 3; j++) {
        if (i === 1 && j === 1) break outer;
      }
    }
  }`,
  `var withLabels_hakk_ = function withLabels() {
    outer: for (let i = 0; i < 3; i++) {
      inner: for (let j = 0; j < 3; j++) {
        if (i === 1 && j === 1) break outer;
      }
    }
  };
  var withLabels = (...args) => withLabels_hakk_(...args);`);

testTransform(
  'function with yield expressions (generator)',
  `function* generatorWithYield() {
    yield 1;
    yield 2;
    return 3;
  }`,
  `var generatorWithYield_hakk_ = function* generatorWithYield() {
    yield 1;
    yield 2;
    return 3;
  };
  var generatorWithYield = (...args) => generatorWithYield_hakk_(...args);`);

testTransform(
  'function with await expressions (async)',
  `async function asyncWithAwait() {
    const result = await Promise.resolve(42);
    return result * 2;
  }`,
  `var asyncWithAwait_hakk_ = async function asyncWithAwait() {
    const result = await Promise.resolve(42);
    return result * 2;
  };
  var asyncWithAwait = (...args) => asyncWithAwait_hakk_(...args);`);

testTransform(
  'function with class instantiation',
  `function createInstance() {
    class TestClass {
      constructor(value) {
        this.value = value;
      }
    }
    return new TestClass(42);
  }`,
  `var createInstance_hakk_ = function createInstance() {
    class TestClass {
      constructor(value) {
        this.value = value;
      }
    }
    return new TestClass(42);
  };
  var createInstance = (...args) => createInstance_hakk_(...args);`);

testTransform(
  'function with template literals and tagged templates',
  `function withTemplates(name, count) {
    const regular = \`Hello \${name}, count is \${count}\`;
    const tagged = String.raw\`Path: \${name}/file.txt\`;
    return { regular, tagged };
  }`,
  `var withTemplates_hakk_ = function withTemplates(name, count) {
    const regular = \`Hello \${name}, count is \${count}\`;
    const tagged = String.raw\`Path: \${name}/file.txt\`;
    return { regular, tagged };
  };
  var withTemplates = (...args) => withTemplates_hakk_(...args);`);

testTransform(
  'function with object and array patterns',
  `function withPatterns({ x, y }, [a, b]) {
    return { x, y, a, b };
  }`,
  `var withPatterns_hakk_ = function withPatterns({ x, y }, [a, b]) {
    return { x, y, a, b };
  };
  var withPatterns = (...args) => withPatterns_hakk_(...args);`);

testTransform(
  'function with optional chaining and nullish coalescing',
  `function withModernOps(obj) {
    const value = obj?.nested?.value ?? 'default';
    return value;
  }`,
  `var withModernOps_hakk_ = function withModernOps(obj) {
    const value = obj?.nested?.value ?? 'default';
    return value;
  };
  var withModernOps = (...args) => withModernOps_hakk_(...args);`);

testTransform(
  'function with logical assignment operators',
  `function withLogicalAssign(obj) {
    obj.value ||= 'default';
    obj.count ??= 0;
    obj.flag &&= true;
    return obj;
  }`,
  `var withLogicalAssign_hakk_ = function withLogicalAssign(obj) {
    obj.value ||= 'default';
    obj.count ??= 0;
    obj.flag &&= true;
    return obj;
  };
  var withLogicalAssign = (...args) => withLogicalAssign_hakk_(...args);`);

testTransform(
  'function with private class fields access (not supported outside class)',
  `function accessPrivateFields(instance) {
    return instance.privateField;
  }`,
  `var accessPrivateFields_hakk_ = function accessPrivateFields(instance) {
    return instance.privateField;
  };
  var accessPrivateFields = (...args) => accessPrivateFields_hakk_(...args);`);

testTransform(
  'function with static class members access',
  `function accessStaticMembers(Class) {
    return Class.staticMethod() + Class.staticField;
  }`,
  `var accessStaticMembers_hakk_ = function accessStaticMembers(Class) {
    return Class.staticMethod() + Class.staticField;
  };
  var accessStaticMembers = (...args) => accessStaticMembers_hakk_(...args);`);

testTransform(
  'function with import.meta usage (transformed to __import.meta)',
  `function useImportMeta() {
    return import.meta.url;
  }`,
  `var useImportMeta_hakk_ = function useImportMeta() {
    return __import.meta.url;
  };
  var useImportMeta = (...args) => useImportMeta_hakk_(...args);`);

testTransform(
  'function with BigInt and numeric separators',
  `function withBigInt() {
    const big = 123_456_789n;
    const regular = 1_000_000;
    return big + BigInt(regular);
  }`,
  `var withBigInt_hakk_ = function withBigInt() {
    const big = 123_456_789n;
    const regular = 1_000_000;
    return big + BigInt(regular);
  };
  var withBigInt = (...args) => withBigInt_hakk_(...args);`);

testTransform(
  'function with await expressions (async function)',
  `async function withAwait() {
    const result = await Promise.resolve(42);
    return result;
  }`,
  `var withAwait_hakk_ = async function withAwait() {
    const result = await Promise.resolve(42);
    return result;
  };
  var withAwait = (...args) => withAwait_hakk_(...args);`);

// ## class inheritance edge cases

testTransform(
  'simple class inheritance',
  `class Animal {
    constructor(name) {
      this.name = name;
    }
    speak() {
      return this.name + ' makes a sound';
    }
  }

  class Dog extends Animal {
    speak() {
      return this.name + ' barks';
    }
  }`,
  `var Animal = class Animal {
    constructor(name) {
      this.name = name;
    }
  };
  Animal.prototype.speak = function () {
    return this.name + ' makes a sound';
  };
  var Dog = class Dog extends Animal {};
  Dog.prototype.speak = function () {
    return this.name + ' barks';
  };`);

testTransform(
  'class with super constructor call',
  `class Parent {
    constructor(value) {
      this.value = value;
    }
  }

  class Child extends Parent {
    constructor(value, extra) {
      super(value);
      this.extra = extra;
    }
  }`,
  `var Parent = class Parent {
    constructor(value) {
      this.value = value;
    }
  };
  var Child = class Child extends Parent {
    constructor(value, extra) {
      super(value);
      this.extra = extra;
    }
  };`);

testTransform(
  'class with super method call in constructor',
  `class Base {
    init() {
      this.initialized = true;
    }
  }

  class Derived extends Base {
    constructor() {
      super();
      super.init();
    }
  }`,
  `var Base = class Base {};
  Base.prototype.init = function () {
    this.initialized = true;
  };
  var Derived = class Derived extends Base {
    constructor() {
      super();
      Base.prototype.init.call(this);
    }
  };`);

testTransform(
  'class with static inheritance',
  `class Parent {
    static getType() {
      return 'parent';
    }
  }

  class Child extends Parent {
    static getType() {
      return 'child';
    }
  }`,
  `var Parent = class Parent {};
  Parent.getType = function () {
    return 'parent';
  };
  var Child = class Child extends Parent {};
  Child.getType = function () {
    return 'child';
  };`);

testTransform(
  'class with private field inheritance',
  `class Parent {
    #privateField = 'parent';
    getPrivate() {
      return this.#privateField;
    }
  }

  class Child extends Parent {
    #childPrivate = 'child';
    getChildPrivate() {
      return this.#childPrivate;
    }
  }`,
  `var Parent = class Parent {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Parent.prototype, "_PRIVATE_privateField", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('parent');
  Parent.prototype.getPrivate = function () {
    return this._PRIVATE_privateField;
  };
  var Child = class Child extends Parent {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Child.prototype, "_PRIVATE_childPrivate", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('child');
  Child.prototype.getChildPrivate = function () {
    return this._PRIVATE_childPrivate;
  };`);

testTransform(
  'class with instance field inheritance',
  `class Parent {
    parentField = 'parent';
  }

  class Child extends Parent {
    childField = 'child';
  }`,
  `var Parent = class Parent {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Parent.prototype, "parentField", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('parent');
  var Child = class Child extends Parent {};
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Child.prototype, "childField", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('child');`);

testTransform(
  'class with static field inheritance',
  `class Parent {
    static parentStatic = 'parent';
  }

  class Child extends Parent {
    static childStatic = 'child';
  }`,
  `var Parent = class Parent {};
  Parent.parentStatic = 'parent';
  var Child = class Child extends Parent {};
  Child.childStatic = 'child';`);

testTransform(
  'class with getter/setter inheritance',
  `class Parent {
    get value() {
      return this._value;
    }
    set value(v) {
      this._value = v;
    }
  }

  class Child extends Parent {
    get doubled() {
      return this.value * 2;
    }
  }`,
  `var Parent = class Parent {};
  Object.defineProperty(Parent.prototype, "value", {
    get: function () {
      return this._value;
    },
    configurable: true
  });
  Object.defineProperty(Parent.prototype, "value", {
    set: function (v) {
      this._value = v;
    },
    configurable: true
  });
  var Child = class Child extends Parent {};
  Object.defineProperty(Child.prototype, "doubled", {
    get: function () {
      return this.value * 2;
    },
    configurable: true
  });`);

testTransform(
  'class with method overriding and super calls',
  `class Parent {
    method() {
      return 'parent';
    }
  }

  class Child extends Parent {
    method() {
      return super.method() + ' child';
    }
  }`,
  `var Parent = class Parent {};
  Parent.prototype.method = function () {
    return 'parent';
  };
  var Child = class Child extends Parent {};
  Child.prototype.method = function () {
    return Parent.prototype.method.call(this) + ' child';
  };`);

testTransform(
  'class with static method inheritance',
  `class Parent {
    static create() {
      return new this();
    }
  }

  class Child extends Parent {
    static create() {
      return new this();
    }
  }`,
  `var Parent = class Parent {};
  Parent.create = function () {
    return new this();
  };
  var Child = class Child extends Parent {};
  Child.create = function () {
    return new this();
  };`);

testTransform(
  'class with computed property names in inheritance',
  `class Parent {
    ['parent' + 'Method']() {
      return 'parent';
    }
  }

  class Child extends Parent {
    ['child' + 'Method']() {
      return 'child';
    }
  }`,
  `var Parent = class Parent {};
  Parent.prototype['parent' + 'Method'] = function () {
    return 'parent';
  };
  var Child = class Child extends Parent {};
  Child.prototype['child' + 'Method'] = function () {
    return 'child';
  };`);

testTransform(
  'class with async method inheritance',
  `class Parent {
    async parentAsync() {
      return 'parent';
    }
  }

  class Child extends Parent {
    async childAsync() {
      return 'child';
    }
  }`,
  `var Parent = class Parent {};
  Parent.prototype.parentAsync = async function () {
    return 'parent';
  };
  var Child = class Child extends Parent {};
  Child.prototype.childAsync = async function () {
    return 'child';
  };`);

testTransform(
  'class with generator method inheritance',
  `class Parent {
    *parentGen() {
      yield 'parent';
    }
  }

  class Child extends Parent {
    *childGen() {
      yield 'child';
    }
  }`,
  `var Parent = class Parent {};
  Parent.prototype.parentGen = function* () {
    yield 'parent';
  };
  var Child = class Child extends Parent {};
  Child.prototype.childGen = function* () {
    yield 'child';
  };`);

testTransform(
  'class with private method inheritance',
  `class Parent {
    #privateMethod() {
      return 'parent private';
    }
    callPrivate() {
      return this.#privateMethod();
    }
  }

  class Child extends Parent {
    #childPrivate() {
      return 'child private';
    }
    callChildPrivate() {
      return this.#childPrivate();
    }
  }`,
  `var Parent = class Parent {};
  Parent.prototype._PRIVATE_privateMethod = function () {
    return 'parent private';
  };
  Parent.prototype.callPrivate = function () {
    return this._PRIVATE_privateMethod();
  };
  var Child = class Child extends Parent {};
  Child.prototype._PRIVATE_childPrivate = function () {
    return 'child private';
  };
  Child.prototype.callChildPrivate = function () {
    return this._PRIVATE_childPrivate();
  };`);

testTransform(
  'class with static block inheritance',
  `class Parent {
    static parentStatic = 'parent';
    static {
      this.initialized = true;
    }
  }

  class Child extends Parent {
    static childStatic = 'child';
    static {
      this.childInitialized = true;
    }
  }`,
  `var Parent = class Parent {};
  Parent.parentStatic = 'parent';
  (function () {
    this.initialized = true;
  }).call(Parent);
  var Child = class Child extends Parent {};
  Child.childStatic = 'child';
  (function () {
    this.childInitialized = true;
  }).call(Child);`);

testTransform(
  'class with multiple inheritance levels',
  `class GrandParent {
    grandParentMethod() {
      return 'grandparent';
    }
  }

  class Parent extends GrandParent {
    parentMethod() {
      return 'parent';
    }
  }

  class Child extends Parent {
    childMethod() {
      return 'child';
    }
  }`,
  `var GrandParent = class GrandParent {};
  GrandParent.prototype.grandParentMethod = function () {
    return 'grandparent';
  };
  var Parent = class Parent extends GrandParent {};
  Parent.prototype.parentMethod = function () {
    return 'parent';
  };
  var Child = class Child extends Parent {};
  Child.prototype.childMethod = function () {
    return 'child';
  };`);

testTransform(
  'class with abstract-like pattern',
  `class AbstractBase {
    constructor() {
      if (this.constructor === AbstractBase) {
        throw new Error('Cannot instantiate abstract class');
      }
    }
    abstractMethod() {
      throw new Error('Abstract method must be implemented');
    }
  }

  class Concrete extends AbstractBase {
    abstractMethod() {
      return 'implemented';
    }
  }`,
  `var AbstractBase = class AbstractBase {
    constructor() {
      if (this.constructor === AbstractBase) {
        throw new Error('Cannot instantiate abstract class');
      }
    }
  };
  AbstractBase.prototype.abstractMethod = function () {
    throw new Error('Abstract method must be implemented');
  };
  var Concrete = class Concrete extends AbstractBase {};
  Concrete.prototype.abstractMethod = function () {
    return 'implemented';
  };`);

testTransform(
  'class with mixin-like pattern',
  `const TimestampMixin = (Base) => class extends Base {
    getTimestamp() {
      return Date.now();
    }
  };

  class BaseClass {
    getName() {
      return 'base';
    }
  }

  class MixedClass extends TimestampMixin(BaseClass) {
    getInfo() {
      return this.getName() + ' at ' + this.getTimestamp();
    }
  }`,
  `var TimestampMixin_hakk_ = Base => class extends Base {
    getTimestamp() {
      return Date.now();
    }
  };
  var TimestampMixin = (...args) => TimestampMixin_hakk_(...args);
  var BaseClass = class BaseClass {};
  BaseClass.prototype.getName = function () {
    return 'base';
  };
  var MixedClass = class MixedClass extends TimestampMixin(BaseClass) {};
  MixedClass.prototype.getInfo = function () {
    return this.getName() + ' at ' + this.getTimestamp();
  };`);

testTransform(
  'class with interface-like pattern',
  `class Drawable {
    draw() {
      throw new Error('draw method must be implemented');
    }
  }

  class Circle extends Drawable {
    constructor(radius) {
      super();
      this.radius = radius;
    }
    draw() {
      return 'Drawing circle with radius ' + this.radius;
    }
  }`,
  `var Drawable = class Drawable {};
  Drawable.prototype.draw = function () {
    throw new Error('draw method must be implemented');
  };
  var Circle = class Circle extends Drawable {
    constructor(radius) {
      super();
      this.radius = radius;
    }
  };
  Circle.prototype.draw = function () {
    return 'Drawing circle with radius ' + this.radius;
  };`);

testTransform(
  'class with complex super property access',
  `class Parent {
    static staticProp = 'parent static';
    instanceProp = 'parent instance';
  }

  class Child extends Parent {
    static staticProp = 'child static';
    instanceProp = 'child instance';

    static getParentStatic() {
      return super.staticProp;
    }

    getParentInstance() {
      return super.instanceProp;
    }
  }`,
  `var Parent = class Parent {};
  Parent.staticProp = 'parent static';
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Parent.prototype, "instanceProp", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('parent instance');
  var Child = class Child extends Parent {};
  Child.staticProp = 'child static';
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(Child.prototype, "instanceProp", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })('child instance');
  Child.getParentStatic = function () {
    return Parent.staticProp;
  };
  Child.prototype.getParentInstance = function () {
    return Parent.prototype.instanceProp;
  };`);

// ## Variable Declaration Edge Cases

testTransform(
  'multiple const declarations to separate var declarations',
  'const a = 1, b = 2, c = 3;',
  `var a = 1;
var b = 2;
var c = 3;`);

testTransform(
  'multiple let declarations to separate var declarations',
  'let x = 1, y = 2, z = 3;',
  `var x = 1;
var y = 2;
var z = 3;`);

testTransform(
  'multiple var declarations to separate var declarations',
  'var p = 1, q = 2, r = 3;',
  `var p = 1;
var q = 2;
var r = 3;`);

testTransform(
  'object destructuring with simple properties',
  'const { a, b, c } = obj;',
  `var {
  a,
  b,
  c
} = obj;`);

testTransform(
  'array destructuring with simple elements',
  'let [x, y, z] = array;',
  'var [x, y, z] = array;');

testTransform(
  'object destructuring with renamed properties',
  'var { name: userName, age: userAge, id: userId } = person;',
  `var {
  name: userName,
  age: userAge,
  id: userId
} = person;`);

testTransform(
  'nested object destructuring',
  'const { a: { b: { c } } } = nested;',
  `var {
  a: {
    b: {
      c
    }
  }
} = nested;`);

testTransform(
  'array destructuring with rest operator',
  'let [first, second, ...rest] = items;',
  'var [first, second, ...rest] = items;');

testTransform(
  'object destructuring with rest operator',
  'const { name, age, ...otherProps } = person;',
  `var {
  name,
  age,
  ...otherProps
} = person;`);

testTransform(
  'object destructuring with computed properties',
  'var { [key]: value, [getKey()]: result } = obj;',
  `var {
  [key]: value,
  [getKey()]: result
} = obj;`);

testTransform(
  'object destructuring with default values',
  'const { a = 1, b = 2, c = 3 } = obj;',
  `var {
  a = 1,
  b = 2,
  c = 3
} = obj;`);

testTransform(
  'array destructuring with default values',
  'let [x = 0, y = 0, z = 0] = array;',
  'var [x = 0, y = 0, z = 0] = array;');

testTransform(
  'mixed destructuring with defaults and rest',
  'var { name = "unknown", age = 0, ...rest } = person;',
  `var {
  name = "unknown",
  age = 0,
  ...rest
} = person;`);

testTransform(
  'complex nested destructuring with defaults',
  'const { user: { name = "guest", settings: { theme = "light" } } } = data;',
  `var {
  user: {
    name = "guest",
    settings: {
      theme = "light"
    }
  }
} = data;`);

testTransform(
  'array destructuring with mixed patterns',
  'let [first, { name, age }, ...others] = items;',
  `var [first, {
  name,
  age
}, ...others] = items;`);

testTransform(
  'object destructuring with string keys',
  'const { "string-key": stringValue, \'another-key\': anotherValue } = obj;',
  `var {
  "string-key": stringValue,
  'another-key': anotherValue
} = obj;`);

testTransform(
  'destructuring with function calls as defaults',
  'var { name = getName(), age = getAge() } = person;',
  `var {
  name = getName(),
  age = getAge()
} = person;`);

testTransform(
  'destructuring with complex expressions as defaults',
  'let { x = a + b, y = c * d } = obj;',
  `var {
  x = a + b,
  y = c * d
} = obj;`);

testTransform(
  'destructuring with template literals as defaults',
  // eslint-disable-next-line no-template-curly-in-string
  'const { message = `Hello ${name}` } = data;',
  `var {
  message = \`Hello \${name}\`
} = data;`);

testTransform(
  'destructuring with array patterns in objects',
  'var { coordinates: [x, y], dimensions: [width, height] } = shape;',
  `var {
  coordinates: [x, y],
  dimensions: [width, height]
} = shape;`);

testTransform(
  'destructuring with object patterns in arrays',
  'let [{ name, age }, { title, content }] = items;',
  `var [{
  name,
  age
}, {
  title,
  content
}] = items;`);

// ## Parser Error Handling

testParserError(
  'syntax error - invalid variable declaration',
  'const = 1;',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid function syntax',
  'function { return 1; }',
  /Unexpected token/
);

testParserError(
  'syntax error - missing closing brace',
  'const obj = { a: 1;',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid class syntax',
  'class { constructor() {} }',
  /A class name is required/
);

testParserError(
  'syntax error - invalid import syntax',
  'import { from "module";',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid export syntax',
  'export { from "module";',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid arrow function',
  'const fn = => 1;',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid template literal',
  'const str = `hello;',
  /Unterminated template/
);

testParserError(
  'syntax error - invalid object method',
  'const obj = { method() { return 1; };',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid spread syntax',
  'const arr = [...];',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid async syntax',
  'async function { return 1; }',
  /Unexpected token/
);

testParserError(
  'syntax error - invalid generator syntax',
  'function* { yield 1; }',
  /Unexpected token/
);
