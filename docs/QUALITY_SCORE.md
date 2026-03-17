# ReviewFlux Agent Work Quality Score

This file is a qualitative rubric for evaluating completed agent work in this repo.

## Scale
- `Verified` - the work is evidenced, in-scope, and aligned with repo rules.
- `Mostly Verified` - the core task is done, but some supporting evidence or polish is thin.
- `Incomplete` - the direction is reasonable, but important gaps remain.
- `Unverified/Risky` - correctness, safety, or verification is missing or contradicted.

| Dimension | What To Look For |
|-----------|------------------|
| Requirement alignment | Does the change solve the requested task without quietly drifting out of scope? Is uncertainty made explicit instead of being guessed through? |
| Correctness and invariants | Does the behavior match this repo's correctness rules and avoid casually weakening guarantees around dedupe, recovery, output, or state? |
| Verification evidence | Is there concrete evidence such as updated tests, type checks, build results, or explicit manual validation? `Do not guess; verify with code/tests/types/build results.` |
| Completeness | Does the work carry through to adjacent files, fallback behavior, operator-visible output, and required docs or follow-up updates? Do important findings or failure signals remain visible? |
| Maintainability and fit | Does the solution match existing boundaries and conventions, keep complexity under control, use precise naming, and avoid brittle shortcuts or type-safety erosion? |
| Safety and operational hygiene | Are secrets redacted, logs informative but safe, external-facing failures stable, and risky hidden-default behavior avoided? |
| Documentation and reviewability | Is it easy for the next engineer or agent to understand what changed, why it changed, what was verified, and what still needs follow-up? |

## How To Use This File
- Score one completed task, PR-sized change, or document rewrite at a time.
- Prefer short evidence notes over fake numeric precision.
- Link each score to the strongest proof available: tests, checks, file paths, runtime behavior, or docs.
- Lower the score when work is technically plausible but not actually verified.
