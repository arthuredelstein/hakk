






function alpha() {
  console.log("alpha");
  throw new Error("error in alpha");
}


function beta() {
  console.log("beta");
  alpha();
}
const gamma = function () {
  // comment
  // comment 2
  console.log("gamma!!");
  beta();
}

