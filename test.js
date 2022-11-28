const fs = require("fs");

const x = 0;

const y = 10;

const bump = () => {
  //console.log("hello there, bump!");
  y = y * 2;
  return ++x;
};

const set = (a) => {
  x = a;
  y = x / 2;
};

const blah = () => {
  const result = fs.readFileSync("test.js", "utf8");
  3return result;
};

