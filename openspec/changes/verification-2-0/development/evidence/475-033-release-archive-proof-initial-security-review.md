# Initial Security Review: 033-release-archive-proof

## Verdict

required_fixes

## Reproduced Findings

- A symlinked `operations/` directory can receive
  `verification-v2-proof.json` outside the change directory.
- A symlinked archive candidate can be accepted as a directory, can satisfy
  evidence hashing against external files, and can receive archive receipts
  outside the repository.
- Existing tests do not cover archive candidate symlinks, evidence symlinks,
  receipt destination symlinks, or archive-time directory replacement.

## Required Repairs

- Apply ancestor symlink and realpath containment checks to every proof and
  archive read/write.
- Use no-follow regular-file reads for evidence hashing.
- Add direct adversarial fixtures and preserve the failing evidence.

Reviewer agent: `019fc3ca-3c76-7db3-b9c2-a10c72a89075`

