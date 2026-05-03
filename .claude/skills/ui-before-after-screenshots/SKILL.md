---
name: ui-before-after-screenshots
description: Capture before/after responsive screenshots of the Narratio UI for a PR — "before" from `main`, "after" from the target branch — using docker compose + Playwright at desktop/tablet/phone widths. Pushes the PNGs to a dedicated `screenshots/pr-<num>` branch via the GitHub MCP (keeping `main` and the PR branch free of image bytes) and updates the PR body with comparison tables that reference raw URLs from that branch. Use when applying the UI & Frontend Policy (CLAUDE.md) to a PR that touches the admin UI.
---

# /ui-before-after-screenshots

Captures before/after screenshots so a UI PR satisfies the policy in `CLAUDE.md` ("a screenshot of the before and the after should be added to the pull request").

**Inputs the user must supply (or you must infer):**
- `<branch>` — the feature branch (the "after"). Default: current branch.
- `<pr-number>` — the GitHub PR number for `<branch>`. Look it up via `mcp__github__list_pull_requests` with `head=AsierZunzu:<branch>` if not given.
- `<paths>` — one or more paths to screenshot (e.g. `/`, `/feeds`, `/voices`). Default: `/`.

## Why the careful sequencing

Two pitfalls bit us last time and the steps below avoid them:

1. **`docker compose up -d` reuses the cached `ghcr.io/asierzunzu/narratio:latest` image.** Without `--build`, switching branches has no effect — both runs serve whichever code was last built. **Always pass `--build`** when switching between branches.
2. **The compose default port (3000) is often busy** on the dev box, and setting `PORT=3200` propagates *into* the container, breaking the `host:container` mapping. Use a `compose.override.yaml` that pins container `PORT=3000` and maps `3200:3000` instead.

## Workflow

### 1. Prep

```bash
REPO=$(git rev-parse --show-toplevel)
PR=<pr-number>
BRANCH=<branch>
mkdir -p $REPO/screenshots/pr-$PR/{before,after}
```

`screenshots/` is already gitignored — these PNGs stay local and are never committed.

Verify the branch's PR exists; capture the PR body for later editing (`mcp__github__pull_request_read` with `method: get`).

### 2. Capture "after" (the feature branch)

Run from the main repo checkout (already on `<branch>`).

a. Write a temporary `compose.override.yaml` at the repo root (do **not** commit it):

```yaml
services:
  narratio:
     build: .
     environment:
       PORT: "3000"
       BASE_URL: "http://localhost:3200"
     ports: !override
       - "3200:3000"
```

If a `compose.override.yaml` already exists, edit it instead of overwriting — preserve any existing keys (e.g. `build: .`).

b. Bring up with a forced rebuild:

```bash
cd $REPO && docker compose up -d --build
```

Wait until `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3200/` returns `200` (5–10s after `narratio` reports Started).

c. **Sanity check the served code** — confirms the build actually picked up the branch's source:

```bash
curl -sS http://localhost:3200/assets/styles.css | wc -l
```

Note this number; it must differ from the "before" run (or matches a known signature for the branch).

d. Take the screenshots:

```bash
SCREENSHOT_URL=http://localhost:3200 \
SCREENSHOT_DIR=/tmp/shots-after \
node scripts/screenshot.mjs <path>
```

Repeat for each `<path>`. Each invocation produces three files: `<safepath>-{desktop,tablet,phone}.png`.

e. Stop the stack:

```bash
cd $REPO && docker compose down
```

### 3. Capture "before" (`main`)

a. Create a worktree at `main` per the project's worktree policy:

```bash
git worktree add $REPO/.claude/worktrees/screenshot-main main
```

b. Copy the populated data dir so the UI looks identical to the "after" capture (same feeds, same articles — only the chrome/CSS differs):

```bash
cp -r $REPO/data $REPO/.claude/worktrees/screenshot-main/
```

c. Write the same `compose.override.yaml` (step 2a content) inside the worktree.

d. Bring up with `--build` so docker rebuilds from `main`'s source:

```bash
cd $REPO/.claude/worktrees/screenshot-main && docker compose up -d --build
```

e. Sanity check (step 2c). The line count **must differ** from the "after" run; if it doesn't, the build cache fooled you — `docker compose down`, then `docker compose build --no-cache` and retry.

f. Capture into `/tmp/shots-before/` (same `node scripts/screenshot.mjs` invocation as 2d, with `SCREENSHOT_DIR=/tmp/shots-before`).

