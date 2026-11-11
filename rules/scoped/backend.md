---
description: How servers in this repo are installed and run
alwaysApply: false
trigger: glob
globs:
  - "**/servers/**"
paths:
  - "**/servers/**"
---

# Backend

- Use `pnpm`. Do not use `npm` or `yarn` for these servers.
- Each server has its own `package.json`.
- Phase 1 is vertical only: 1 instance, 1 port, cluster workers inside that process.
- Run one server at a time. Start it, test it, stop it, then start the next. Do not run the four servers together.
- Do not kill a process yourself. Ask the user, or let the user run the bench.
- Horizontal scaling, extra machines, and nginx are out of phase 1.
