# Quality Review: 005-case-planning-approval

## Verdict

approved

## Separation Of Concerns

- `planner.js` 只编排 case planning 生命周期，source、case semantics、coverage 和 blocker 规则集中在 `case-validation.js`。
- `approval-validator.js` 只编排 approval gate，snapshot identity、source freshness、reviewer principal/time 和 binding 规则集中在 `approval-checks.js`。
- `case-contract.js` 先处理 action 和输入参数，再进入 runtime/schema 准备；CLI usage errors 不会被 runtime readiness 掩盖。
- snapshot hashing、canonical JSON、normalization 和 immutable writing 保持独立模块，没有 host-specific 逻辑回流 kernel。

## Component Cohesion / Coupling

- `planner.js` 71 行，`approval-validator.js` 97 行，核心入口已是短编排函数。
- `case-validation.js` 250 行，但内部按 source、member uniqueness、assertion references、evidence policy、case references 和 coverage 分成单一目的 helper。
- `approval-checks.js` 135 行，按 snapshot、freshness、principal 和 binding 分组；依赖方向清晰，没有循环或不必要的转发层。
- 当前模块粒度符合高内聚、低耦合要求，不需要进一步拆分才能批准。

## Test Quality

- 独立复跑 `node --test tests/verification-v2/cases/*.test.js`：30/30 通过。
- 独立复跑 `bash tests/run-verification-v2-case-approval.sh`：通过。
- focused tests 覆盖 snapshot hash/provenance、source freshness、approval identity/time、六域引用、evidence policy、planner blocker、无 fallback 和 immutable output。
- 上两轮发现的缺口均已锁定：
- `undefined`、`null` snapshot 返回 `verification-cases:snapshot-missing`。
- `false`、`0`、空字符串 snapshot 进入 schema validation 并阻止执行。
- `null`、number、string case records 返回稳定 contract blockers，不再抛内部 TypeError。
- requirements/acceptance 中的 `null` source record 返回稳定 `*-id-invalid` blocker。
- RED 059 与系统收据 063-065 能追溯修复过程；本 verdict 以本轮独立执行结果为准。

## Error Handling

- snapshot 缺失与 malformed snapshot 均 fail-closed，`ok` 和 `execution_allowed` 为 `false`；不存在 approval gate bypass。
- malformed case/source 在 normalization 前或安全排序后进入确定性验证，错误语义稳定，不依赖 JavaScript 异常文本。
- CLI action、缺参、坏 JSON、runtime-not-ready 的优先级明确，并返回结构化 blocker。
- `writeJson()` 使用同目录临时文件、`wx`、hard link 和 finally cleanup，实现不可覆盖的原子发布；测试验证已有文件内容不变且无临时文件残留。

## Reuse / Duplication

- case validation 和 approval checks 复用 canonical hash、normalization、snapshot hash 和 schema registry，没有复制核心算法。
- case-plan 与 case-approval blocker factory 分开保留，符合不同 artifact 语义，不构成需要抽象的重复。
- 未发现死代码、无效 fallback 分支或重复状态机。

## Complexity Delta

- 最大核心模块 `case-validation.js` 为 250 行，低于文件长度风险阈值；其函数职责独立，嵌套深度可控。
- 原先超过 100 行的 planner/approval 主函数已拆为短编排函数，复杂度下降且 tests 与规则分支匹配。
- `case-contract.js` 173 行，CLI dispatch、runtime bootstrap 和 atomic output helper 边界明确。
- 当前复杂度增量可维护，没有阻断性复杂度债务。

## No Fallback

- snapshot 内容、id、hash、creator 和 creation time 均参与当前性判断。
- requirements/acceptance 变化、reviewer identity、approval decision/time 或 snapshot binding 变化都会阻止执行。
- 缺失、null、falsy 或 schema-invalid snapshot 均不能进入 approved state。
- blocked plan 不生成 snapshot，已有 snapshot 不可被覆盖，runtime 不可用时不会切换简化路径。
- 未发现 light lane、legacy promotion、manual green override 或其他隐式 fallback。

## Required Fixes

- No further quality fix is required for Task 005 after the snapshot, approval,
  fail-closed input handling, and atomic publication repairs described above.

## Validation

- `node --test tests/verification-v2/cases/*.test.js` -> pass, 30/30
- `bash tests/run-verification-v2-case-approval.sh` -> pass
- `node --check` for scoped JS files -> pass
- Scoped `git diff --check` -> pass
- Independent snapshot probe: `undefined`, `null`, `false`, `0`, and `""` all blocked
- Independent malformed case/source probe: stable blockers, no exceptions
