# Align Architecture Framing With Explicit Cross-Cutting Contracts

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Maintain this file in accordance with `docs/PLANS.md`. It must remain self-contained, novice-guiding, and sufficient for someone to resume the work from this file alone.

## Purpose / Big Picture

ReviewFlux already has practical boundaries, but `ARCHITECTURE.md` still explains them as a loose set of areas rather than as a layered domain architecture with explicit cross-cutting boundaries. The repo also has at least one concrete boundary leak: the review comment title (`"🧠 ReviewFlux Review"`) is duplicated across `src/review` and `src/gateway`, which makes ownership unclear.

After this change, a reader should be able to understand ReviewFlux as a layered domain architecture with explicit cross-cutting boundaries, and the codebase should reflect that framing with one concrete contract module shared by review runtime and publishing. The outcome is observable through the updated architecture document, the new explicit contract module, and passing targeted tests for review formatting behavior.

## Progress

- [x] (2026-03-17 23:22Z) Read `docs/PLANS.md`, `docs/QUALITY_SCORE.md`, current `ARCHITECTURE.md`, and the review-format call sites to confirm that the work crosses multiple files and needs a tracked plan.
- [x] (2026-03-17 23:28Z) Rewrote `ARCHITECTURE.md` to describe ReviewFlux as layered domain architecture with explicit cross-cutting boundaries, including a new `src/contracts` boundary and updated dependency guidance.
- [x] (2026-03-17 23:31Z) Introduced `src/contracts/review-comment-format.ts` and switched `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts` to consume that shared contract instead of re-declaring `REVIEW_TITLE`.
- [x] (2026-03-17 23:34Z) Verified the refactor with `pnpm check` and a `vitest` run that passed the full suite (`34` files, `181` tests).

## Surprises & Discoveries

- Observation: `src/lib` is intentionally reserved for small dependency-light helpers and is explicitly called out as the wrong home for domain-heavy shared behavior.
  Evidence: `ARCHITECTURE.md` forbids moving publishing or review logic into `src/lib`.
- Observation: The same review title string currently exists in `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts`.
  Evidence: `rg -n "REVIEW_TITLE|ReviewFlux Review" src tests` shows duplicated definitions in those three source files.
- Observation: `pnpm test -- --run ...` still executed the full Vitest suite through the package script wrapper, which produced stronger evidence than the original targeted-test plan.
  Evidence: the command completed with `34` passing test files and `181` passing tests.

## Decision Log

- Decision: Represent cross-layer review comment formatting as an explicit contract module instead of as a `lib/constants` bucket.
  Rationale: The title wrapper is interpreted by both review runtime and publishing, so it is already a cross-boundary contract rather than a private implementation detail. A named contract module makes that dependency visible and keeps `src/lib` domain-agnostic.
  Date/Author: 2026-03-17 / Codex
- Decision: Keep the structural refactor narrow for this pass and use the contract extraction as the code-level proof of the architecture framing.
  Rationale: The user asked for project-structure cleanup, but the repo already has useful top-level boundaries. A small, real refactor is safer and more reviewable than a broad tree reorganization in one turn.
  Date/Author: 2026-03-17 / Codex

## Outcomes & Retrospective

`ARCHITECTURE.md` now tells a clearer story: ReviewFlux has a shell layer, a review runtime layer, provider/adaptor boundaries, a publishing boundary, and explicit cross-cutting boundaries. The document also now names `src/contracts` as the place for narrow shared contracts.

The code-level proof of that framing landed as `src/contracts/review-comment-format.ts`, which now owns the shared review comment wrapper contract. `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts` all consume that module, so the duplicated `REVIEW_TITLE` constant is gone from production code.

No follow-up tech debt was discovered that needs a separate tracker entry. The next useful structural pass would be to extract additional cross-boundary published-review contracts only when another real duplication appears.

## Context and Orientation

`ARCHITECTURE.md` is the repository codemap and boundary guide. It currently documents `src/cli` and `src/commands` as the shell, `src/review` and `src/review/queue` as the runtime boundary, `src/gateway` as publishing, and `src/config` / `src/infra/logging` / `src/lib` as support boundaries.

