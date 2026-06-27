# Operations Readiness

Read this before writing readiness artifacts.

Readiness aggregates verification, release target, git state, documentation,
installation, deployment, rollback, monitoring, and writeback evidence.

`ready: true` is allowed only when the operation gate can prove:

- verification is green;
- receipt has no uncovered scope;
- git and untracked files are reviewed;
- release docs are present;
- required target-specific operations artifacts exist;
- unresolved learning is written back or explicitly signed off.
