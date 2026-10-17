# Changelog

## 1.1.0 — 2026-10-17

Orchestrator brings coordinated tasks and dependency flowcharts into VS Code.

- Coordinate predefined or agent-created tasks with per-task steps, specialist agent assignments, saved progress and coordinated repairs through CLI 0.1.1.
- Inspect collapsible task hierarchies and dependency graphs with branches, convergences and cross-links; sorting and filtering preserve hierarchy.
- Switch horizontal/vertical direction and simple/detailed diagrams with every task’s steps, custom stages and Git integration.
- Keep diagram direction, detail mode and scroll position during live updates; select tasks and steps for results and conversation.
- Use the same dependency graph in All flowcharts and run orchestrator-plan/orchestrator-agent examples.
- Install and update the CLI through `@latest`; download the current VSIX from GitHub Releases/latest.

Requires VS Code 1.106+ and CLI 0.1.1 or later. Existing screenshots show extension 1.0.0 with demonstration data.

## 1.0.0 — 2026-10-14

First official stable release of Maestrun for VS Code.

- Configure workflows, generate plans, run/resume tasks, and answer pending questions.
- Follow projects in the Secondary Side Bar, editor dashboards, and grouped flowcharts.
- Run Simple/Advanced examples and discover examples started from the terminal.
- Refresh or remove project entries with icons and confirmation, including a WSL Trash fallback.
- Inspect errors and execution logs; open installation guidance when the CLI is missing.

Includes illustrated English and Portuguese guides. Requires VS Code 1.106+ and a separate Maestrun CLI installation; tested with CLI 0.1.1-beta.5.

Earlier builds were test packages and are not included in this repository or release.
