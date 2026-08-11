# Repair Report: 900-verification-repair-d34004a474ec5d04

## Status

IMPLEMENTATION COMPLETE - AWAITING RETEST

## Classification

- Case: `CASE-08`
- Failure: `failure-b4322b2e245cf639cade71f8395bfef94483dc40314db6305ddfe4a912ec7664`
- Classification: `test_defect`
- Repair link: `repair-820573424a5e984b1a6242778c182b9ae6e0fb3e82ffa6bef2d2e87b9f08b95e`
- Baseline commit: `4a81dce4939702abd3f1723f49b3415aa60a30dc`
- Reviewed commit: `531443681aef6314a3abfaba74019b88725b2fc2`

## Root Cause

The release proof placed 43 synchronous top-level tests in one Node test file.
Node could not distribute that serial critical path across workers, so the
approved 900-second CASE-08 timeout expired after the underlying assertions had
already succeeded.

## Repair

- Split the 43 heavy release tests deterministically across four shards.
- Added dynamic support-test discovery.
- Added one lifecycle owner for Python, Node, support, shard and emitter
  processes.
- Added process-group signal forwarding, bounded TERM-to-KILL escalation and
  registered detached-worker cleanup.
- Made cross-process tests wait for complete lifecycle evidence instead of file
  existence.
- Kept the approved 900-second CASE-08 timeout unchanged.
- Added no fallback, partial-green path, manual green or simplified path.

## Verification

- Focused runner: `23/23` passed.
- Managed TERM stress: `50/50` passed.
- Real process-group stress: `50/50` passed.
- Registry race probes: passed.
- Focused suite repetitions: `3/3` passed.
- Full CASE-08 independent run: support `34/34`, heavy shards
  `10/11/11/11`, heavy total `43/43`.
- Assertions `CASE-08-A01`, `CASE-08-A02` and `CASE-08-A03`: passed.
- Full CASE-08 duration: approximately 212 seconds.

## Review

- Specification review: approved.
- Quality review: approved.
- P0 findings: none.
- P1 findings: none.
- P2 findings: none.
- Source changes remain inside the approved four-file repair scope.

## Frozen Evidence

- `evidence-32bf4c8019c0216283cac494d126ce14951fa7eb3c706ed8815fff38e9348396`
- `evidence-77242f187bc768c936d5e909c4b8a1e3dc6377429d8ab2e6f34ae889e413fec3`
- `evidence-80f3fbc7030bd966e5b5747297737836c482c62c06f080d6bc79e39f0ff01ea5`
- `evidence-d3d2e1ed0ea25483875a567f4d46d81aacec6b9005466e9ec27c7e6e4abb5a4f`
- `evidence-dc27d3a858e3f072eab223efddd126f9af53ca2525f3e2a0a1b31bb6b2c0b32a`
- `evidence-ed47cfd07b8f6368033d93a63b651ec9b582cc822c432f97a69d7dea3aac62ff`
- `evidence-f683f3868f3bcafa44bb65aa5c4365295e54517d053614718165aad99a9a6a95`
