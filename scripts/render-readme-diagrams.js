#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'assets', 'readme');
const SOURCE = path.join(OUT, 'source');
const WIDTH = 2560;
const HEIGHT = 1440;

const LANGS = ['en', 'zh-CN'];

const DIAGRAMS = [
  {
    id: 'specnav-overview-bd-2k',
    kind: 'overview',
    text: {
      en: {
        title: 'SpecNav Lifecycle',
        subtitle: 'From specification to delivery, controlled by evidence',
        topSign: 'Agent execution and editing',
        foundationRail: 'Foundation rail',
        footer: ['Clear specs', 'Strict gates', 'Traceable evidence', 'Reliable delivery', 'Continuous improvement'],
        stages: ['Bootstrap', 'Discovery', 'Requirements', 'Prototype', 'Development', 'Verification', 'Operations'],
        lower: ['OpenSpec state', 'Foundation specs', 'User approval', 'Scope lock', 'Evidence report', 'Release gate', 'Archive receipt'],
        support: ['OpenSpec files', 'SpecNav hooks', 'Deterministic scripts', 'State and artifacts', 'Audit log and events', 'Security policy', 'Metrics and insight']
      },
      'zh-CN': {
        title: 'SpecNav 运行流程',
        subtitle: '从规范到交付，稳定可控，证据驱动',
        topSign: '智能体执行与编辑',
        foundationRail: '基础设施轨道',
        footer: ['清晰的规范', '严格的检验', '可追溯的证据', '可靠的交付', '持续的改进'],
        stages: ['初始化', '规范发现', '需求问需', '原型验证', '垂直开发', '六域测试', '运维归档'],
        lower: ['OpenSpec 状态', 'Foundation Specs', '用户批准', 'Scope Lock', '证据报告', 'Release Gate', '归档回执'],
        support: ['OpenSpec 文件', 'SpecNav Hooks', '确定性脚本', '状态与制品', '审计日志与事件流', '安全与合规策略', '度量与洞察']
      }
    }
  },
  {
    id: 'stage-1-bootstrap-bd-2k',
    kind: 'stage',
    stage: 1,
    text: {
      en: {
        title: 'Bootstrap Stage',
        subtitle: 'Find project state and create the SpecNav path',
        sign: 'Stage 1 / SpecNav',
        gates: 'Front gates',
        steps: [
          ['Doctor check', 'Validate plugin roots and tools'],
          ['Gap diagnosis', 'Find missing OpenSpec state'],
          ['Run bootstrap', 'Create controlled lifecycle files'],
          ['Write OpenSpec state', 'Record workflow and project status'],
          ['Next actions', 'Surface legal next steps']
        ],
        bottom: ['OpenSpec exists', 'Hooks enabled', 'Next action ready']
      },
      'zh-CN': {
        title: '初始化阶段',
        subtitle: '从项目缺失到状态就绪，开启 SpecNav 之路',
        sign: '阶段 1 / SpecNav',
        gates: '前置门禁',
        steps: [
          ['Doctor 检查', '验证插件根、依赖、权限'],
          ['缺失判断', '识别 OpenSpec 与状态缺口'],
          ['执行 Bootstrap', '创建受控生命周期文件'],
          ['写入 OpenSpec 状态', '记录 workflow 与项目状态'],
          ['输出 Next Actions', '呈现合法的下一步入口']
        ],
        bottom: ['OpenSpec 存在', 'Hooks 已启用', '下一步就绪']
      }
    }
  },
  {
    id: 'stage-2-discovery-bd-2k',
    kind: 'stage',
    stage: 2,
    text: {
      en: {
        title: 'Discovery Stage',
        subtitle: 'Read evidence first and prepare foundation spec negotiation',
        sign: 'Discovery + Foundation Gate',
        gates: 'Foundation gate',
        steps: [
          ['Read-only scan', 'Inspect files without changing code'],
          ['Evidence archive', 'Write repository-discovery.json'],
          ['Detect gaps', 'Find missing specs and conflicts'],
          ['Build spec map', 'Connect findings to foundation specs'],
          ['Contract check', 'Block until gaps are resolved']
        ],
        bottom: ['evidence.json ok', 'all specs exist', 'validator ok']
      },
      'zh-CN': {
        title: '规范发现阶段',
        subtitle: '从规范出发，发现项目证据与缺失领域',
        sign: 'Discovery + Foundation Gate',
        gates: 'Foundation Gate',
        steps: [
          ['只读扫描', '扫描仓库与文档，不改代码'],
          ['证据归档', '生成 repository-discovery.json'],
          ['识别缺口', '发现缺失规范与冲突'],
          ['创建四类 Foundation Specs', '映射 UI、架构、数据流、组件'],
          ['合同校验', '缺口未解决则阻塞']
        ],
        bottom: ['evidence.json ok', '四个 Specs 存在', 'validator ok']
      }
    }
  },
  {
    id: 'stage-3-requirements-bd-2k',
    kind: 'stage',
    stage: 3,
    text: {
      en: {
        title: 'Requirements Negotiation',
        subtitle: 'Ask one decision at a time, then write durable contracts',
        sign: 'Question rail',
        gates: 'Gates',
        steps: [
          ['Read specs', 'Start from current facts'],
          ['Load context', 'Read affected docs and flows'],
          ['Ask once', 'One focused decision with tradeoff'],
          ['Write artifacts', 'Update requirements and maps'],
          ['Contract green', 'No unresolved gaps remain']
        ],
        bottom: ['foundation ok', 'unresolved gaps none', 'active change clear']
      },
      'zh-CN': {
        title: '需求问需阶段',
        subtitle: '澄清需求，一次一问，验收对齐',
        sign: '提问轨道',
        gates: '阶段门禁',
        steps: [
          ['前置校验', '先读 Foundation 事实'],
          ['读取上下文', '读取文档、链路与边界'],
          ['一次一问', '带推荐答案与取舍说明'],
          ['写入产物', '更新 requirements 与映射'],
          ['合同收敛', '所有缺口清零']
        ],
        bottom: ['foundation ok', '无 unresolved gaps', 'active change 清晰']
      }
    }
  },
  {
    id: 'stage-4-prototype-bd-2k',
    kind: 'stage',
    stage: 4,
    text: {
      en: {
        title: 'Prototype Workshop',
        subtitle: 'Make decisions visible before production code',
        sign: 'Prototype decision workshop',
        gates: 'Review gates',
        steps: [
          ['Contract entry', 'Requirements are valid'],
          ['Question class', 'Choose UI, logic, API, flow, or seam'],
          ['Runnable prototype', 'Generate reviewable code'],
          ['Verifier report', 'Record runtime and inspection evidence'],
          ['Approved handoff', 'Freeze chosen branch and variant']
        ],
        bottom: ['requirements ok', 'runtime evidence', 'user approved']
      },
      'zh-CN': {
        title: '原型验证阶段',
        subtitle: '用可运行原型把决策变得直观',
        sign: 'Prototype Decision Workshop',
        gates: '审阅门禁',
        steps: [
          ['合同预检', '需求产物全部有效'],
          ['问题分类', '选择 UI、逻辑、API、流或 seam'],
          ['可运行原型', '生成可审阅的代码'],
          ['验证报告', '记录运行与检查证据'],
          ['批准交接', '冻结分支与变体']
        ],
        bottom: ['requirements ok', 'runtime evidence', 'user approved']
      }
    }
  },
  {
    id: 'stage-5-development-bd-2k',
    kind: 'stage',
    stage: 5,
    text: {
      en: {
        title: 'Vertical Development',
        subtitle: 'High cohesion, low coupling, evidence after every slice',
        sign: 'Scoped vertical slices factory',
        gates: 'Factory rules',
        steps: [
          ['Dev entry', 'Read approved prototype and basis'],
          ['Scope lock', 'Limit files and operations'],
          ['Task slicing', 'Create checkbox tasks'],
          ['Implement slice', 'Code one user-visible path'],
          ['Review handoff', 'Run tests and quality review']
        ],
        bottom: ['entry ok', 'scope ok', 'tasks all checked', 'review passed']
      },
      'zh-CN': {
        title: '垂直开发阶段',
        subtitle: '高内聚低耦合，以切片驱动，快速交付可验证价值',
        sign: 'Scoped Vertical Slices Factory',
        gates: '工厂规则',
        steps: [
          ['开发入口', '读取批准原型和依据'],
          ['Scope Lock', '限制文件与操作范围'],
          ['任务切片', '创建 checkbox tasks'],
          ['垂直实现', '完成一条用户可见路径'],
          ['交接验证', '测试与质量审查']
        ],
        bottom: ['entry ok', 'scope ok', 'tasks 全部 - [x]', 'review passed']
      }
    }
  },
  {
    id: 'stage-6-verification-bd-2k',
    kind: 'stage',
    stage: 6,
    text: {
      en: {
        title: 'Six-Domain Verification',
        subtitle: 'Facticity, static, unit, red team, E2E, and sensory review',
        sign: 'Verification fortress',
        gates: 'Release gate',
        steps: [
          ['Plan', 'Trace requirements to evidence'],
          ['Run six domains', 'Execute each verification lane'],
          ['Evidence receipt', 'Collect logs and artifacts'],
          ['HTML report', 'Create stakeholder review page'],
          ['Fresh rerun', 'Repair stale or failed checks']
        ],
        bottom: ['handoff ok', 'six domains green', 'green and fresh']
      },
      'zh-CN': {
        title: '六域测试阶段',
        subtitle: '真实性、静态、单元、红队、E2E、体感全部验证',
        sign: 'Six-Domain Verification Fortress',
        gates: '发布门禁',
        steps: [
          ['验证计划', '需求到证据的追踪'],
          ['六域执行', '逐项运行验证通道'],
          ['证据报告', '收集日志与产物'],
          ['HTML 报告', '生成可审阅页面'],
          ['修复重跑', '处理失败与过期证据']
        ],
        bottom: ['handoff ok', '六域齐全', 'green & fresh']
      }
    }
  },
  {
    id: 'stage-7-operations-bd-2k',
    kind: 'stage',
    stage: 7,
    text: {
      en: {
        title: 'Operations Archive',
        subtitle: 'Release safely, preserve evidence, keep the next change clear',
        sign: 'Operations harbor',
        gates: 'Gates and receipts',
        steps: [
          ['Release target', 'Choose local, package, or production'],
          ['Release plan', 'Name checks and rollback'],
          ['Readiness', 'Verify install and update policy'],
          ['Monitor rollback', 'Record deploy and recovery path'],
          ['Archive receipt', 'Move finished change with proof']
        ],
        bottom: ['verify green', 'release target set', 'tasks complete', 'operations gate ok']
      },
      'zh-CN': {
        title: '运维归档阶段',
        subtitle: '稳定发布，持续运营，归档证据',
        sign: 'Operations Harbor',
        gates: '门禁与回执',
        steps: [
          ['Release Target', '选择发布目标'],
          ['发布计划', '列出检查与回滚'],
          ['Readiness', '安装与更新策略校验'],
          ['监控回滚', '记录部署和恢复路径'],
          ['Archive Receipt', '带证据归档完成变更']
        ],
        bottom: ['verify green', 'release target 明确', 'tasks 全部完成', 'operations gate ok']
      }
    }
  }
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function cjk(value) {
  return /[\u3400-\u9fff]/.test(value);
}

function wrapText(value, maxChars, maxLines = 3) {
  const text = String(value);
  if (!text) return [];
  if (cjk(text)) {
    const chunks = [];
    let line = '';
    for (const char of [...text]) {
      if (line.length >= maxChars) {
        chunks.push(line);
        line = '';
      }
      line += char;
    }
    if (line) chunks.push(line);
    return chunks.slice(0, maxLines);
  }

  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function textLines(lines, x, y, opts = {}) {
  const size = opts.size || 36;
  const weight = opts.weight || 700;
  const fill = opts.fill || '#12313a';
  const anchor = opts.anchor || 'middle';
  const lineHeight = opts.lineHeight || Math.round(size * 1.25);
  const klass = opts.klass ? ` class="${opts.klass}"` : '';
  return lines.map((line, index) => (
    `<text${klass} x="${x}" y="${y + index * lineHeight}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`
  )).join('\n');
}

function labelBlock(value, x, y, width, opts = {}) {
  return textLines(
    wrapText(value, opts.maxChars || Math.max(8, Math.floor(width / (opts.size || 34) * 1.8)), opts.maxLines || 3),
    x,
    y,
    opts
  );
}

function rect(x, y, w, h, r, fill, stroke = '#1d3842', sw = 6, extra = '') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${extra}/>`;
}

function pathEl(d, attrs) {
  return `<path d="${d}" ${attrs}/>`;
}

function icon(type, cx, cy, scale = 1) {
  const s = scale;
  const stroke = '#163740';
  const teal = '#11817d';
  const cream = '#f8f0de';
  if (type === 'shield') {
    return `<path d="M ${cx} ${cy - 54 * s} L ${cx + 48 * s} ${cy - 34 * s} L ${cx + 40 * s} ${cy + 38 * s} Q ${cx} ${cy + 66 * s} ${cx - 40 * s} ${cy + 38 * s} L ${cx - 48 * s} ${cy - 34 * s} Z" fill="${teal}" stroke="${stroke}" stroke-width="${8 * s}"/><path d="M ${cx - 21 * s} ${cy + 2 * s} L ${cx - 4 * s} ${cy + 22 * s} L ${cx + 28 * s} ${cy - 20 * s}" fill="none" stroke="${cream}" stroke-width="${10 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (type === 'doc') {
    return `<path d="M ${cx - 45 * s} ${cy - 62 * s} H ${cx + 30 * s} L ${cx + 52 * s} ${cy - 38 * s} V ${cy + 62 * s} H ${cx - 45 * s} Z" fill="${cream}" stroke="${stroke}" stroke-width="${7 * s}"/><path d="M ${cx + 30 * s} ${cy - 62 * s} V ${cy - 38 * s} H ${cx + 52 * s}" fill="none" stroke="${stroke}" stroke-width="${6 * s}"/><path d="M ${cx - 24 * s} ${cy - 22 * s} H ${cx + 24 * s} M ${cx - 24 * s} ${cy + 4 * s} H ${cx + 30 * s} M ${cx - 24 * s} ${cy + 30 * s} H ${cx + 16 * s}" stroke="${teal}" stroke-width="${8 * s}" stroke-linecap="round"/>`;
  }
  if (type === 'terminal') {
    return `${rect(cx - 58 * s, cy - 44 * s, 116 * s, 88 * s, 16 * s, '#102e38', stroke, 7 * s)}<path d="M ${cx - 30 * s} ${cy - 15 * s} L ${cx - 8 * s} ${cy} L ${cx - 30 * s} ${cy + 15 * s} M ${cx + 4 * s} ${cy + 20 * s} H ${cx + 34 * s}" stroke="#24d0c6" stroke-width="${8 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (type === 'cube') {
    return `<path d="M ${cx} ${cy - 64 * s} L ${cx + 54 * s} ${cy - 32 * s} V ${cy + 32 * s} L ${cx} ${cy + 64 * s} L ${cx - 54 * s} ${cy + 32 * s} V ${cy - 32 * s} Z" fill="#d8e1d2" stroke="${stroke}" stroke-width="${7 * s}"/><path d="M ${cx} ${cy - 64 * s} V ${cy} M ${cx - 54 * s} ${cy - 32 * s} L ${cx} ${cy} L ${cx + 54 * s} ${cy - 32 * s}" fill="none" stroke="${stroke}" stroke-width="${6 * s}"/><path d="M ${cx - 54 * s} ${cy + 32 * s} L ${cx} ${cy} L ${cx + 54 * s} ${cy + 32 * s}" fill="none" stroke="${teal}" stroke-width="${7 * s}"/>`;
  }
  if (type === 'gear') {
    return `<circle cx="${cx}" cy="${cy}" r="${54 * s}" fill="${teal}" stroke="${stroke}" stroke-width="${7 * s}"/><circle cx="${cx}" cy="${cy}" r="${22 * s}" fill="${cream}" stroke="${stroke}" stroke-width="${6 * s}"/><path d="M ${cx} ${cy - 76 * s} V ${cy - 58 * s} M ${cx} ${cy + 58 * s} V ${cy + 76 * s} M ${cx - 76 * s} ${cy} H ${cx - 58 * s} M ${cx + 58 * s} ${cy} H ${cx + 76 * s}" stroke="${stroke}" stroke-width="${10 * s}" stroke-linecap="round"/>`;
  }
  if (type === 'chart') {
    return `${rect(cx - 58 * s, cy - 46 * s, 116 * s, 92 * s, 14 * s, '#f8f0de', stroke, 7 * s)}<path d="M ${cx - 34 * s} ${cy + 20 * s} L ${cx - 8 * s} ${cy - 4 * s} L ${cx + 10 * s} ${cy + 8 * s} L ${cx + 36 * s} ${cy - 26 * s}" fill="none" stroke="${teal}" stroke-width="${9 * s}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (type === 'lock') {
    return `<rect x="${cx - 52 * s}" y="${cy - 8 * s}" width="${104 * s}" height="${72 * s}" rx="${14 * s}" fill="${teal}" stroke="${stroke}" stroke-width="${7 * s}"/><path d="M ${cx - 32 * s} ${cy - 8 * s} V ${cy - 32 * s} Q ${cx - 32 * s} ${cy - 64 * s} ${cx} ${cy - 64 * s} Q ${cx + 32 * s} ${cy - 64 * s} ${cx + 32 * s} ${cy - 8 * s}" fill="none" stroke="${stroke}" stroke-width="${9 * s}"/><circle cx="${cx}" cy="${cy + 28 * s}" r="${9 * s}" fill="${cream}"/>`;
  }
  return icon('doc', cx, cy, scale);
}

