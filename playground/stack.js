
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
  console.log("gamma");
  beta();
}

class Delta {
  static epsilon() {
    const d = new Delta();
    d.#runDelta();
  }

  #runDelta() {
    // comment
    console.log("delta");
    gamma();
  }
}

var q = {
  phi() {
    Delta.epsilon();
  }
}
