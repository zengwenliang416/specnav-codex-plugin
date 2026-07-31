'use strict';

const { spawn: spawnProcess } = require('node:child_process');

function commandBlocker(id, detail) {
  return {
    id,
    artifact: 'command',
    detail
  };
}

function isEnvironment(value) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

function validateCommand(command) {
  const blockers = [];
  if (
    !command
    || !Array.isArray(command.argv)
    || command.argv.length === 0
    || command.argv.some((entry) => (
      typeof entry !== 'string' || entry.length === 0
    ))
  ) {
    blockers.push(commandBlocker(
      'verification-execution:command-argv-invalid',
      'argv must contain at least one non-empty string'
    ));
  }
  if (!command || typeof command.cwd !== 'string' || command.cwd.length === 0) {
    blockers.push(commandBlocker(
      'verification-execution:command-cwd-invalid',
      'cwd must be an explicit non-empty string'
    ));
  }
  if (!command || !isEnvironment(command.env)) {
    blockers.push(commandBlocker(
      'verification-execution:command-env-invalid',
      'env must be an explicit object containing only string values'
    ));
  }
  return {
    ok: blockers.length === 0,
    blockers
  };
}

function createCommandAdapter(options = {}) {
  const spawn = options.spawn || spawnProcess;
  const killSignal = options.killSignal || 'SIGTERM';
  const killGraceMs = Number.isInteger(options.killGraceMs)
    && options.killGraceMs >= 0
    ? options.killGraceMs
    : 1000;

  async function execute(command, executeOptions = {}) {
    const validation = validateCommand(command);
    if (!validation.ok) {
      const error = new Error('verification-execution:command-invalid');
      error.blockers = validation.blockers;
      throw error;
    }

    const argv = [...command.argv];
    const cwd = command.cwd;
    const env = { ...command.env };
    const timeoutMs = executeOptions.timeoutMs;
    const signal = executeOptions.signal;
    const onEvent = typeof executeOptions.onEvent === 'function'
      ? executeOptions.onEvent
      : () => {};

    if (signal?.aborted) {
      const result = {
        exit_status: null,
        signal: null,
        timed_out: false,
        canceled: true,
        spawn_error: null,
        stdout: '',
        stderr: ''
      };
      onEvent({ type: 'terminal', result });
      return result;
    }

    return new Promise((resolve) => {
      let child;
      let timeout = null;
      let hardKillTimeout = null;
      let settled = false;
      let exited = false;
      let stopReason = null;
      let timedOut = false;
      let canceled = false;
      let stdout = '';
      let stderr = '';

      function cleanup() {
        if (timeout) clearTimeout(timeout);
        if (hardKillTimeout) clearTimeout(hardKillTimeout);
        if (signal) signal.removeEventListener('abort', cancel);
      }

      function finish(result) {
        if (settled) return;
        settled = true;
        cleanup();
        const terminal = {
          exit_status: result.exit_status,
          signal: result.signal,
          timed_out: timedOut,
          canceled,
          spawn_error: result.spawn_error || null,
          stdout,
          stderr
        };
        onEvent({ type: 'terminal', result: terminal });
        resolve(terminal);
      }

      function markExited() {
        exited = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        if (signal) signal.removeEventListener('abort', cancel);
      }

      function stop(reason) {
        if (settled || exited || !child || stopReason) return;
        if (!child.kill(killSignal)) return;
        stopReason = reason;
        if (reason === 'timeout') timedOut = true;
        if (reason === 'canceled') canceled = true;
        if (killSignal !== 'SIGKILL' && !hardKillTimeout) {
          hardKillTimeout = setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
          }, killGraceMs);
        }
      }

      function cancel() {
        stop('canceled');
      }

      try {
        child = spawn(argv[0], argv.slice(1), {
          cwd,
          env,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        finish({
          exit_status: null,
          signal: null,
          spawn_error: error instanceof Error ? error.message : String(error)
        });
        return;
      }

      child.once('spawn', () => {
        onEvent({ type: 'started' });
      });
      child.stdout.on('data', (chunk) => {
        const value = chunk.toString();
        stdout += value;
        onEvent({ type: 'stdout', chunk: value });
      });
      child.stderr.on('data', (chunk) => {
        const value = chunk.toString();
        stderr += value;
        onEvent({ type: 'stderr', chunk: value });
      });
      child.once('error', (error) => {
        finish({
          exit_status: null,
          signal: null,
          spawn_error: error instanceof Error ? error.message : String(error)
        });
      });
      child.once('exit', markExited);
      child.once('close', (exitStatus, processSignal) => {
        finish({
          exit_status: exitStatus,
          signal: processSignal,
          spawn_error: null
        });
      });

      if (Number.isInteger(timeoutMs) && timeoutMs > 0) {
        timeout = setTimeout(() => stop('timeout'), timeoutMs);
      }
      if (signal) signal.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }

  return Object.freeze({
    execute,
    validate: validateCommand
  });
}

module.exports = {
  commandBlocker,
  createCommandAdapter,
  validateCommand
};
