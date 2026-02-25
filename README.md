# ReviewFlux

CLI-first runtime for event-driven AI review workflows.

## Current Scope (MVP)

- `reviewflux setup` creates `~/.reviewflux/config.json`
- Setup asks with interactive prompts:
  - LLM provider (currently Codex only)
  - Auth mode (OAuth or API key)
  - default model via single-select
    - OAuth mode: OpenAI-Codex catalog (e.g., `gpt-5.3-codex`, `gpt-5.3-codex-spark`, ...)
    - API key mode: OpenAI codex-family models
  - effort selection: low / medium / high / extra high
  - OAuth method:
    - OpenAI Codex OAuth (PKCE + state verification), or
    - paste existing token
- Default OAuth login uses `@mariozechner/pi-ai` (same integration approach as OpenClaw); advanced mode keeps manual endpoint overrides
- `LLM API base URL` is hidden in default setup and only asked in `--advanced`
- `reviewflux daemon start`
  - waits 3 seconds
  - executes a smoke prompt via `@mariozechner/pi-ai` (`안녕?`) using the currently selected model (`config.model`)
  - applies configured effort (`config.effort`, default `medium`)
  - prints model output
  - refreshes OAuth token when expiry metadata + refresh token are available

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

If you still see old numeric prompts, refresh your link:

```bash
git pull
npm install
npm run build
npm link
```

To remove the link later:

```bash
npm unlink -g reviewflux
```

## Command Reference

```bash
reviewflux setup
reviewflux setup --advanced
reviewflux daemon install   # placeholder for service manager wiring
reviewflux daemon start
```

## Notes

- This project is structured to be npm-publishable (`bin` points to `dist/cli.js`).
- OAuth supports both local callback server and manual paste flow (redirect URL / code / code#state).
- Setup UX follows OpenClaw-style staging: URL ready → browser open → callback wait → (fallback only if needed) paste redirect URL/code.
