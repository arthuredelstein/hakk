# hakk

A Node.js REPL that lets you hack live on running JavaScript programs.

## What hakk does

`hakk` runs a JavaScript source file you specify and then watches it for modifications. If you modify the code in that source file, it will load the modified code. Existing code that hasn't been modified doesn't get reloaded -- that means your program will maintain its running state when you change it.

### Code you can change

You can modify any code in the source file and `hakk` will keep things running. Things you can change include:

  - Variables. All top-level variables can be modified on the fly, including those defined using `const` or `let`.
  - Functions. You can define new functions, or change the implementation of an existing function
  - Classes. You can add new classes, and modify existing classes. If you add a new method or field to a class, existing instances of that class will immediately adopt the new behavior.
  - Imports. You can use `require` or `import` to import new library APIs in your running program.

### Familiar Node.js REPL

`hakk` is built around the familiar Node.js REPL interface. You can call functions you are working on in your source file to test them as you develop them. You can enter a top-level variable and the REPL will return that variable's value.

### Getting started

To install `hakk`:
```
git clone https://github.com/arthuredelstein/hakk
cd hakk
sudo npm install -g .
```
To run `hakk`:
```
cd my-node-js-project
hakk my-file.js
```

### Under development

`hakk` is an experimental tool. Feedback is welcome!