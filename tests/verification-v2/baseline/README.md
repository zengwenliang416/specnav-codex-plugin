# Verification 2.0 Fake-Green Baseline

This fixture corpus freezes V1 states that currently aggregate to green but
must be blocked by Verification Contract V2. It also freezes V1 red and
blocked-domain HTML rendering so the V2 three-page report center can preserve
all verdict states.

The cases intentionally do not change production behavior. They prove the gap
that later contract, evidence, runtime, freshness, and reporting tasks must
close.

Run:

```bash
bash tests/run-verification-v2-baseline.sh
```

Every negative case copies one complete clean control and injects exactly one
defect. The control includes acceptance, approved cases, readings, real files,
runtime artifacts, hashes, sizes, producers, run/case/attempt/step bindings,
and the current Git SHA.

Each fake-green case has:

- an observed V1 verdict of `green`;
- an expected V2 verdict of `blocked`;
- the exact blocker family that later tasks must implement.

The two report-state cases prove that V1 can render red and blocked-domain
states, and explicitly assert that V1 still omits the required overview,
catalog, and immutable results pages.

When V2 replaces the V1 gate, these fixtures must be migrated from
"reproduces fake green" assertions to direct blocker assertions. They must not
be deleted or weakened.