function defs() {
  return `
<defs>
  <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#f6ecd7"/>
    <stop offset="1" stop-color="#e8dfc2"/>
  </linearGradient>
  <linearGradient id="tealSign" x1="0" x2="1" y1="0" y2="1">
    <stop offset="0" stop-color="#08746f"/>
    <stop offset="1" stop-color="#044756"/>
  </linearGradient>
  <linearGradient id="platform" x1="0" x2="0" y1="0" y2="1">
    <stop offset="0" stop-color="#fff7e8"/>
    <stop offset="1" stop-color="#d6d2bd"/>
  </linearGradient>
  <filter id="softShadow" x="-20%" y="-20%" width="140%" height="150%">
    <feDropShadow dx="0" dy="12" stdDeviation="8" flood-color="#18353a" flood-opacity="0.28"/>
  </filter>
  <style>
    text { font-family: "Inter", "Arial", "PingFang SC", "Noto Sans CJK SC", sans-serif; paint-order: stroke; stroke: rgba(248,240,222,0.52); stroke-width: 4px; stroke-linejoin: round; }
    .small { stroke-width: 3px; }
    .signText { stroke: rgba(8,50,56,0.36); stroke-width: 5px; }
  </style>
</defs>`;
}

function mapBackground() {
  const hills = [
    'M-80 360 C220 240 370 420 660 290 S1190 210 1510 315 S2080 240 2670 350',
    'M-80 1140 C300 980 520 1180 820 1040 S1320 990 1640 1080 S2140 980 2670 1110',
    'M120 760 C440 640 620 805 930 690 S1380 640 1640 710 S2080 650 2480 750'
  ].map((d) => pathEl(d, 'fill="none" stroke="#cfc59c" stroke-width="4" opacity="0.38"'));
  const river = pathEl('M 1760 -40 C 1680 130 1900 250 1770 390 C 1610 560 1810 690 1690 850 C 1580 1000 1680 1160 1570 1490', 'fill="none" stroke="#75b8cf" stroke-width="90" opacity="0.70" stroke-linecap="round"');
  const riverEdge = pathEl('M 1760 -40 C 1680 130 1900 250 1770 390 C 1610 560 1810 690 1690 850 C 1580 1000 1680 1160 1570 1490', 'fill="none" stroke="#2e7d95" stroke-width="8" opacity="0.45" stroke-linecap="round" stroke-dasharray="20 28"');
  const trees = [];
  for (let i = 0; i < 86; i += 1) {
    const x = (i * 283) % 2520 + 30;
    const y = (i * 157) % 1300 + 70;
    if (y > 530 && y < 900 && x > 220 && x < 2340) continue;
    const r = 12 + (i % 4) * 4;
    trees.push(`<g opacity="0.58"><circle cx="${x}" cy="${y}" r="${r}" fill="#7f9d6e"/><path d="M ${x} ${y + r} v ${r + 8}" stroke="#6d6041" stroke-width="5" stroke-linecap="round"/></g>`);
  }
  const clouds = [
    '<g opacity="0.7"><circle cx="2220" cy="155" r="45" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="5"/><circle cx="2280" cy="155" r="38" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="5"/><rect x="2185" y="150" width="145" height="48" rx="24" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="5"/></g>',
    '<g opacity="0.52"><circle cx="1860" cy="240" r="34" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="4"/><circle cx="1905" cy="244" r="28" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="4"/><rect x="1830" y="236" width="112" height="36" rx="18" fill="#f8fbf6" stroke="#8fa6a7" stroke-width="4"/></g>'
  ];
  return `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#sky)"/><path d="M0 0H2560V1440H0Z" fill="#f5ecd7" opacity="0.5"/>${river}${riverEdge}${hills.join('\n')}${trees.join('\n')}${clouds.join('\n')}`;
}

