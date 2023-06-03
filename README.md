# hakk

Interactive programming for Node.js. Speed up your JavaScript development!

## Introduction

`hakk` is a tool for Node.js that allows you to interactively develop, modify, and test your JavaScript code while it's running.

`hakk` watches your JavaScript source files, and hot updates any code you modify while your code is running. It also provides an interactive prompt (similar to the Node.js REPL) that lets you test individual parts of your program as you tinker with them.

`hakk` runs in your terminal and works alongside any code editor.

## Getting started

To install `hakk`, enter the following in your shell:
```
npm install -g hakk
```
To run `hakk`:
```
cd my-node-js-project
hakk index.js
```

## What you can do with `hakk`
### Edit your program while it's running

If you edit any source file, `hakk` will hot-swap the modified variable, function or class. Existing code that hasn't been changed doesn't get reloaded: your program will maintain its running state. Things you can change include:

  - **Variables:** All top-level variables can be modified or redefined on the fly, including variables that were already defined using `const` or `let`.
  - **Functions:** You can define new functions, or change the implementation of an existing function.
  - **Classes:** You can add new classes, and modify existing classes. If you add a new method or field to a class, existing instances of that class will immediately adopt the new behavior.
  - **Imports:** You can use `require` or `import` to import new library APIs in your running program.

### Interact with your program while it's running

`hakk` is built around the familiar Node.js REPL interface. You can call functions you are working on in your source file to test them as you develop them. You can enter a top-level variable and the REPL will return that variable's value. You can modify variables in the REPL, including those that were declared with `const`!

## Under development

`hakk` is an experimental tool. Bug reports and other feedback is welcome at https://github.com/arthuredelstein/hakk

(c) 2023 Arthur Edelstein