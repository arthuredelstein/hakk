const { prepareCode } = require('./index.js');

const cleanString = (x) =>
  x.replace(/\s+/g, " ");

const testTransform = (description, before, after) =>
  test(description, () => {
    expect(cleanString(prepareCode(before)))
      .toBe(cleanString(after))
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

testTransform('preserve constructor',
  `class A extends B {
  constructor(b, a) {
    super(a, b);
  }
}`,
`var A = class A extends B {
  constructor(b, a) {
    super(a, b);
  }
};`);
