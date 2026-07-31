# Quality Review: 005-case-planning-approval

## Verdict

needs-fix

## Separation Of Concerns

- `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js:67-110` 在分发 `snapshot` / `check` 之前就无条件调用 `readySchemaRegistry()`。这把 CLI 动作分发、runtime doctor、managed Ajv 装载、case contract 规划/校验耦在一起，和组件架构里“runtime installation, execution, evidence capture, evaluation, aggregation, reporting, and gate enforcement remain separate modules”的边界不一致。
- 这个耦合不是纯风格问题。当前实现下，`unsupported-action`、缺少参数、或纯 JSON 输入错误，都可能先被 runtime 未就绪掩盖，拿不到最精确的 CLI blocker。`run()` 里其实已经定义了 `verification-cases:unsupported-action:*` 返回值，但在 runtime 失效时会被提前短路。

## Component Cohesion / Coupling

- `plugins/specnav-verification/kernel/cases/planner.js:146-251` 的 `plan()` 同时负责 source 归一化、schema 校验、graph-style 引用校验、coverage 汇总、blocker 组装和结果冻结；`plugins/specnav-verification/kernel/cases/approval-validator.js:25-189` 的 `evaluate()` 同时负责 snapshot 新鲜度、source freshness、approval principal/time、binding 一致性和最终 gate 输出。
- 这两个函数仍然可读，但已经是本 slice 中最重的两个决策点。按本 reviewer skill 的复杂度标准，单函数超过 50 行已属高复杂度；这里 `plan()` 和 `evaluate()` 都远超这个阈值，后续再加 blocker 家族时，回归面会继续扩大。
- 已做对的部分是提取了 `canonical.js`、`normalize.js`、`snapshot-writer.js`，说明作者知道该往哪拆；但 planner/approval 这两段仍然需要继续下沉成更小的纯 helper。

## Test Quality

- 已覆盖且证据充分的部分：
- `tests/verification-v2/cases/snapshot.test.js` 对 snapshot hash、provenance 变更、无 fallback 都有直接断言。
- `tests/verification-v2/cases/approval.test.js` 覆盖了 source freshness、approval identity/time、snapshot provenance/content 漂移。
- `tests/run-verification-v2-case-approval.sh` 与 `tests/verification-v2/cases/cli-integration.js` 证明了 CLI happy path 和 stale snapshot path。
- 缺口仍然存在：
- `tests/verification-v2/cases/cli-integration.js:22-123` 没有锁定 `unsupported-action`、参数缺失/JSON 解析错误、runtime-not-ready 优先级、以及“失败时不覆盖已有 snapshot 输出”的回归。
- `tests/verification-v2/cases/planning.test.js:38-185` 没有覆盖 `verification-cases:duplicate-case`、`verification-cases:case-change-mismatch`、`verification-cases:requirements-duplicate` / `acceptance-duplicate`、`*-id-invalid` 这些 planner blocker。
- `tests/verification-v2/cases/approval.test.js:67-200` 没有覆盖 `verification-cases:snapshot-id-stale`、`verification-cases:current-source-missing`、`verification-cases:approval-principal-missing`。
- 我额外做了临时目录只读式 CLI 复核：阻塞的 `snapshot` 运行返回 `status=2` 且保持原输出 hash 不变，说明当前 `writeJson()` 行为正确；但仓库内没有自动化测试把这个边界锁住。

## Error Handling

- `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js:47-65` 和 `:67-110` 的错误路径过早绑定 runtime readiness，导致本应属于 CLI 入参/动作层的错误与运行时错误混在一起。
- `writeJson()` 本身实现是对的：`wx` 临时文件加 `renameSync()`，没有成功就不会写目标文件，符合“无 fallback、原子替换”的预期。
- 但这个关键边界只存在于实现，不存在于 repo test。对一个以 immutable snapshot 为中心的 slice，这个缺少回归保护是实质性质量风险。

## Reuse / Duplication

- 正向评价：canonical/hash、normalize、snapshot writer 已经从主流程里抽离，避免了在 planner 和 validator 里复制排序/哈希逻辑。
- 仍有重复趋势：`planner.js` 和 `approval-validator.js` 都各自内联了 blocker 构造、字段绑定、循环式规则校验。现在规模还可控，但继续在这两个文件里追加规则，会把重复推回主流程函数。

## Complexity Delta

- 本次新增/变更的核心文件行数：
- `plugins/specnav-verification/kernel/cases/planner.js` 258 行
- `plugins/specnav-verification/kernel/cases/approval-validator.js` 210 行
- `plugins/specnav-verification/skills/specnav-verify-plan/scripts/case-contract.js` 153 行
- 这不是“文件过长”级别的问题，而是“高复杂度规则集中在少数入口函数里”的问题。结合上面的未覆盖 blocker，当前复杂度增量还没有被 tests 等比例兜住。

## Required Fixes

- 把 `readySchemaRegistry()` 从 `case-contract.js:69` 下沉到 `snapshot` / `check` 分支内部，先做 action dispatch 和参数层错误返回，再做 runtime/schema 准备。随后补 CLI 回归：`unsupported-action`、缺参/坏 JSON、runtime-not-ready 优先级。
- 为原子写入增加自动化回归，至少锁定“已有 snapshot 存在时，阻塞的 `snapshot` 运行不会覆盖或截断目标文件”。
- 继续拆分 `planner.js:146-251` 与 `approval-validator.js:25-189`，把 source 校验、case semantic 校验、coverage 校验、approval freshness/binding 校验拆成独立 helper，并为当前未覆盖的 blocker id 增加 focused tests。
