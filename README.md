# ReviewFlux

CLI-first runtime for event-driven AI review workflows.

## Current Scope (MVP)

- `reviewflux setup` creates `~/.reviewflux/config.json`
- Setup asks with interactive select prompts:
  - LLM provider (currently Codex only)
  - Auth mode (OAuth or API key)
  - model
  - OAuth method:
    - OpenAI Codex OAuth (PKCE + state verification), or
    - paste existing token
- Default OAuth values mirror OpenClaw/pi-ai style (`auth.openai.com`, localhost callback)
- `LLM API base URL` is hidden in default setup and only asked in `--advanced`
- `reviewflux daemon start` (OAuth mode only for now)
  - waits 3 seconds
  - sends hardcoded message `안녕?` to `/chat/completions`
  - prints model output
  - refreshes token when expiry metadata + refresh token are available

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