function compass(x, y, s = 1) {
  return `<g filter="url(#softShadow)">
    <circle cx="${x}" cy="${y}" r="${88 * s}" fill="#f8f0de" stroke="#18353a" stroke-width="${8 * s}"/>
    <path d="M ${x} ${y - 120 * s} L ${x + 28 * s} ${y - 26 * s} L ${x + 120 * s} ${y} L ${x + 28 * s} ${y + 26 * s} L ${x} ${y + 120 * s} L ${x - 28 * s} ${y + 26 * s} L ${x - 120 * s} ${y} L ${x - 28 * s} ${y - 26 * s} Z" fill="#0e7470" stroke="#18353a" stroke-width="${8 * s}"/>
    <circle cx="${x}" cy="${y}" r="${32 * s}" fill="#f8f0de" stroke="#18353a" stroke-width="${7 * s}"/>
  </g>`;
}

function sign(x, y, w, h) {
  return `${rect(x, y, w, h, 18, 'url(#tealSign)', '#173540', 8, ' filter="url(#softShadow)"')}${rect(x + 18, y + 16, w - 36, h - 32, 12, 'none', '#2bc6bc', 4)}`;
}

function roadPath(d) {
  return `<path d="${d}" fill="none" stroke="#2f4041" stroke-width="118" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#f8f0de" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="42 42"/>`;
}

