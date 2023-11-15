#!/usr/bin/env node

try {
  require('../dist/index.js');
} catch (e) {
  if (e.code === 'MODULE_NOT_FOUND') {
    console.error(
      'Yxorp is not built. Run `npm run build` first, or use `npm start` for development.'
    );
    process.exit(1);
  }
  throw e;
}
