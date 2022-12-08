const fs = require('fs');

let x = 0;

let y = 10;

const bump = () => {
  // console.log("hello there, bump!");
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
  x = a;
  y = a;
};

function toTitleCase(str) {
  return str.replace(
    /\w\S*/g,
    function(txt) {
      return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    }
  );
}

const reverse = (s) => {
  return s.split("").reverse().join("");
}

const join = (a, b) => {
  return toTitleCase(a) + " " + toTitleCase(b);
};


