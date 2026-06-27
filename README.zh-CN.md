# SpecNav Codex 插件套件

SpecNav for Codex 是一个六插件 OpenSpec 生命周期套件。把本仓库添加为
Codex marketplace，安装六个插件，用 `/hooks` 信任 `specnav-core` hooks，
然后在目标项目里从 `$specnav-workflow` 开始。

SpecNav 约束完整工程生命周期：

```text
初始化 -> 规范发现 -> 需求 -> 原型 -> 开发 -> 验证 -> 运维
```

Codex 负责理解、解释、提案和编辑；SpecNav 通过 OpenSpec 文件、确定性脚本、
生命周期 hooks 和无 fallback 的阶段 gate 判断下一步是否合法。

English documentation: [README.md](README.md)

## 本地安装

在仓库根目录执行：

```bash
codex plugin marketplace add "$PWD"
codex plugin add specnav-core@specnav-marketplace
codex plugin add specnav-requirements@specnav-marketplace
codex plugin add specnav-prototype@specnav-marketplace
codex plugin add specnav-development@specnav-marketplace
codex plugin add specnav-verification@specnav-marketplace
codex plugin add specnav-operations@specnav-marketplace
```

安装后信任 hooks：

```text
/hooks
```

安装或更新 plugins、skills、hooks、scripts 后，请启动新的 Codex 会话。

## 第一次使用

安装后要在目标项目里使用 SpecNav，不是在这个插件仓库里继续操作。

```text
1. 运行 $specnav-doctor
   确认六个插件、hooks、skills、OpenSpec CLI 和 installed cache 都可见。

2. 运行 $specnav-workflow
   读取当前 affordance table，报告下一步合法动作。

3. 如果项目没有 OpenSpec 状态，运行 $specnav-bootstrap
   这会创建 openspec/、openspec/.specnav/workflow-state.json、context
   manifests 和项目根目录 .specnav.json 标记。

4. 运行 $specnav-status
   确认 active change、ready actions、blockers、risk tier 和 stale
   verification 状态。

5. 运行 $specnav-requirements
   如果 foundation specs 缺失，SpecNav 会先路由到仓库规范发现和
   foundation spec 修复，然后才能开始功能问需。
```

## 工作流模型

| 阶段 | Skill | 写入 | 常见 blocker | 下一步 |
| --- | --- | --- | --- | --- |
| 初始化 | `$specnav-bootstrap` | `openspec/`、`.specnav/`、`.specnav.json` | `missing-openspec-cli`、初始化失败 | `$specnav-status` |
| 规范发现 | `$specnav-repository-discovery` | `openspec/.specnav/context/repository-discovery.json` | 证据缺失、问题未确认 | `$specnav-foundation-specs` |
| 需求 | `$specnav-requirements` | `requirements.md`、`acceptance.md`、`spec-map.json`、`component-impact-map.json` | foundation specs 缺失或非法 | `$specnav-prototype` |
| 原型 | `$specnav-prototype` | `prototype/` artifacts、verifier report、handoff | 上下文缺失、verifier red、未批准 | `$specnav-development-entry` |
| 开发 | `$specnav-vertical-slices` | `scope.json`、任务 artifacts、生产代码改动 | scope 非法、上游漂移、review 失败 | `$specnav-verify-plan` |
| 验证 | `$specnav-verify-plan` 加六个 domain skills | 六域 `verify/` 证据、aggregate report、HTML 审阅报告 | stale report、domain red、证据缺失 | `$specnav-release-plan` |
| 运维 | `$specnav-ops-readiness` | `operations/` readiness 和 release artifacts | verify not green、target 不明确 | archive/writeback |

## 插件布局

```text
.agents/plugins/marketplace.json          Codex 本地 marketplace
plugins/specnav-core/                     Runtime、router、hooks、status、doctor
plugins/specnav-requirements/             Foundation specs 和需求
plugins/specnav-prototype/                可运行原型和 handoff
plugins/specnav-development/              Scope lock 和垂直切片开发
plugins/specnav-verification/             六域验证
plugins/specnav-operations/               发布、部署、回滚、归档 readiness
```

## 无 fallback

如果 required dependency、plugin、OpenSpec command、artifact、state file、
context manifest 或 verification tool 缺失或失败，SpecNav 必须报告精确
blocker 并阻断依赖动作。

允许的阻塞态动作：

- doctor/status；
- bootstrap；
- OpenSpec artifact 修复；
- read-only discovery；
- 不触碰生产代码的 docs-only edits。

## 常用检查

```bash
bash tests/run-codex-marketplace-fixtures.sh
bash tests/run-codex-plugin-fixtures.sh
bash tests/run-codex-skill-fixtures.sh
bash tests/run-codex-hook-fixtures.sh
bash tests/run-plugin-suite-resolver-fixtures.sh
bash tests/run-smoke.sh
```

完整检查：

```bash
for test_script in tests/run-*.sh; do
  bash "$test_script"
done
```
