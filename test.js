const fs = require('fs');

let x = 0;

let y = 10;

const bump = () => {
  // console.log("hello there, bump!");
  y = y * 2;
  return ++x;
};

const set = (a) => {
  x = a;
  y = x / 2;
};

const blah = () => {
  const result = fs.readFileSync('test.js', 'utf8');
  return result;
};

class TestClass {
  constructor () {
    console.log("here's the constructor");
  }

  testMethod () {
    console.log('hi there from testMethod');
  }
}
