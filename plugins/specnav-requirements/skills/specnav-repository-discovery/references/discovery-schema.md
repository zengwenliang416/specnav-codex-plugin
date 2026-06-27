# Discovery Schema

Schema ID: `specnav.repositoryDiscovery.v1`

## Top-Level Fields

- `schema`: must be `specnav.repositoryDiscovery.v1`.
- `project_root`: absolute project root used during discovery.
- `generated_at`: ISO timestamp.
- `discovery_path`: expected write target.
- `ignored_dirs`: directories skipped during recursive samples.
- `evidence`: repository evidence records.
- `findings`: evidence-backed spec discovery findings.
- `conflicts`: contradictory or ambiguous evidence that needs negotiation.
- `open_items`: questions suggested by evidence.

## Evidence

Each evidence item requires:

- `id`: stable evidence reference.
- `path`: clean relative path under `project_root`.
- `kind`: evidence category.
- `summary`: concise description.

## Findings

Each finding requires:

- `id`
- `type`
- `summary`
- `foundation_target.spec`
- `evidence_refs`
- `confidence`

`confidence` must be a number from `0` to `1`. `evidence_refs` must point to
existing evidence IDs.

## Conflicts

Conflict objects follow the finding rules and must also include `question` or
`open_item`.
