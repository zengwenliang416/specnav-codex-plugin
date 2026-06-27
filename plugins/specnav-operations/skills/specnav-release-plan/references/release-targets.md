# Release Targets

Read this before choosing a release target.

Pick exactly one primary target:

- `local-only`: no external release; local repo state and docs only.
- `plugin-marketplace`: marketplace package, install verification, update policy,
  compatibility matrix, and README evidence required.
- `package`: package release with package-specific checklist.
- `host-compatibility`: compatibility-focused release across supported hosts.
- `project-deploy`: deployment plan, rollback plan, and monitoring required.

Do not choose target from convenience. Choose from user intent and repository
distribution surface.