g. `docker compose down`, then remove the worktree:

```bash
cd $REPO/.claude/worktrees/screenshot-main && docker compose down
git worktree remove --force $REPO/.claude/worktrees/screenshot-main
git worktree prune
```

### 4. Stage screenshots locally (do NOT commit to `main` or the PR branch)

Copy the PNGs into `screenshots/pr-$PR/` so they're collected for the MCP upload. `screenshots/` is gitignored — nothing here is committed via `git`.

```bash
cp /tmp/shots-before/*.png $REPO/screenshots/pr-$PR/before/
cp /tmp/shots-after/*.png  $REPO/screenshots/pr-$PR/after/
ls $REPO/screenshots/pr-$PR/{before,after}/
```

### 5. Push PNGs to a dedicated `screenshots/pr-<PR>` branch via the GitHub MCP

This branch is parallel to `main` and never merges. The PR's feature branch and `main` stay free of image bytes; only this dedicated ref carries them.

a. List branches to see whether the dedicated branch already exists:

   `mcp__github__list_branches` → look for `screenshots/pr-<PR>`.

b. **If it does not exist**, create it from `main`:

   `mcp__github__create_branch` with `branch: "screenshots/pr-<PR>"`, `from_branch: "main"`.

c. Upload the PNGs in a single atomic commit using `mcp__github__push_files`:

   - `branch: "screenshots/pr-<PR>"`
   - `message: "screenshots: PR #<PR>"`
   - `files`: one entry per PNG. Read each file as binary and **base64-encode** the bytes for the `content` field. Paths inside the branch:
     - `pr-<PR>/before/<viewport>.png`
     - `pr-<PR>/after/<viewport>.png`

   If the active `push_files` implementation rejects binary, fall back to `mcp__github__create_or_update_file` per PNG (the underlying contents API accepts base64 natively).

d. Verify with `mcp__github__get_file_contents` (`ref: "screenshots/pr-<PR>"`) on one PNG and confirm the SHA / size matches the local file.

### 6. Update the PR body with raw-URL tables

Use `mcp__github__update_pull_request`. Keep the original Summary / Test plan, append a `## Screenshots` section. Raw URL pattern (note the doubled `pr-<PR>` — the **branch** is `screenshots/pr-<PR>` and the **path inside** that branch is `pr-<PR>/...`):

```
https://raw.githubusercontent.com/AsierZunzu/Narratio/screenshots/pr-<PR>/pr-<PR>/{before,after}/<viewport>.png
```

Template per viewport (desktop/tablet/phone):

```markdown
| Before (`main`) | After (`<branch>`) |
|---|---|
| ![desktop before](RAW_URL_BEFORE) | ![desktop after](RAW_URL_AFTER) |
```

Include test conditions in the body: path(s) captured, viewport sizes 1440×900 / 768×1024 / 375×812, populated DB.

### 7. Cleanup

- Revert any temporary edits to `compose.override.yaml` at the repo root.
- The local `screenshots/pr-<PR>/` is gitignored and can be deleted (`rm -rf $REPO/screenshots/pr-$PR`); the canonical copy now lives on the `screenshots/pr-<PR>` branch.
- Confirm `git worktree list` shows only intentional worktrees.
- Confirm no orphan `node`/docker processes remain (`docker compose ps`, `ss -tlnp | grep -E ':(3000|3200)'`).
- **Do not** delete or merge the `screenshots/pr-<PR>` branch — the raw URLs in the PR body depend on it.

## Common pitfalls (from prior runs)

- **Forgot `--build`** → both screenshots show the same code. Always `--build` when switching branches.
- **Empty DB on one side** → before/after look different for the wrong reason. Copy `data/` to the `main` worktree before bringing it up.
- **Port 3000 already bound** → use the override file with `3200:3000`. Don't set `PORT=3200` directly because compose propagates it into the container.
- **Committing PNGs to `main` or the PR branch** → don't. The dedicated `screenshots/pr-<PR>` branch is the only place these bytes belong, and they get there via MCP, not `git push`.
- **Forgetting to base64-encode** PNGs before passing to `push_files` / `create_or_update_file` → upload corrupt or rejected. PNGs are binary; always base64-encode.
- **Bare `node` server spawn** → don't. Always go through `docker compose` so you can stop it cleanly with `docker compose down` (project preference: avoid `kill`).
