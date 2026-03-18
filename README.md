# ReviewFlux

A CLI-first review daemon that detects review activity from Git hosting platforms and automatically writes AI-powered reviews.

## Overview

ReviewFlux listens for pull request activity. When a PR is opened, updated, or manually re-triggered, it queues review work, runs an AI review pass, and posts the result back to the hosting platform.

> No separate webhook service or per-repository manual wiring required. After the one-time `rvw setup` to choose your auth and preferred model, just register a repository with `rvw repo add` and start the daemon.

## How It Works

Current runtime flow for GitHub looks like this:

```text
(PR opened, new commits, manual review trigger)
                │
                ▼
┌───────────────────────────────────────────────┐
│         ReviewFlux daemon (`rvw daemon`)      │
│                 polling loop                  │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│              SQLite review queue              │
│      stores review work safely in SQLite      │
└─────────────────┬─────────────────────────────┘
                  │
                  ▼
┌───────────────────────────────────────────────┐
│               Review runtime                 │
│   loads PR diff, comments, and `AGENTS.md`   │
└───────────────┬───────────────────┬───────────┘
                │                   │
                │                   └─ JSONL logs and local review state
                ▼
┌───────────────────────────────────────────────┐
│                 LLM provider                 │
│        analyzes changes and drafts review    │
└─────────────────┬─────────────────────────────┘
                  ▼
┌───────────────────────────────────────────────┐
│            Review posting gateway            │
│      publishes summary and inline findings   │
└─────────────────┬─────────────────────────────┘
                  ▼
        ai review/comments
```

## Supported Platforms

| Platform  | Status         |
| --------- | -------------- |
| GitHub    | ✅ Supported   |
| GitLab    | 🚧 Coming soon |
| Bitbucket | 🚧 Coming soon |

> ⚠️ This project is currently a work in progress (WIP).
> Features and command behavior may change.

## Requirements
- Node.js `20.x` or `22+`
- `pnpm@10.30.3`

## Install
```
npm install -g reviewflux@latest
```

This installs the preferred `rvw` command and keeps `reviewflux` as a compatibility alias.

> If `gh` is not installed yet, install GitHub CLI and run `gh auth login`

## Quick Start
```bash
# Install
pnpm install
pnpm build

# 1. Setup (choose auth/model + create config files)
rvw setup

# 2. Add a repository to track
rvw repo add

# 3. Start the daemon
rvw daemon start
```
