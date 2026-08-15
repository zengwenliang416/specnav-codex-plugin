'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const {
  PROVIDER_KEYS
} = require('./provider-contract');

const CONFIG_RELATIVE_PATH = path.join('.specnav', 'config.json');
const PROJECT_RUNTIME_RELATIVE_PATH = path.join(
  '.specnav',
  'runtime',
  'verification'
);
const USER_RUNTIME_RELATIVE_PATH = path.join(
  '.specnav',
  'runtime',
  'verification'
);
const VALID_SCOPES = Object.freeze(['project', 'user']);

function projectConfigPath(projectRoot) {
  return path.join(path.resolve(projectRoot), CONFIG_RELATIVE_PATH);
}

function projectRuntimeBase(projectRoot) {
  return path.join(path.resolve(projectRoot), PROJECT_RUNTIME_RELATIVE_PATH);
}

function userRuntimeBase(homeDirectory = os.homedir()) {
  return path.join(path.resolve(homeDirectory), USER_RUNTIME_RELATIVE_PATH);
}

function projectProviderFile(projectRoot) {
  return path.join(
    path.resolve(projectRoot),
    '.specnav',
    'secrets',
    'verification.env'
  );
}

function projectIgnoreFile(projectRoot) {
  return path.join(path.resolve(projectRoot), '.specnav', '.gitignore');
}

function userProviderFile(homeDirectory = os.homedir()) {
  return path.join(
    path.resolve(homeDirectory),
    '.specnav',
    'secrets',
    'verification.env'
  );
}

function blocker(id, artifact, detail = null) {
  return { id, artifact, detail };
}

function assertPathComponentsSafe(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new Error('path-outside-scope-root');
  }
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`symlink-component:${current}`);
    }
  }
}

function assertScopePathsSafe(scope, options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  if (scope === 'project') {
    assertPathComponentsSafe(projectRoot, projectConfigPath(projectRoot));
    assertPathComponentsSafe(projectRoot, projectRuntimeBase(projectRoot));
    assertPathComponentsSafe(projectRoot, projectProviderFile(projectRoot));
    assertPathComponentsSafe(projectRoot, projectIgnoreFile(projectRoot));
    return;
  }
  if (scope === 'user') {
    const homeDirectory = path.resolve(options.homeDirectory || os.homedir());
    assertPathComponentsSafe(
      homeDirectory,
      userRuntimeBase(homeDirectory)
    );
    assertPathComponentsSafe(
      homeDirectory,
      userProviderFile(homeDirectory)
    );
  }
}

