# ReviewFlux

A background CLI agent that detects PR events from Git hosting platforms and automatically writes AI-powered reviews.

## Overview

ReviewFlux runs as a daemon in the background, listening for pull request events. When a PR is detected, it uses an AI agent to analyze the changes and post a review — helping teams automate code review workflows.

## Queue-Based Event Handling

When the daemon receives many events at once, each review can take time because AI analysis is not instantaneous. A queue ensures events are processed safely in order, prevents dropped requests during bursts, and keeps the daemon stable under load.

## Supported Platforms

| Platform  | Status         |
| --------- | -------------- |
| GitHub    | ✅ Supported   |
| GitLab    | 🚧 Coming soon |
| Bitbucket | 🚧 Coming soon |

> ⚠️ This project is currently a work in progress (WIP).
> Features and command behavior may change.

## Quick Start

```bash
# Install
pnpm install
pnpm build

# Setup (default auth + creates config files)
reviewflux setup

# Add a project to track
reviewflux project add

# Start the daemon
reviewflux daemon start
```

## Architecture

- **CLI** — Command-line interface for setup and daemon control
- **Gateway** — HTTP server handling webhooks from Git platforms
- **LLM** — AI agent for generating code reviews
- **Auth** — OAuth token management for each platform

See [AGENTS.md](./AGENTS.md) for the full architecture guide.
