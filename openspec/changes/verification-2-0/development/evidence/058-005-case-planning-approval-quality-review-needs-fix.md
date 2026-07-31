# Quality Review: 005-case-planning-approval

## Verdict

needs-fix

## Separation Of Concerns

- 上次指出的 CLI/runtime 耦合已修复。`case-contract.js:84-139` 先完成 action 和文件参数处理，再按 `snapshot` / `check` 分支加载 runtime/schema；unsupported action、缺参、坏 JSON 不再被 runtime blocker 掩盖。
- `planner.js` 现在只编排 plan 生命周期，case/source/coverage 规则下沉到 `case-validation.js`；`approval-validator.js` 只编排 approval gate，hash/freshness/principal/binding 规则下沉到 `approval-checks.js`。组件边界符合一模块一类生命周期责任。

## Component Cohesion / Coupling

- `planner.js` 从 258 行降到 71 行，`approval-validator.js` 从 210 行降到 90 行。主入口函数已不再承担全部规则细节。
- `case-validation.js` 250 行，但内部按 source、member uniqueness、assertion reference、evidence policy、case reference、coverage 分为独立纯函数；`approval-checks.js` 135 行，按 snapshot identity、source freshness、principal、binding 分组。当前拆分具有内聚性，没有为了降行数制造无意义转发层。
- canonical/hash、normalization、snapshot writing 继续复用原有模块，没有出现 host-specific 或 CLI-specific 逻辑回流 kernel。

## Test Quality

- 独立复跑 `node --test tests/verification-v2/cases/*.test.js`：27/27 assertions 通过。
- 独立复跑 `bash tests/run-verification-v2-case-approval.sh`：通过。
- 新增 tests 已覆盖上次指出的 duplicate case/change mismatch、source duplicate/invalid id、snapshot id stale、current source missing、principal missing、unsupported action、缺参、坏 JSON、runtime 优先级和不可覆盖输出。
- 仍缺少两个关键负向场景：
- `tests/verification-v2/cases/approval.test.js` 没有传入缺失或 `null` snapshot。独立 kernel 与 CLI 复现均证明该场景当前返回 `ok: true`、`execution_allowed: true`，CLI 退出码为 `0`。
- `tests/verification-v2/cases/planning.test.js` 没有传入 malformed case record。独立复现 `cases: [null]` 时 planner 抛出 `Cannot read properties of null (reading 'requirement_ids')`，而不是返回稳定 schema/blocker 结果。

## Error Handling

- **High:** `approval-validator.js:12-18` 的 `validatedArtifact()` 对 falsy value 直接返回 `null`，但 `evaluate()` 只为缺失 approval 添加 blocker，没有为缺失 snapshot 添加 blocker。`approval-validator.js:27-69` 因此允许一个 schema-valid approval 在没有任何 snapshot、hash recomputation、source freshness 或 binding 校验的情况下成为 `approved-current`。这是 execution gate bypass，违反“execution reads only the approved snapshot”和无 fallback 约束。
- **Medium:** `case-validation.js:176-210` 在 schema validation 前调用 `normalizeCase(rawCase)`；`normalize.js:18-20` 假设输入可读取 case 字段。`null` case 因而产生内部 TypeError。CLI 最终会失败关闭，但 blocker 依赖 JavaScript 异常文本，不满足任务要求的精确、稳定 blocker 语义。
- CLI action/argument/runtime 错误优先级已按上次要求修正。`writeJson()` 使用同目录临时文件、`wx`、hard link 和 finally cleanup，实现不可覆盖的原子发布；integration test 同时验证 sentinel 未变化且无临时文件残留。

## Reuse / Duplication

- 新增 `case-validation.js` 和 `approval-checks.js` 复用了现有 normalization、canonical hash、snapshot hash 和 schema registry，没有复制算法。
- blocker factory 分别属于 case-plan 和 case-approval 两种 artifact 语义，当前分开保留合理；没有需要阻断的重复实现。

## Complexity Delta

- 复杂度修复有效：两个原先超过 100 行的核心函数已拆为短编排函数，规则 helper 大多保持单一目的，嵌套深度可控。
- 当前最大模块 `case-validation.js` 为 250 行，低于文件长度风险阈值；没有发现超过 800 行文件或新的深层嵌套。
- 本轮 verdict 不是复杂度导致。阻断来自缺失 snapshot 的 approval bypass 和 malformed case 的不稳定错误语义。

## No Fallback

- snapshot hash/provenance、requirements/acceptance freshness、reviewer identity、approval time和六域 case mapping 仍保持 fail-closed。
- snapshot 输出已改为不可覆盖原子创建，不会静默替换已有批准对象。
- 但缺失 snapshot 被视为可批准状态，本质上构成 approval gate fallback；在修复前不能批准 Task 005。

## Required Fixes

- 让 snapshot 成为 `evaluate()` 的强制输入。缺失、`null` 或其他 falsy snapshot 必须产生稳定 blocker，且 `ok` / `execution_allowed` 必须为 `false`。补 kernel test 和 CLI `snapshot.json = null` integration test。
- 在 normalization 前拒绝 malformed case record，或让 `normalizeCase()` 安全处理非对象输入并交给 schema registry。补 `cases: [null]` 和至少一个 primitive case 的 focused tests，断言稳定 blocker 而不是 JavaScript TypeError。

## Validation

- `node --test tests/verification-v2/cases/*.test.js` -> pass, 27/27
- `bash tests/run-verification-v2-case-approval.sh` -> pass
- `node --check` for changed JS files and scoped `git diff --check` -> pass
- Independent bypass probe: `snapshot: null` -> `ok: true`, `execution_allowed: true`, CLI exit `0`
- Independent malformed-input probe: `cases: [null]` -> uncaught `TypeError`