function rail(x1, y, x2) {
  return `<path d="M ${x1} ${y} H ${x2}" stroke="#253d42" stroke-width="58" stroke-linecap="round"/><path d="M ${x1} ${y} H ${x2}" stroke="#839392" stroke-width="32" stroke-linecap="round"/><path d="M ${x1} ${y} H ${x2}" stroke="#1b3339" stroke-width="8" stroke-dasharray="56 30"/><g>${Array.from({ length: 13 }, (_, i) => {
    const x = x1 + 80 + i * ((x2 - x1 - 160) / 12);
    return `<rect x="${x - 10}" y="${y - 48}" width="20" height="96" rx="7" fill="#263d42" stroke="#122a30" stroke-width="4"/>`;
  }).join('')}</g>`;
}

function platform(x, y, w = 260, h = 300) {
  return `<g filter="url(#softShadow)">
    ${rect(x - w / 2, y - h / 2, w, h, 26, 'url(#platform)', '#243b41', 8)}
    <rect x="${x - w / 2 + 18}" y="${y + h / 2 - 66}" width="${w - 36}" height="42" rx="12" fill="#31464b" opacity="0.72"/>
    <circle cx="${x - w / 2 + 34}" cy="${y + h / 2 - 44}" r="9" fill="#2bc6bc"/>
    <circle cx="${x + w / 2 - 34}" cy="${y + h / 2 - 44}" r="9" fill="#f1b34b"/>
  </g>`;
}

