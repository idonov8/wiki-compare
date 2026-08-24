# Working in this repo

## Workflow

When working in a cloud enviornment, open a PR when you finish working on a feature.

## Code comments

No explanatory comments for self-evident code. Avoid over-commenting — only comment where the code's intent isn't clear from reading it.

## Analytics

Every new feature ships with its own PostHog events. Add them to the `EVENTS`
list in `lib/analytics.ts` — the const is what makes a mistyped name a compile
error — and fire them with `track` from the browser or `capture` from a route.
A feature nobody can tell is being used cannot be argued for or removed.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
