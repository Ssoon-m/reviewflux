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
│               Review runtime                  │
│   loads PR diff, comments, and `AGENTS.md`    │
└─────────────────┬─────────────────┬───────────┘
                  │                 │
                  │                 └─ JSONL logs and local review state
                  ▼
┌───────────────────────────────────────────────┐
│                 LLM provider                  │
│        analyzes changes and drafts review     │
└─────────────────┬─────────────────────────────┘
                  ▼
┌───────────────────────────────────────────────┐
│            Review posting gateway             │
│      publishes summary and inline findings    │
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

> [!IMPORTANT]
> ReviewFlux depends on GitHub CLI (`gh`) for repository lookup and authentication.  
> If `gh` is not installed yet, install it first and run `gh auth login` before `rvw setup`.

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

### `rvw` quick reference

| Stage | Command | Purpose |
| --- | --- | --- |
| Quick help | `rvw --help` | Show all top-level commands and global options |
| Initial setup | `rvw setup` | Configure auth model and generate local config files |
| Add repo | `rvw repo add` | Register a repository for review tracking |
| List repos | `rvw repo list` | Check all currently tracked repositories |
| Remove repo | `rvw repo remove` | Stop tracking a repository |
| Set repo model | `rvw repo set-model` | Change the review model for a specific repo |
| Start daemon | `rvw daemon start` | Start ReviewFlux background watcher |
| Stop daemon | `rvw daemon stop <pid>` | Stop daemon process returned by `rvw daemon list` |
| Daemon status | `rvw daemon status` | View daemon/service status |
| List daemons | `rvw daemon list` | Show running daemon processes |
