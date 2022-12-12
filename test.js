const fs = require('fs');

let x = 0;

let y = 10;

const bump = () => {
  // console.log"hello there, bump!");
  return x += 1;
};

const set = (a) => {
  x = a;
  y = x / 2;
};

const blah = () => {
  const result = fs.readFileSync('test.js', 'utf8');
  return result;
};

const foo = (a) => {
  x = a + 1;
  y = a * 2;
};

class MyClass {
  constructor() {
    this.q_ = 0;
  }
  myField = 0;
  static myStaticField = 3;
  uninitializedField = 7;
  inc() {
    this.q_++;
  }
  dec() {
    this.q_--;
  }
  dec2() {
    this.q_+=-2;
  }
  dec3() {
    this.q_+=-3;
  }
  incN(N) {
    this.q_-=N;
  }
  inc2() {
    this.q_+=2;
  }
  halve() {
    this.q_ /= 2;
  }
  async generator() {
    return 1;
  }
  static run() {
    console.log("run a static method, baby");
  }
  get q() {
    return this.q_;
  }
  set q(value) {
    this.q_ = value;
    console.log("set to " + value);
  }
  toString() {
    return `yabba ${this.q_} dabba`;
  }
};

class TestClass {
  x_ = 0;
  inc() {
    this.x_++;
  }
};

const thpbbb = (name, count) => {
  let result = [];
  for (let i = 0; i < count; ++i) {
    result.push(name);
  }
  return result.join(" X ");
};

function toTitleCase(str) {
  return str.replace(
    /\w\S*/g,
    function(txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    }
  );
}

const deebee = (n) => {
  let answer = "";
  for (i = 0; i < n; ++i) {
    answer += "wfoub2oeufheoufh";
  }
  return answer;
};

const invertMap = (m) => {
  let result = {};
  for (let [k,v] of Object.entries(m)) {
    result[v] = k;
  }
  return result;
}

const addSome = (a) => 19 + a;

const reverse = (s) => {
  return s.split("").reverse().join("");
}

const join = (a, b) => {
  return toTitleCase(a) + " " + toTitleCase(b);
};
