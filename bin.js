#!/usr/bin/env node

const lib = require("./index.js");
const minimist = require("minimist");

const argv = minimist(process.argv.slice(2));
const filename = argv._[0];
lib.run(filename);
