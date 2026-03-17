# <Short, action-oriented ExecPlan title>

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

Explain, in a few sentences, what someone gains after this change and how they can observe it working. Start with the user-visible or operator-visible outcome, not the implementation details.

## Progress

- [ ] (YYYY-MM-DD HH:MMZ) Replace this line with the first concrete step.
- [ ] Add new entries as work progresses.
- [ ] Split partially complete items into done and remaining work instead of hiding drift.

## Surprises & Discoveries

- Observation: <Record unexpected behavior, constraints, bugs, or evidence that changed the plan.>
  Evidence: <Short test output, log line, or code reference.>

## Decision Log

- Decision: <Record a design or implementation decision.>
  Rationale: <Why this choice is better than the obvious alternatives in this repo.>
  Date/Author: <YYYY-MM-DD / name>

## Outcomes & Retrospective

Summarize what landed, what remains, and what the work taught you. Update this at major milestones and again when the plan is complete.

## Context and Orientation

Describe the current state as if the reader knows nothing about this repository. Name the key files, modules, commands, tests, and boundaries by repository-relative path. Define non-obvious terms immediately. If this plan builds on another checked-in plan, cite it here and restate the context that is still necessary.

## Plan of Work

Describe the implementation story in prose. Name each file or module that must change, what changes there, and why that order of work makes sense. Resolve ambiguity here instead of leaving important choices for the next contributor.

If the work is large, describe it in milestones. Each milestone should be independently verifiable and should leave the system in a working state.

## Concrete Steps

List the exact commands to run and the working directory for each command. Include concise expected outputs whenever the reader needs a comparison point.

Example format:

    Working directory: /path/to/repo
    Command: pnpm exec vitest run tests/example.test.ts
    Expected: 3 tests passed, including the new scenario for <feature>

## Validation and Acceptance

Explain how to prove the change works. Prefer observable behavior over internal claims. Include the exact tests, builds, manual flows, or CLI scenarios that demonstrate success. If a new behavior fails before the change and passes after, say so explicitly.

## Idempotence and Recovery

State how to retry the steps safely, how to resume after a partial failure, and how to recover if a risky step goes wrong. Prefer additive, testable work that can be repeated without damaging the tree.

## Artifacts and Notes

Include the most useful short transcripts, diffs, log excerpts, or snippets that prove the work is real. Keep them brief and focused.

## Interfaces and Dependencies

Name the concrete interfaces, modules, libraries, or services that must exist or be used at the end of the work. Be prescriptive about stable names, file paths, and boundaries. If a new abstraction is required, spell out its purpose in plain language.

## Revision Notes

- <YYYY-MM-DD> - <what changed in this plan and why>
