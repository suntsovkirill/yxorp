#!/usr/bin/env node

var path = require('path');
var nodemon = require('nodemon');
var nodemonDefaults = require('nodemon/lib/config/defaults');

var pathToTsNode = path.normalize(__dirname + './../node_modules/.bin/ts-node');
var filepath = path.normalize(__dirname + './../src/index.ts')

nodemonDefaults.execMap.ts = pathToTsNode;

nodemon({
  script: filepath,
  watch: ['yxopr.json']
});

nodemon.on('quit', function () {
  console.log('Yxopr has quit');
  process.exit();
}).on('restart', function (files) {
  console.log('Yxopr restarts...');
});
