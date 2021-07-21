#! /usr/bin/env node

console.log('bin...', process.cwd());

const path = require('path');

// config 配置文件
const config = require(path.resolve('webpack.config.js'));

const Compiler = require('../lib/Compiler');

const compiler = new Compiler(config);

// 调用 hook
compiler.hooks.entryOption.call();

compiler.run();
