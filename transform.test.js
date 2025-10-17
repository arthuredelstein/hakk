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

testTransform('convert var assignment to await to two statements', 'var x = await Promise.resolve(1);', 'var x; x = await Promise.resolve(1);');

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
  (function (initValue) {
    const valueMap = new WeakMap();
    Object.defineProperty(A.prototype, "field1", {
      get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
      set(newValue) { valueMap.set(this, newValue); },
      configurable: true
    });
  })(3);`);

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
(function (initValue) {
  const valueMap = new WeakMap();
  Object.defineProperty(A.prototype, "_PRIVATE_field1", {
    get() { return valueMap.has(this) ? valueMap.get(this) : initValue; },
    set(newValue) { valueMap.set(this, newValue); },
    configurable: true
  });
})(7);`);

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
  'convert super property access in instance method (returns undefined for class fields)',
  `class Child extends Parent {
    getValue() {
      return super.instanceProperty;
    }
  }`,
  `var Child = class Child extends Parent {};
  Child.prototype.getValue = function () {
    return undefined;
  };`);

testTransform(
  'convert super method call vs super property access (different behaviors)',
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
      property: undefined
    };
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

// ## Private Field Access

testTransform(
  'convert private field access in instance method',
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
  'convert private field access in static method',
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
  'convert private field access with assignment',
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
  'convert private field access in getter',
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
  'convert private field access in setter',
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
  'convert private field access in constructor',
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
  'convert private field access with complex expressions',
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
  'convert private field access in static block',
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
  'convert private field access with multiple private fields',
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
  'convert nested object with methods (nested objects not transformed)',
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
  'convert object with method referencing this',
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
  'convert object with complex computed properties (now supported)',
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
  'convert object with mixed property types and methods (Symbol.iterator now supported)',
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
  'convert object with nested computed properties (nested objects not transformed)',
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
  'convert object with method calling other methods',
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
  'convert object with getter and setter using private-like pattern',
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
  'convert object with async methods and complex expressions',
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
  'convert object with generator methods',
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

// ## function edge cases

testTransform(
  'convert function with complex parameter destructuring',
  `function complexParams({ a, b = 1 }, [c, d = 2], ...rest) {
    return a + b + c + d + rest.length;
  }`,
  `var complexParams_hakk_ = function complexParams({ a, b = 1 }, [c, d = 2], ...rest) {
    return a + b + c + d + rest.length;
  };
  var complexParams = (...args) => complexParams_hakk_(...args);`);

testTransform(
  'convert function with default parameters and rest parameters',
  `function withDefaults(a = 1, b = 2, ...c) {
    return a + b + c.length;
  }`,
  `var withDefaults_hakk_ = function withDefaults(a = 1, b = 2, ...c) {
    return a + b + c.length;
  };
  var withDefaults = (...args) => withDefaults_hakk_(...args);`);

testTransform(
  'convert function with complex return statement',
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
  'convert function with nested function declarations',
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
  'convert function with this binding and call/apply',
  `function boundFunction() {
    return this.value;
  }`,
  `var boundFunction_hakk_ = function boundFunction() {
    return this.value;
  };
  var boundFunction = (...args) => boundFunction_hakk_(...args);`);

testTransform(
  'convert function with try-catch-finally',
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
  'convert function with switch statement',
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
  'convert function with labeled statements',
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
  'convert function with yield expressions (generator)',
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
  'convert function with await expressions (async)',
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
  'convert function with class instantiation',
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
  'convert function with template literals and tagged templates',
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
  'convert function with object and array patterns',
  `function withPatterns({ x, y }, [a, b]) {
    return { x, y, a, b };
  }`,
  `var withPatterns_hakk_ = function withPatterns({ x, y }, [a, b]) {
    return { x, y, a, b };
  };
  var withPatterns = (...args) => withPatterns_hakk_(...args);`);

testTransform(
  'convert function with optional chaining and nullish coalescing',
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
  'convert function with logical assignment operators',
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
  'convert function with private class fields access (not supported outside class)',
  `function accessPrivateFields(instance) {
    return instance.privateField;
  }`,
  `var accessPrivateFields_hakk_ = function accessPrivateFields(instance) {
    return instance.privateField;
  };
  var accessPrivateFields = (...args) => accessPrivateFields_hakk_(...args);`);

testTransform(
  'convert function with static class members access',
  `function accessStaticMembers(Class) {
    return Class.staticMethod() + Class.staticField;
  }`,
  `var accessStaticMembers_hakk_ = function accessStaticMembers(Class) {
    return Class.staticMethod() + Class.staticField;
  };
  var accessStaticMembers = (...args) => accessStaticMembers_hakk_(...args);`);

testTransform(
  'convert function with import.meta usage (transformed to __import.meta)',
  `function useImportMeta() {
    return import.meta.url;
  }`,
  `var useImportMeta_hakk_ = function useImportMeta() {
    return __import.meta.url;
  };
  var useImportMeta = (...args) => useImportMeta_hakk_(...args);`);

testTransform(
  'convert function with BigInt and numeric separators',
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
  'convert function with await expressions (async function)',
  `async function withAwait() {
    const result = await Promise.resolve(42);
    return result;
  }`,
  `var withAwait_hakk_ = async function withAwait() {
    const result = await Promise.resolve(42);
    return result;
  };
  var withAwait = (...args) => withAwait_hakk_(...args);`);
