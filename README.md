# ReviewFlux

CLI-first runtime for event-driven AI review workflows.

## Current Scope (MVP)

- `reviewflux setup` creates `~/reviewflux/config.json`
- Setup asks:
  - LLM provider (currently Codex only)
  - Auth mode (OAuth or API key)
  - Base URL + model
  - OAuth flow URL + pasted access token
- `reviewflux daemon start` (OAuth mode only for now)
  - waits 3 seconds
  - sends hardcoded message `안녕?` to `/chat/completions`
  - prints model output

## Install for local CLI testing (before npm publish)

```bash
cd /Users/openclaw/.openclaw/workspace/issue-flow-ai
npm install
npm run build
npm link
```

Now you can run the global-style command locally:

```bash
reviewflux setup
reviewflux daemon start
```

To remove the link later:

```bash
npm unlink -g reviewflux
```

## Command Reference

```bash
reviewflux setup
reviewflux daemon install   # placeholder for service manager wiring
reviewflux daemon start
```

## Notes

- This project is structured to be npm-publishable (`bin` points to `dist/cli.js`).
- OAuth token refresh/redirect callback server is not yet implemented; current setup stores a pasted access token.