function overviewBase() {
  const road = roadPath('M 90 760 C 420 650 590 820 830 760 S 1240 650 1490 760 S 1900 850 2265 760');
  const topRail = rail(210, 390, 2320);
  const bottomRail = rail(150, 1165, 2360);
  const stations = [310, 620, 930, 1240, 1550, 1860, 2170].map((x, i) => {
    const icons = ['terminal', 'doc', 'gear', 'cube', 'terminal', 'shield', 'lock'];
    return `<g>${platform(x, 720, 250, 310)}<circle cx="${x}" cy="510" r="46" fill="#0e827d" stroke="#163740" stroke-width="8"/><line x1="${x}" y1="436" x2="${x}" y2="594" stroke="#0b6f6b" stroke-width="8" stroke-dasharray="18 18"/><g>${icon(icons[i], x, 690, 1.05)}</g></g>`;
  }).join('\n');
  const support = [400, 705, 1010, 1315, 1620, 1925, 2230].map((x, i) => {
    const icons = ['doc', 'gear', 'terminal', 'cube', 'doc', 'shield', 'chart'];
    return `<g>${platform(x, 1135, 250, 210)}${icon(icons[i], x, 1090, 0.58)}</g>`;
  }).join('\n');
  const arrows = [465, 775, 1085, 1395, 1705, 2015].map((x) => `<path d="M ${x} 702 h82 l-20 -24 m20 24 l-20 24" fill="none" stroke="#0e827d" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  return `${mapBackground()}${compass(155, 175, 0.82)}${topRail}${bottomRail}${road}${stations}${support}${arrows}${sign(970, 282, 610, 118)}<g opacity="0.95">${sign(395, 1285, 1770, 90)}</g>`;
}

function overviewLabels(t) {
  const xs = [310, 620, 930, 1240, 1550, 1860, 2170];
  const footerX = [535, 850, 1185, 1525, 1885];
  return `<g id="labels">
    ${textLines([t.title], 318, 135, { size: 84, weight: 900, anchor: 'start', fill: '#082c39' })}
    ${textLines([t.subtitle], 322, 210, { size: 38, weight: 700, anchor: 'start', fill: '#1c4350' })}
    ${textLines([t.topSign], 1275, 356, { size: 42, weight: 850, fill: '#fff8e6', klass: 'signText' })}
    ${textLines([t.foundationRail], 330, 1338, { size: 31, weight: 850, fill: '#fff8e6', klass: 'signText' })}
    ${t.stages.map((label, i) => `${textLines([String(i + 1)], xs[i], 526, { size: 46, weight: 900, fill: '#fff8e6', klass: 'signText' })}${labelBlock(label, xs[i], 608, 210, { size: 36, weight: 850, fill: '#132d34', maxLines: 2 })}`).join('\n')}
    ${t.lower.map((label, i) => labelBlock(label, xs[i], 905, 210, { size: 25, weight: 800, fill: '#162f35', maxLines: 2 })).join('\n')}
    ${t.support.map((label, i) => labelBlock(label, [400, 705, 1010, 1315, 1620, 1925, 2230][i], 1250, 210, { size: 25, weight: 800, fill: '#162f35', maxLines: 2 })).join('\n')}
    ${t.footer.map((label, i) => textLines([label], footerX[i], 1342, { size: 30, weight: 850, fill: '#fff8e6', klass: 'signText' })).join('\n')}
  </g>`;
}

function stageBase(stageNo) {
  const road = roadPath('M 115 915 C 420 815 595 965 830 900 S 1245 805 1495 900 S 1945 990 2380 880');
  const xs = [335, 780, 1225, 1670, 2115];
  const signs = xs.map((x, i) => `<g>${platform(x, 735, 282, 320)}<circle cx="${x}" cy="505" r="42" fill="#0e827d" stroke="#163740" stroke-width="8"/><line x1="${x}" y1="548" x2="${x}" y2="600" stroke="#0b6f6b" stroke-width="8" stroke-dasharray="14 14"/>${icon(['shield', 'doc', 'gear', 'terminal', 'chart'][i], x, 700, 0.95)}</g>`).join('\n');
  const arrows = [535, 980, 1425, 1870].map((x) => `<path d="M ${x} 705 h96 l-22 -26 m22 26 l-22 26" fill="none" stroke="#0e827d" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const bottomGates = [520, 1040, 1560, 2080].map((x) => `<g><path d="M ${x} 985 v 115" stroke="#0b6f6b" stroke-width="8" stroke-dasharray="16 18"/><path d="M ${x - 52} 1114 v-54 q0-48 52-48 q52 0 52 48 v54" fill="none" stroke="#20373d" stroke-width="12"/><rect x="${x - 120}" y="1112" width="240" height="82" rx="17" fill="#f8f0de" stroke="#20373d" stroke-width="7"/></g>`).join('');
  const stageBadge = `<rect x="56" y="96" width="188" height="62" rx="18" fill="#0c6d69" stroke="#163740" stroke-width="7"/>`;
  return `${mapBackground()}${compass(150, 155, 0.58)}${stageBadge}${sign(1870, 92, 470, 74)}${road}${sign(900, 282, 760, 92)}${signs}${arrows}${bottomGates}`;
}

function stageLabels(diagram, t) {
  const xs = [335, 780, 1225, 1670, 2115];
  const bottomX = [520, 1040, 1560, 2080];
  return `<g id="labels">
    ${textLines([`Stage ${diagram.stage}`], 150, 139, { size: 28, weight: 850, fill: '#fff8e6', klass: 'signText' })}
    ${textLines([t.title], 292, 142, { size: 74, weight: 900, anchor: 'start', fill: '#082c39' })}
    ${textLines([t.subtitle], 296, 210, { size: 31, weight: 700, anchor: 'start', fill: '#1c4350' })}
    ${textLines([t.sign], 2105, 141, { size: 28, weight: 850, fill: '#fff8e6', klass: 'signText' })}
    ${textLines([t.gates], 1280, 342, { size: 34, weight: 850, fill: '#fff8e6', klass: 'signText' })}
    ${t.steps.map((step, i) => `${textLines([String(i + 1)], xs[i], 520, { size: 40, weight: 900, fill: '#fff8e6', klass: 'signText' })}${labelBlock(step[0], xs[i], 598, 220, { size: 31, weight: 850, fill: '#132d34', maxLines: 2 })}${labelBlock(step[1], xs[i], 872, 225, { size: 22, weight: 700, fill: '#243d43', maxLines: 3 })}`).join('\n')}
    ${t.bottom.map((label, i) => labelBlock(label, bottomX[i], 1165, 205, { size: 23, weight: 800, fill: '#172f35', maxLines: 2 })).join('\n')}
  </g>`;
}

function renderDiagram(diagram, lang = null) {
  const base = diagram.kind === 'overview' ? overviewBase() : stageBase(diagram.stage);
  const labels = lang
    ? (diagram.kind === 'overview' ? overviewLabels(diagram.text[lang]) : stageLabels(diagram, diagram.text[lang]))
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">
${defs()}
${base}
${labels}
</svg>
`;
}

function convertSvgToPng(svgPath, pngPath) {
  execFileSync('rsvg-convert', ['-w', String(WIDTH), '-h', String(HEIGHT), svgPath, '-o', pngPath], { stdio: 'inherit' });
}

function renderAll() {
  ensureDir(SOURCE);
  for (const lang of LANGS) ensureDir(path.join(OUT, lang));

  const report = [];
  for (const diagram of DIAGRAMS) {
    const baseSvg = renderDiagram(diagram, null);
    const baseHash = hash(baseSvg);
    const basePath = path.join(SOURCE, `${diagram.id}.base.svg`);
    fs.writeFileSync(basePath, baseSvg);

    for (const lang of LANGS) {
      const svg = renderDiagram(diagram, lang);
      const svgPath = path.join(SOURCE, `${diagram.id}.${lang}.svg`);
      const pngPath = path.join(OUT, lang, `${diagram.id}.png`);
      fs.writeFileSync(svgPath, svg);
      convertSvgToPng(svgPath, pngPath);
      report.push({ id: diagram.id, lang, baseHash, svgHash: hash(svg), png: path.relative(ROOT, pngPath) });
    }

    const defaultPng = path.join(OUT, `${diagram.id}.png`);
    fs.copyFileSync(path.join(OUT, 'zh-CN', `${diagram.id}.png`), defaultPng);
  }

  const grouped = new Map();
  for (const row of report) {
    const rows = grouped.get(row.id) || [];
    rows.push(row);
    grouped.set(row.id, rows);
  }
  for (const [id, rows] of grouped) {
    const hashes = new Set(rows.map((row) => row.baseHash));
    if (hashes.size !== 1 || rows.length !== LANGS.length) {
      throw new Error(`layout hash mismatch: ${id}`);
    }
  }

  fs.writeFileSync(path.join(SOURCE, 'layout-hashes.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`rendered ${DIAGRAMS.length * LANGS.length} localized README diagrams`);
}

renderAll();
