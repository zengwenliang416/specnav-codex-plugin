#!/usr/bin/env node
'use strict';

const TASK_ID_PATTERN = /^[0-9]{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidTaskId(value) {
  return TASK_ID_PATTERN.test(value || '');
}

module.exports = {
  TASK_ID_PATTERN,
  isValidTaskId
};
