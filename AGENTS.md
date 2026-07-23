# Shared Agent Instructions

This repository uses a shared, model-neutral memory system for GPT, Claude, and
other coding agents.

## Required reading

Before planning or changing the project, read these files in order:

1. `memory/index.json`
2. `memory/project.json`
3. `memory/research.json`
4. `memory/decisions.json`
5. `memory/progress.json`
6. `memory/backlog.json`

`memory/index.json` defines the purpose and update rules for each file.

## Source of truth

Use this precedence order:

1. The user's latest explicit instruction
2. `AGENTS.md`
3. Accepted entries in `memory/decisions.json`
4. Verified entries in `memory/research.json`
5. Proposed architecture and backlog items

Do not convert proposals or assumptions into accepted decisions without user
confirmation or implementation evidence.

## Memory update protocol

- Update `memory/progress.json` after a meaningful milestone, implementation,
  validation run, or blocker discovery.
- Append to `memory/decisions.json` when a durable product or architecture
  choice is made. Preserve superseded decisions and link them by ID.
- Add research findings only when they include a source URL, verification date,
  confidence level, and project implication.
- Keep `memory/backlog.json` synchronized with completed and newly discovered
  work.
- Use ISO 8601 timestamps with a timezone.
- Keep every JSON file valid and formatted with two-space indentation.
- Never store secrets, credentials, private tenant data, or personal data in
  project memory.

## Project direction

The project is an agent-assisted migration system that preserves the meaning,
structure, and relationships of complex Notion workspaces while moving them
into Microsoft Loop and suitable Microsoft 365 services.

Prefer deterministic parsing, mapping, execution, and validation. Use an LLM
only for ambiguous transformations that cannot be handled safely by rules.

## Code architecture

Use feature-first Domain-Driven Design. Organize code by business capability,
then place DDD layers inside each feature:

```text
src/
  features/
    <feature>/
      domain/
      application/
      infrastructure/
      presentation/
  shared/
```

- `domain` contains entities, value objects, aggregates, domain services,
  repository interfaces, and domain events. It must not depend on other layers.
- `application` contains use cases, commands, queries, ports, and orchestration.
- `infrastructure` contains API clients, persistence, file parsing, adapters,
  and implementations of domain or application ports.
- `presentation` contains CLI, HTTP, UI, or agent-facing entry points.
- Put code in `shared` only when it is genuinely cross-feature and has no
  feature ownership.
- Do not create repository-wide horizontal folders such as one global
  `domain/`, `services/`, or `infrastructure/` for feature-owned code.
- Dependencies must point inward toward `domain` and `application`.
