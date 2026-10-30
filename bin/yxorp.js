#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const entry = path.join(__dirname, '../dist/index.js');

// Check for the build output explicitly rather than catching MODULE_NOT_FOUND
// from require() — that error also fires for any module missing *inside* the
// app (e.g. an uninstalled dependency), which is not a "not built" problem.
if (!fs.existsSync(entry)) {
  console.error(
    'Yxorp is not built. Run `npm run build` first, or use `npm start` for development.'
  );
  process.exit(1);
}

require(entry);
