# ReviewFlux Execution Plans

This file defines how ReviewFlux uses plan documents for multi-step work. A plan in this repo is a living implementation guide that should be detailed enough for someone new to the codebase to continue the work without hidden context.

## When To Write A Plan

Write a plan when the task is large enough that design, implementation, and verification will span multiple files, multiple decisions, or multiple work sessions. Small edits do not need a plan. Anything that changes behavior across command flow, review runtime, queue processing, context loading, or operator-facing output usually does.

## What A Good Plan Must Do

A good plan is self-contained, outcome-focused, and observable. It explains why the work matters, what behavior should exist at the end, which files and modules are involved, what commands to run, and how a human can tell whether the change worked. It should not depend on the author remembering unstated context later.

Treat each plan as a living document. If the design changes, if a discovery invalidates an earlier assumption, or if part of the work is completed, update the plan itself instead of relying on chat history or commit archaeology.

## Non-Negotiable Requirements

- Keep the document self-contained. Define repository-specific terms and repeat assumptions the plan depends on.
- Describe behavior, not just edits. The reader should know what becomes possible after the change and how to verify it.
- Name files, modules, commands, and verification steps precisely.
- Keep a current progress record so the next contributor can restart from the plan alone.
- Record design decisions and surprises as they happen, not after the fact.
- Include validation. A plan that does not say how to prove success is incomplete.

## Recommended Plan Structure

Use prose first. Lists are useful for progress tracking, but the main body should read like an implementation guide rather than a checklist dump.

Most long-running plans should cover the same ground even if the headings vary. In practice, the important pieces are: why the work matters, what files and boundaries are involved, the sequence of work, live progress, explicit decisions, concrete validation, and enough recovery context that someone else can resume without guesswork.

Do not cargo-cult a giant template into every plan. If a section adds no clarity for the task at hand, keep the document lighter. What matters is that the plan stays self-contained, updated, and verifiable.

## Where Plans Live

- `docs/exec-plans/active/` - plans for work that is still in flight.
- `docs/exec-plans/completed/` - completed or historical plans worth keeping as context.
- `docs/exec-plans/tech-debt-tracker.md` - follow-up work, cleanup, and known gaps that do not yet deserve a full plan.

Move a plan from `active/` to `completed/` when the work is no longer being executed as an active track. If the implementation is done but follow-up gaps remain, summarize those gaps in the plan and, if needed, add an entry to the tech-debt tracker. Keep the detailed indexing in the `active/` and `completed/` index files rather than turning this page into a second plan catalog.

## Local Writing Guidance

Plans in this repo should stay grounded in the actual code layout. Use repository-relative file paths. Name the owning domain explicitly when touching review runtime, queue processing, auth/config setup, logging, or prompt/context loading. When work crosses boundaries, explain how those areas fit together before describing the edits.

Keep validation concrete. Prefer commands such as `pnpm build`, `pnpm check`, and targeted `vitest` runs, plus a short behavioral scenario that proves the change is real.

If you need a starting point, copy `docs/exec-plans/TEMPLATE.md` into `docs/exec-plans/active/` and fill it in as a living document.

## Indexes

- `docs/exec-plans/active/index.md`
- `docs/exec-plans/completed/index.md`
- `docs/exec-plans/tech-debt-tracker.md`
- `docs/exec-plans/TEMPLATE.md`
