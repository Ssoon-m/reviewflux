# Tech Debt Tracker

| Area | Debt | Why It Matters |
|------|------|----------------|
| Knowledge base migration | Legacy docs like `docs/structure.md` and `docs/coding-convention.md` still sit beside the new knowledge-map layout instead of being fully folded into it. | The new system is usable now, but navigation is still split between old and new entrypoints. |
| Product specs | Onboarding is documented, but repo management, manual triggers, and review-output expectations are not yet split into dedicated specs. | Product behavior is more stable than the current spec coverage suggests. |
| Generated artifacts | `docs/generated/db-schema.md` is currently maintained by hand. | A real generation step would make schema snapshots easier to trust over time. |
| Context model docs | Runtime context loading behavior exists in code and reference notes, but the user-facing implications are still thin. | Context quality is central to review quality, so drift here is expensive. |
