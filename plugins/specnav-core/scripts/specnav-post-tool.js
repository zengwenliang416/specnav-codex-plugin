#!/usr/bin/env node
'use strict';

// Upgrade tombstone for Codex tasks resumed from a hook snapshot created
// before verification invalidation moved into specnav-guard.js.
//
// New installations do not register this script. It must remain silent and
// successful so an old task cannot fail after the plugin cache is upgraded.
try {
  require('fs').readFileSync(0, 'utf8');
} catch {}

process.exit(0);
