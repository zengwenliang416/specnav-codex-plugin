# Requirements Interview Philosophy

Read this before asking product questions.

SpecNav requirements are not a brainstorming chat. The purpose is to convert user
intent into verifiable OpenSpec artifacts while respecting existing project
truth.

## Order of Thought

1. Read the four foundation specs.
2. Read current OpenSpec change artifacts and relevant code evidence.
3. Identify what is already answered.
4. Identify the smallest missing decision that blocks artifact completion.
5. Ask one focused question.
6. Include a recommended answer and tradeoff.
7. Record the answer before asking the next question.

## Question Style

Use one question at a time. A good question names:

- the blocked artifact;
- the concrete decision;
- the recommended default;
- the tradeoff of accepting that default;
- the files or specs that will be updated.

Do not ask broad questions such as "What should this feature do?" when the specs
already imply most of the answer. Ask for the missing boundary instead.

## Decision Discipline

- Do not infer product policy from UI preference.
- Do not infer database schema from frontend copy.
- Do not invent API routes, roles, or side effects.
- Do not treat a prototype as approval for production behavior unless the
  prototype handoff says so.
- Write unknowns as `unresolved_gaps`.

## Completion Rule

Requirements are complete only when:

- `requirements.md` names the user-visible behavior and non-goals;
- `acceptance.md` names verifiable acceptance criteria;
- `spec-map.json` maps the change to foundation specs;
- `component-impact-map.json` maps component extraction and coupling effects;
- all `unresolved_gaps` arrays are empty because decisions were made.
