# Codex Kanban

A small local task board for keeping Codex-ready work organized across projects.

## Run

```powershell
node server.mjs
```

Open:

```text
http://localhost:3001
```

Secure local start:

```powershell
.\start-secure.ps1
```

This reads `kanban-access-token.txt`, optionally reads `github-token.txt`, sets `GITHUB_DEFAULT_REPO=Creaboobot/Board`, and starts the server.

Data is stored in:

```text
data/store.json
```

The first board is seeded for Pabal. Add more projects from the sidebar when you want a general backlog or another repository.

## Codex workflow

The intended flow is:

1. Create a task in Backlog.
2. Press `Request task review`. This follows the project route: Local creates a readiness proposal on the board, Cloud creates or reuses the task's GitHub issue and posts a review-only `@codex` request, and Ask prompts for the review route.
3. When Codex Cloud posts the review proposal, the board syncs it back into the card. Read the proposal, edit the card if needed, then press `Apply proposal`.
4. Press `Start Codex` when you want implementation to begin. The project route decides whether this starts Codex Cloud or Local Codex. If the review already created a GitHub issue, Codex Cloud implementation is triggered in that same issue thread. The task moves to In Progress.
5. The server checks GitHub automatically. Local and Cloud completions both open the same result review view with the original input collapsed and the result output separated from Codex commentary.
6. Press `Confirm result` to move the task to Done, optionally closing the linked GitHub issue.
7. Press `Further directions` to add guidance. If the task has a GitHub issue, the board can post that guidance back to GitHub and trigger Codex Cloud again.

The local-only path is still available:

- If GitHub is not configured, `Request task review` falls back to a local proposal.
- `Start Local Codex` moves a task to Ready and creates a local Markdown handoff packet under `data/handoffs`.
- A local Codex instance can claim and complete those handoffs through the API below.
- GitHub/Codex Cloud handoffs supersede stale local handoffs, so old local queue items do not keep appearing as active work.

When you are in Codex, you can say:

```text
Take the next Codex Kanban task.
```

Codex can read the queue from:

```text
GET /api/codex/next
GET /api/codex/queue
POST /api/codex/claim-next
```

Codex can complete a claimed handoff with:

```text
POST /api/codex/handoffs/:id/complete
```

Expected JSON body:

```json
{
  "summary": "Implemented the requested workflow.",
  "details": "Short implementation notes.",
  "changedPaths": ["C:\\path\\to\\file.js"],
  "verification": ["node --check server.mjs"],
  "followUps": ["Optional next task"]
}
```

The task modal shows review proposals, read-only results, and a task activity timeline.

Each task can also set a `Repository override` and `Environment guidance`. Leave the repository blank to use the current project's default repository. Fill it with `owner/repo` when a specific task should create its GitHub issue and Codex Cloud handoff in another repository. Environment guidance is copied into local handoff packets, GitHub issues, review requests, and implementation requests so Codex knows which environment, branch, or deployment target the work belongs to.

## GitHub and Codex Cloud handoff

Set `GITHUB_DEFAULT_REPO` and `GITHUB_TOKEN` to enable the Codex Cloud route behind `Start Codex`. The current default target is:

```text
GITHUB_DEFAULT_REPO=Creaboobot/Board
```

Recommended fine-grained GitHub token permissions for the target repository:

- Metadata: read
- Issues: read and write
- Pull requests: read and write
- Contents: read

The action creates a GitHub issue from the task card. If confirmed in the browser, it also adds an `@codex` comment so Codex Cloud can pick up the task from GitHub after the repository is connected in ChatGPT Codex.

If a task already has a GitHub issue, the same button posts a new `@codex` comment to that existing issue instead of creating a duplicate. This keeps review, implementation, and later change requests in one issue thread, although each Codex Cloud run may still appear as its own Codex task inside ChatGPT.

Repository selection order is task override, project default, then `GITHUB_DEFAULT_REPO`.

Result sync:

- The server polls active GitHub issues every 60 seconds by default.
- Manual sync is available from `Check GitHub result` on the card.
- Set `GITHUB_SYNC_INTERVAL_MS=0` to disable background polling.
- Set `GITHUB_SYNC_INTERVAL_MS=30000` or another millisecond value to change the interval.

Read-only sync endpoints:

```text
POST /api/tasks/:id/github-sync
POST /api/github/sync
```

## Cloud hosting

The app is ready to run behind a public HTTPS endpoint as a small Node service. For public hosting, always set an access token and use persistent storage.

Environment variables:

```text
PORT=3001
HOST=0.0.0.0
KANBAN_DATA_DIR=/data
KANBAN_ACCESS_TOKEN=replace-with-a-long-random-token
GITHUB_DEFAULT_REPO=Creaboobot/Board
GITHUB_TOKEN=github_pat_with_issue_write_access
GITHUB_SYNC_INTERVAL_MS=60000
```

`KANBAN_ACCESS_TOKEN` protects the JSON API. The static shell can load, but board data and mutations require the token.

Health check:

```text
GET /api/health
```

Docker:

```powershell
docker build -t codex-kanban .
docker run --rm -p 3001:3001 -v codex-kanban-data:/data -e KANBAN_ACCESS_TOKEN=replace-with-a-long-random-token codex-kanban
```

Docker Compose:

```powershell
docker compose -f deploy/docker-compose.yml up --build
```

Easy public access:

- Use Cloudflare Tunnel when you want a stable public URL without opening router ports.
- Copy `deploy/cloudflare-tunnel.example.yml`, replace `board.example.com`, and point the tunnel at the running app on port `3001`.
- Put Cloudflare Access in front of the hostname if the board is reachable from the public internet.

The JSON store is fine for a personal board. If multiple people will edit the board at the same time, migrate the data layer to Postgres before relying on it as a team system.
