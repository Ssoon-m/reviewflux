# Contributing to ReviewFlux

## Local Development

```bash
corepack pnpm install
corepack pnpm dev
```

## Useful Commands

- `pnpm build` — compile TypeScript
- `pnpm check` — type-check without emit
- `pnpm test` — run test suite
- `pnpm test:fast` — quick local test run
- `pnpm test:all` — full local quality gate (`build + check + test`)

## Before Opening a PR

Run:

```bash
pnpm build && pnpm check && pnpm test
```

## PR Guidelines

- Keep PRs focused (one concern per PR)
- Explain what changed and why
- Include reproducible test steps
- Use the PR template sections
