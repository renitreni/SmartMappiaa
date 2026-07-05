# SmartMappia — Claude Guide

This file is **project memory**. Claude Code reads it automatically at the start of
every session in this repo. Put anything here that you want future Claude to know or
follow — coding conventions, gotchas, "always do X", "never do Y". Edit it freely.

## Where Claude's behavior / "personality" is configured

There is no single hidden personality file — it comes from a few layers, nearest wins:

| What you want to change | Where to edit | Scope |
| --- | --- | --- |
| Project rules, conventions, do/don't | **this file** (`CLAUDE.md` at repo root) | this repo |
| Same, but for *you* across all repos | `~/.claude/CLAUDE.md` (`C:\Users\Raf\.claude\CLAUDE.md`) | all your projects |
| Facts Claude remembers about you/work | auto-memory files in `C:\Users\Raf\.claude\projects\...\memory\` (indexed by `MEMORY.md`) | this project |
| Tone / response style (concise, formal, teaching, etc.) | run `/output-style` to pick or create a style | global |
| Permissions, env vars, hooks (auto-run behavior) | `.claude/settings.json` (project) or `~/.claude/settings.json` (global) | per file |
| Keyboard shortcuts | `~/.claude/keybindings.json` | global |

Quick rules of thumb:
- **"Claude should know / follow this for the project"** → write it here in `CLAUDE.md`.
- **"Claude should talk differently"** → `/output-style`.
- **"Claude should automatically run something on every X"** → a hook in `settings.json`
  (use the `/update-config` skill — the harness runs hooks, not Claude).
- **"Remember this fact about me/my team"** → it goes in the auto-memory folder above.

## Repo layout
- Git root: `smartmappia-web-main/` (this folder)
- Actual app lives one level down in `smartmappia-web-main/smartmappia-web-main/`
  - `frontend/` — React app (Vite)
  - `backend/`
  - `docs/` — documentation, incl. `docs/production/`

## Project conventions
- **Git author for all commits/pushes: `Rafael Harnisch`.** Do not change author identity.
- Do **not** add `Co-Authored-By: Claude` trailers to commits.
- Only commit or push when explicitly asked.