function readProjectConfig(projectRoot) {
  const file = projectConfigPath(projectRoot);
  try {
    assertPathComponentsSafe(path.resolve(projectRoot), file);
    if (!fs.existsSync(file)) {
      return {
        ok: true,
        exists: false,
        file,
        value: null,
        blockers: []
      };
    }
    if (fs.lstatSync(file).isSymbolicLink()) {
      throw new Error('config-file-symlink');
    }
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('config-root-must-be-object');
    }
    const scope = value.verification?.runtime_scope;
    if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
      throw new Error(`invalid-runtime-scope:${String(scope)}`);
    }
    return {
      ok: true,
      exists: true,
      file,
      value,
      blockers: []
    };
  } catch (error) {
    return {
      ok: false,
      exists: true,
      file,
      value: null,
      blockers: [blocker(
        'verification-runtime:project-config-invalid',
        file,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

function explicitRuntimeBase(environment = process.env) {
  const value = environment.SPECNAV_VERIFICATION_RUNTIME_BASE;
  return typeof value === 'string' && value.trim()
    ? path.resolve(value)
    : null;
}

function candidate(scope, runtimeBase, runtimeVersion) {
  const runtimeRoot = runtimeVersion
    ? path.join(runtimeBase, runtimeVersion)
    : null;
  return {
    scope,
    runtime_base: runtimeBase,
    runtime_root: runtimeRoot,
    exists: runtimeRoot ? fs.existsSync(runtimeRoot) : fs.existsSync(runtimeBase)
  };
}

function inspectRuntimeScopes(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const runtimeVersion = options.runtimeVersion || null;
  const environment = options.environment || process.env;
  const config = readProjectConfig(projectRoot);
  const explicitBase = options.runtimeBase
    ? path.resolve(options.runtimeBase)
    : explicitRuntimeBase(environment);
  const candidates = {
    project: candidate(
      'project',
      projectRuntimeBase(projectRoot),
      runtimeVersion
    ),
    user: candidate(
      'user',
      userRuntimeBase(options.homeDirectory),
      runtimeVersion
    )
  };

  if (!config.ok) {
    return {
      schema: 'specnav.verification.runtime-scope-inspection.v1',
      ok: false,
      project_root: projectRoot,
      config_file: config.file,
      selected_scope: null,
      selection_source: null,
      runtime_base: null,
      runtime_root: null,
      candidates,
      blockers: config.blockers,
      actions: [],
      fallback_used: false
    };
  }

  if (explicitBase) {
    return {
      schema: 'specnav.verification.runtime-scope-inspection.v1',
      ok: true,
      project_root: projectRoot,
      config_file: config.file,
      selected_scope: 'explicit',
      selection_source: options.selectionSource
        || (options.runtimeBase ? 'runtime-argument' : 'environment'),
      runtime_base: explicitBase,
      runtime_root: runtimeVersion
        ? path.join(explicitBase, runtimeVersion)
        : null,
      candidates,
      blockers: [],
      actions: [],
      fallback_used: false
    };
  }

  const selectedScope = config.value?.verification?.runtime_scope || null;
  if (selectedScope) {
    const selected = candidates[selectedScope];
    try {
      assertScopePathsSafe(selectedScope, {
        projectRoot,
        homeDirectory: options.homeDirectory
      });
    } catch (error) {
      return {
        schema: 'specnav.verification.runtime-scope-inspection.v1',
        ok: false,
        project_root: projectRoot,
        config_file: config.file,
        selected_scope: selectedScope,
        selection_source: 'project-config',
        runtime_base: null,
        runtime_root: null,
        candidates,
        blockers: [blocker(
          'verification-runtime:scope-path-unsafe',
          selected.runtime_base,
          error instanceof Error ? error.message : String(error)
        )],
        actions: [],
        fallback_used: false
      };
    }
    return {
      schema: 'specnav.verification.runtime-scope-inspection.v1',
      ok: true,
      project_root: projectRoot,
      config_file: config.file,
      selected_scope: selectedScope,
      selection_source: 'project-config',
      runtime_base: selected.runtime_base,
      runtime_root: selected.runtime_root,
      candidates,
      blockers: [],
      actions: [],
      fallback_used: false
    };
  }

  return {
    schema: 'specnav.verification.runtime-scope-inspection.v1',
    ok: false,
    project_root: projectRoot,
    config_file: config.file,
    selected_scope: null,
    selection_source: null,
    runtime_base: null,
    runtime_root: null,
    candidates,
    blockers: [blocker(
      'verification-runtime:scope-selection-required',
      config.file,
      {
        project_runtime_detected: candidates.project.exists,
        user_runtime_detected: candidates.user.exists
      }
    )],
    actions: [],
    fallback_used: false
  };
}

function resolveSelectedRuntimeBase(options = {}) {
  const inspection = inspectRuntimeScopes(options);
  if (!inspection.ok) {
    const error = new Error('verification-runtime:scope-selection-required');
    error.blockers = inspection.blockers;
    error.inspection = inspection;
    throw error;
  }
  return inspection;
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600
  });
  fs.renameSync(temporary, file);
}

function ensureProjectSpecNavIgnore(projectRoot) {
  const file = projectIgnoreFile(projectRoot);
  assertPathComponentsSafe(path.resolve(projectRoot), file);
  const required = ['runtime/', 'secrets/'];
  const existing = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  const lines = [...existing];
  for (const entry of required) {
    if (!lines.includes(entry)) lines.push(entry);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

function selectRuntimeScope(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const scope = options.scope;
  if (!VALID_SCOPES.includes(scope)) {
    return {
      schema: 'specnav.verification.runtime-scope-selection.v1',
      ok: false,
      project_root: projectRoot,
      selected_scope: null,
      config_file: projectConfigPath(projectRoot),
      runtime_base: null,
      blockers: [blocker(
        'verification-runtime:invalid-scope',
        'runtime_scope',
        { received: scope || null, allowed: VALID_SCOPES }
      )],
      fallback_used: false
    };
  }

  const current = readProjectConfig(projectRoot);
  if (!current.ok) {
    return {
      schema: 'specnav.verification.runtime-scope-selection.v1',
      ok: false,
      project_root: projectRoot,
      selected_scope: null,
      config_file: current.file,
      runtime_base: null,
      blockers: current.blockers,
      fallback_used: false
    };
  }

  try {
    assertScopePathsSafe(scope, {
      projectRoot,
      homeDirectory: options.homeDirectory
    });
  } catch (error) {
    return {
      schema: 'specnav.verification.runtime-scope-selection.v1',
      ok: false,
      project_root: projectRoot,
      selected_scope: null,
      config_file: current.file,
      runtime_base: null,
      blockers: [blocker(
        'verification-runtime:scope-path-unsafe',
        scope,
        error instanceof Error ? error.message : String(error)
      )],
      fallback_used: false
    };
  }

  const value = {
    ...(current.value || {}),
    schema: current.value?.schema || 'specnav.project-config.v1',
    verification: {
      ...(current.value?.verification || {}),
      runtime_scope: scope
    }
  };
  writeJsonAtomic(current.file, value);
  const ignoreFile = ensureProjectSpecNavIgnore(projectRoot);
  return {
    schema: 'specnav.verification.runtime-scope-selection.v1',
    ok: true,
    project_root: projectRoot,
    selected_scope: scope,
    config_file: current.file,
    ignore_file: ignoreFile,
    runtime_base: scope === 'project'
      ? projectRuntimeBase(projectRoot)
      : userRuntimeBase(options.homeDirectory),
    blockers: [],
    fallback_used: false
  };
}

function packageProbe(name, searchRoots) {
  for (const root of searchRoots) {
    try {
      const runtimeRequire = createRequire(path.join(root, '__specnav_probe__.js'));
      const manifestFile = require.resolve(`${name}/package.json`, {
        paths: [root]
      });
      const manifest = runtimeRequire(manifestFile);
      return {
        name,
        detected: true,
        version: manifest.version || null,
        source: root,
        usable_as_managed_runtime: false
      };
    } catch {
      // Continue probing declared machine roots.
    }
  }
  return {
    name,
    detected: false,
    version: null,
    source: null,
    usable_as_managed_runtime: false
  };
}

function commandPath(name) {
  const result = spawnSync('sh', ['-lc', `command -v ${name}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
}

function globalNodeModules() {
  const result = spawnSync('npm', ['root', '-g'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  });
  return result.status === 0 && result.stdout.trim()
    ? result.stdout.trim()
    : null;
}

function probeMachineComponents(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const globalRoot = globalNodeModules();
  const searchRoots = [
    projectRoot,
    ...(globalRoot ? [globalRoot] : [])
  ];
  const browserCandidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ];
  const browserPath = browserCandidates.find((file) => fs.existsSync(file))
    || null;
  return {
    schema: 'specnav.verification.machine-components.v1',
    packages: [
      packageProbe('@playwright/test', searchRoots),
      packageProbe('playwright', searchRoots),
      packageProbe('@midscene/web', searchRoots)
    ],
    commands: {
      ffmpeg: {
        detected: commandPath('ffmpeg') !== null,
        usable_as_managed_runtime: false
      }
    },
    browsers: {
      chromium_family: {
        detected: browserPath !== null,
        usable_as_managed_runtime: false
      }
    }
  };
}

function parseEnvironmentFile(content) {
  const environment = {};
  const allowed = new Set(PROVIDER_KEYS);
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = raw.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new Error(`invalid-line:${index + 1}`);
    const [, name, encodedValue] = match;
    if (!allowed.has(name)) throw new Error(`unsupported-key:${name}`);
    if (Object.prototype.hasOwnProperty.call(environment, name)) {
      throw new Error(`duplicate-key:${name}`);
    }
    let value = encodedValue.trim();
    if (
      value.length >= 2
      && (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      )
    ) {
      value = value.slice(1, -1);
    }
    if (!value) throw new Error(`empty-value:${name}`);
    environment[name] = value;
  }
  return environment;
}

function loadProviderEnvironment(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const scope = options.scope;
  if (scope === 'explicit') {
    return {
      ok: true,
      scope,
      source: 'process-environment',
      file: null,
      environment: options.environment || process.env,
      blockers: []
    };
  }
  if (!VALID_SCOPES.includes(scope)) {
    return {
      ok: false,
      scope: scope || null,
      source: null,
      file: null,
      environment: {},
      blockers: [blocker(
        'verification-runtime:provider-scope-invalid',
        'runtime_scope',
        scope || null
      )]
    };
  }
  const file = scope === 'project'
    ? projectProviderFile(projectRoot)
    : userProviderFile(options.homeDirectory);
  try {
    assertScopePathsSafe(scope, {
      projectRoot,
      homeDirectory: options.homeDirectory
    });
  } catch (error) {
    return {
      ok: false,
      scope,
      source: 'scope-file',
      file,
      environment: {},
      blockers: [blocker(
        'verification-runtime:provider-config-invalid',
        file,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
  if (!fs.existsSync(file)) {
    return {
      ok: true,
      scope,
      source: 'scope-file',
      file,
      environment: {},
      blockers: []
    };
  }
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('unsafe-file-type');
    }
    if ((stat.mode & 0o777) !== 0o600) {
      throw new Error('file-mode-must-be-0600');
    }
    return {
      ok: true,
      scope,
      source: 'scope-file',
      file,
      environment: parseEnvironmentFile(fs.readFileSync(file, 'utf8')),
      blockers: []
    };
  } catch (error) {
    return {
      ok: false,
      scope,
      source: 'scope-file',
      file,
      environment: {},
      blockers: [blocker(
        'verification-runtime:provider-config-invalid',
        file,
        error instanceof Error ? error.message : String(error)
      )]
    };
  }
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  PROJECT_RUNTIME_RELATIVE_PATH,
  VALID_SCOPES,
  assertPathComponentsSafe,
  assertScopePathsSafe,
  ensureProjectSpecNavIgnore,
  explicitRuntimeBase,
  inspectRuntimeScopes,
  loadProviderEnvironment,
  parseEnvironmentFile,
  probeMachineComponents,
  projectConfigPath,
  projectIgnoreFile,
  projectProviderFile,
  projectRuntimeBase,
  readProjectConfig,
  resolveSelectedRuntimeBase,
  selectRuntimeScope,
  userProviderFile,
  userRuntimeBase
};