The concrete formatting concern sits in three files:

- `src/review/runtime.ts` adds the `"🧠 ReviewFlux Review"` title to posted review bodies and uses the same string to detect previously posted findings.
- `src/review/finding-fingerprint.ts` strips that title before building dedupe fingerprints.
- `src/gateway/review-publisher.ts` prepends and strips the same title when normalizing top-level and inline published comments.

The goal is not to flatten the repo into one universal layer chain. The goal is to make the existing domain boundaries read as a layered architecture, and to make shared contracts between layers explicit in the code layout.

## Plan of Work

First, rewrite `ARCHITECTURE.md` so the top-level story is "layered domain architecture with explicit cross-cutting boundaries" instead of a list of unrelated folders. The document should keep the current file-level guidance, but it needs clearer language for layer owners, dependency direction, and cross-cutting concerns. It should also name a contract boundary so shared formats have an explicit home.

Second, add a new module under `src/contracts/` for the review comment wrapper. The module should export the title constant plus small helpers for ensuring and stripping the wrapper. `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts` should import from that module instead of re-declaring their own title logic. The helper names should stay precise and dependency-light.

Third, run targeted verification. `pnpm check` should prove the import graph and types still compile, and focused `vitest` runs around review runtime, fingerprinting, and publishing should prove behavior did not regress.

## Concrete Steps

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `sed -n '1,260p' docs/PLANS.md`
Expected: Confirms that this multi-file, multi-decision change requires an exec plan.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `rg -n "REVIEW_TITLE|ReviewFlux Review" src tests`
Expected: Shows the duplicated review title and test assertions that rely on it.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm check`
Expected: TypeScript passes with no new errors after the contract extraction.

Working directory: `/Users/kwonsoonmin/Documents/opensource/reviewflux`
Command: `pnpm test -- --run tests/finding-fingerprint.test.ts tests/review-publisher.test.ts tests/review-runtime.test.ts`
Expected: Targeted review-format tests pass and continue to prove wrapper normalization behavior.

## Validation and Acceptance

The change is successful if all of the following are true:

- `ARCHITECTURE.md` opens with a clear layered-domain framing and identifies explicit cross-cutting boundaries and their allowed responsibilities.
- A reader can point to one shared code module that owns the review comment wrapper contract.
- `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts` no longer define their own `REVIEW_TITLE` constants.
- `pnpm check` passes.
- Focused review-format tests pass.

## Idempotence and Recovery

The documentation edits are additive and safe to retry. The contract extraction is also low-risk because it only centralizes pure string-format helpers. If verification fails, the recovery path is to inspect imports and helper names first, then run the targeted tests individually to isolate whether the regression is in runtime behavior, fingerprinting, or publishing normalization.

## Artifacts and Notes

- Key duplicated call sites before the refactor:
  - `src/review/runtime.ts`
  - `src/review/finding-fingerprint.ts`
  - `src/gateway/review-publisher.ts`
- Current boundary guidance that motivates the refactor:
  - `ARCHITECTURE.md` says `src/lib` should stay domain-agnostic and should not absorb publishing or review semantics.
- Verification results:
  - `pnpm check` passed.
  - `pnpm test -- --run tests/review-comment-format.test.ts tests/finding-fingerprint.test.ts tests/review-publisher.test.ts tests/review-runtime.test.ts` completed with `34` passing test files and `181` passing tests.

## Interfaces and Dependencies

The final structure should include:

- `src/contracts/review-comment-format.ts` as a dependency-light shared contract module.
- Existing consumers in `src/review/runtime.ts`, `src/review/finding-fingerprint.ts`, and `src/gateway/review-publisher.ts` importing from that module.
- `ARCHITECTURE.md` updated to describe `src/contracts` as a cross-cutting contract boundary distinct from `src/lib`.

No external libraries are required beyond the existing TypeScript and Vitest toolchain.

## Revision Notes

- 2026-03-17 - Initial plan created for architecture framing and explicit review-format contract extraction.
- 2026-03-17 - Updated progress and outcomes after the architecture rewrite, contract extraction, and successful verification.
