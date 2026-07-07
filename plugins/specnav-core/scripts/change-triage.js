#!/usr/bin/env node
'use strict';

const path = require('path');
const { classify: classifyPaths } = require('./risk-tier');

const LIGHT_INTENT_PATTERNS = [
  /\b(?:typo|copy|wording|readme|docs?|comment|label|placeholder|style|css|rename|title)\b/i,
  /(?:文案|错别字|拼写|注释|说明|安装命令|颜色|样式微调|改名|标题)/
];

const STANDARD_INTENT_PATTERNS = [
  /\b(?:add|create|support|generate|report|workflow|feature|module|page|component|refactor|i18n|locale|dark mode|theme)\b/i,
  /(?:新增|新建|支持|生成|统计|报表|审批|流程|模块|页面|组件|抽离|重构|国际化|主题|字段|前后端|端到端|集成)/
];

const HIGH_RISK_INTENT_PATTERNS = [
  /\b(?:auth|permission|rbac|role|tenant|login|token|secret|billing|payment|security|database|schema|migration|deploy|api|endpoint|route|controller)\b/i,
  /(?:鉴权|权限|角色|租户|登录|令牌|密钥|支付|账单|安全|数据库|数据表|迁移|部署|接口|路由|控制器)/
];

const PATH_PATTERN = /(?:^|[\s`'"])([./\w@-]+\/[./\w@-]+\.(?:md|mdx|txt|json|ya?ml|toml|css|scss|html|tsx?|jsx?|vue|svelte|py|go|rs|java|kt|swift|sql))(?:$|[\s`'",:;)\]])/gi;
const LANE_REQUIRED_ARTIFACTS = {
  light: [
    'openspec/changes/<change>/risk-tier.json',
    'openspec/changes/<change>/requirements.md',
    'openspec/changes/<change>/acceptance.md',
    'openspec/changes/<change>/acceptance.json',
    'openspec/changes/<change>/spec-map.json',
    'openspec/changes/<change>/component-impact-map.json',
    'openspec/changes/<change>/prototype/decision.json',
    'openspec/changes/<change>/scope.json',
    'openspec/changes/<change>/tasks.md'
  ],
  standard: ['standard lifecycle artifacts'],
  full: ['full lifecycle artifacts with high-risk signoff']
};

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function splitPaths(value) {
  if (Array.isArray(value)) return unique(value.flatMap((item) => splitPaths(item)));
  if (!isNonEmpty(value)) return [];
  return unique(String(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean));
}

function extractPathsFromIntent(intent) {
  const paths = [];
  const text = String(intent || '');
  for (const match of text.matchAll(PATH_PATTERN)) {
    paths.push(match[1].replace(/^.\//, './'));
  }
  return unique(paths);
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function laneFromTier(tier) {
  if (tier === 'high-risk') return 'full';
  if (tier === 'lite') return 'light';
  return 'standard';
}

function tierFromLane(lane) {
  if (lane === 'full') return 'high-risk';
  if (lane === 'light') return 'lite';
  return 'standard';
}

function classifyIntentOnly(intent) {
  const text = String(intent || '');
  if (matchesAny(text, HIGH_RISK_INTENT_PATTERNS)) {
    return {
      lane: 'full',
      confidence: 'high',
      reason: 'intent mentions high-risk architecture, security, API, database, or deployment work'
    };
  }
  if (matchesAny(text, STANDARD_INTENT_PATTERNS)) {
    return {
      lane: 'standard',
      confidence: 'high',
      reason: 'intent describes feature, workflow, architecture, or UI behavior work'
    };
  }
  if (matchesAny(text, LIGHT_INTENT_PATTERNS)) {
    return {
      lane: 'light',
      confidence: 'medium',
      reason: 'intent describes docs, copy, label, comment, or low-risk styling work'
    };
  }
  return {
    lane: 'standard',
    confidence: 'low',
    reason: 'intent is ambiguous; use the standard lifecycle unless paths prove the change is light'
  };
}

function artifactsForLane(lane) {
  return LANE_REQUIRED_ARTIFACTS[lane] || LANE_REQUIRED_ARTIFACTS.standard;
}

function skippedGatesForLane(lane) {
  if (lane !== 'light') return [];
  return [
    'foundation-specs-required-before-conversation',
    'runnable-prototype',
    'prototype-approval-binding',
    'six-domain-verification-expanded-suite',
    'per-slice-spec-and-quality-review-packets'
  ];
}

function verificationDomainsForLane(lane) {
  return lane === 'light' ? ['static', 'unit'] : ['facticity', 'static', 'unit', 'redteam', 'e2e', 'sensory'];
}

function escalationTriggersForLane(lane) {
  if (lane !== 'light') return [];
  return [
    'touches auth, permissions, billing, security, database, API routes, deployment, package manifests, or SpecNav internals',
    'adds a new user-facing workflow, page, module, data flow, or cross-component behavior',
    'touches more than three intended paths or more than ten production files after edits',
    'requires product decisions that are not already expressible in one acceptance assertion'
  ];
}

function triageChange(input = {}) {
  const intent = String(input.intent || '').trim();
  const touchedPaths = unique([
    ...splitPaths(input.paths || []),
    ...extractPathsFromIntent(intent)
  ]).map((item) => item.split(path.sep).join('/'));

  const pathRisk = classifyPaths(touchedPaths);
  const intentRisk = classifyIntentOnly(intent);
  let lane = intentRisk.lane;
  let reason = intentRisk.reason;
  let confidence = intentRisk.confidence;
  const pathLane = laneFromTier(pathRisk.tier);

  if (pathLane === 'full' || intentRisk.lane === 'full') {
    lane = 'full';
    confidence = 'high';
    reason = pathLane === 'full' ? pathRisk.reason : intentRisk.reason;
  } else if (touchedPaths.length > 3) {
    lane = 'standard';
    confidence = 'high';
    reason = `more than three intended paths (${touchedPaths.length}) requires the standard lifecycle`;
  } else if (intentRisk.lane === 'standard') {
    lane = 'standard';
    confidence = intentRisk.confidence;
    reason = intentRisk.reason;
  } else if (pathLane === 'light' && intentRisk.lane === 'light') {
    lane = 'light';
    confidence = 'high';
    reason = 'intent and paths both match the light lane';
  } else if (pathLane === 'light' && intentRisk.confidence === 'low' && touchedPaths.length > 0) {
    lane = 'light';
    confidence = 'medium';
    reason = pathRisk.reason;
  } else if (intentRisk.lane === 'light' && touchedPaths.length === 0) {
    lane = 'light';
    confidence = 'medium';
    reason = intentRisk.reason;
  } else {
    lane = 'standard';
    confidence = confidence === 'low' ? 'low' : 'medium';
    reason = intentRisk.reason;
  }

  const questionRequired = lane === 'standard' && confidence === 'low' && touchedPaths.length === 0;
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    intent,
    touched_paths: touchedPaths,
    lane,
    tier: tierFromLane(lane),
    confidence,
    reason,
    path_risk: {
      tier: pathRisk.tier,
      lane: pathRisk.lane,
      source: pathRisk.source,
      triggers: pathRisk.triggers || [],
      reason: pathRisk.reason
    },
    required_artifacts: artifactsForLane(lane),
    skipped_gates: skippedGatesForLane(lane),
    verification_domains: verificationDomainsForLane(lane),
    escalation_triggers: escalationTriggersForLane(lane),
    question_required: questionRequired,
    recommended_question: questionRequired
      ? '请确认这是否只是文案/文档/样式微调，并提供预计会修改的文件路径。'
      : null,
    blockers: []
  };
}

function parseArgs(args) {
  const parsed = { intent: '', paths: [], json: false, blockers: [] };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--intent' || arg === '--paths') {
      const value = args[index + 1];
      if (!isNonEmpty(value) || value.startsWith('--')) {
        parsed.blockers.push(`missing-argument:${arg}`);
        continue;
      }
      if (arg === '--intent') parsed.intent = value;
      else parsed.paths.push(...splitPaths(value));
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      parsed.blockers.push(`unknown-argument:${arg}`);
      if (isNonEmpty(args[index + 1]) && !args[index + 1].startsWith('--')) index += 1;
      continue;
    }
    positional.push(arg);
  }
  if (!parsed.intent && positional.length) parsed.intent = positional.join(' ');
  parsed.blockers = unique(parsed.blockers);
  return parsed;
}

function markdown(result) {
  return [
    '# SpecNav Change Triage',
    '',
    `- lane: \`${result.lane}\``,
    `- tier: \`${result.tier}\``,
    `- confidence: \`${result.confidence}\``,
    `- reason: ${result.reason}`,
    `- touched paths: \`${result.touched_paths.join(', ') || 'none'}\``,
    `- verification domains: \`${result.verification_domains.join(', ')}\``,
    `- skipped gates: \`${result.skipped_gates.join(', ') || 'none'}\``
  ].join('\n') + '\n';
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const result = triageChange(cli);
  result.blockers = unique([...(result.blockers || []), ...cli.blockers]);
  process.stdout.write(cli.json ? `${JSON.stringify(result, null, 2)}\n` : markdown(result));
  process.exit(result.blockers.length === 0 ? 0 : 2);
}

if (require.main === module) main();

module.exports = {
  classifyIntentOnly,
  extractPathsFromIntent,
  splitPaths,
  triageChange
};
