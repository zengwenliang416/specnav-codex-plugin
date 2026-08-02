'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../../..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function requireTokens(text, tokens, label) {
  for (const token of tokens) {
    assert.match(text, new RegExp(
      token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ), `${label}: ${token}`);
  }
}

const EN_README = read('README.md');
const ZH_README = read('README.zh-CN.md');

test('README files route users to the same full Verification 2.0 flow', () => {
  requireTokens(EN_README, [
    'Verification 2.0',
    'specnav-verification-runtime-status',
    'specnav-verification-runtime-setup',
    'docs/verification-2-0.md',
    'all six domains'
  ], 'README.md');
  requireTokens(ZH_README, [
    'Verification 2.0',
    'specnav-verification-runtime-status',
    'specnav-verification-runtime-setup',
    'docs/verification-2-0.zh-CN.md',
    '全部六个测试域'
  ], 'README.zh-CN.md');
  assert.doesNotMatch(
    EN_README,
    /Verification is reduced to static \+ unit evidence/i
  );
  assert.doesNotMatch(
    ZH_README,
    /验证范围降为 static \+ unit/
  );
});

test('matched English and Chinese guides cover every user-visible contract', () => {
  const english = read('docs/verification-2-0.md');
  const chinese = read('docs/verification-2-0.zh-CN.md');
  const sharedFacts = [
    '2.0.0-alpha.1',
    'Playwright 1.62.1',
    'Midscene 1.10.8',
    'AJV 8.20.0',
    'gpt-5.6-luna',
    'specnav-verification-runtime-status',
    'specnav-verification-runtime-setup',
    'specnav-verify-plan',
    'specnav-verify-rerun',
    'overview.html',
    'test-case-catalog.html',
    'test-case-results.html',
    'report-model.json',
    'report-render-manifest.json',
    'fallback_used: false'
  ];
  requireTokens(english, sharedFacts, 'English guide');
  requireTokens(chinese, sharedFacts, 'Chinese guide');
  requireTokens(english, [
    'Runtime Setup And Doctor',
    'Case Approval',
    'Six-Domain Execution',
    'Midscene Oracle Boundary',
    'Repair, Retest, And Regression',
    'V1 Migration',
    'Host Installation',
    'Blockers And Troubleshooting'
  ], 'English guide');
  requireTokens(chinese, [
    '运行时安装与诊断',
    '测试用例批准',
    '六域执行',
    'Midscene Oracle 边界',
    '修复、复测与回归',
    'V1 迁移',
    '宿主安装',
    '阻塞与故障排查'
  ], 'Chinese guide');
});

test('documentation preserves runtime, report, and no-fallback authority', () => {
  for (const [relative, text] of [
    ['docs/verification-2-0.md', read('docs/verification-2-0.md')],
    ['docs/verification-2-0.zh-CN.md', read('docs/verification-2-0.zh-CN.md')]
  ]) {
    requireTokens(text, [
      'node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" doctor',
      'node "$SPECNAV_VERIFICATION_ROOT/scripts/verification-runtime.js" install',
      '~/.specnav/runtime/verification/<version>/',
      'facticity',
      'static',
      'unit',
      'redteam',
      'e2e',
      'sensory',
      'HTML',
      'not the source of truth'
    ], relative);
    assert.doesNotMatch(text, /\bnpx\b|system browser|global Playwright cache/i);
  }
});

test('rerun skill uses only Verification 2.0 artifact paths', () => {
  const skill = read(
    'plugins/specnav-verification/skills/specnav-verify-rerun/SKILL.md'
  );
  requireTokens(skill, [
    'verify/v2/case-snapshot.json',
    'verify/v2/case-approval.json',
    'verify/v2/requirements-source.json',
    'verify/v2/acceptance-source.json',
    'verify/v2/freshness.json'
  ], 'specnav-verify-rerun');
  assert.doesNotMatch(
    skill,
    /verify\/(?:case-snapshot|case-approval|current-requirements|current-acceptance|case-freshness)\.json/
  );
});
