---
name: merge
description: >-
  Merge the current branch of the Orbito repository (woxox/orbito) into main
  through a GitHub pull request: commit, rebase, verify, open or reuse the PR,
  gate on its checks, squash-merge, and confirm. Invoke only when the user has
  explicitly asked to merge or land the change (Merge Change, /merge, or
  equivalent words), not for review, preparation, passing checks, or skill
  installation.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Merge to main (woxox/orbito)

Invoking this skill is the merge request. Do not ask again whether to merge, and never answer `/merge` by saying you are waiting for an explicit merge request. Stop only for the genuine blockers named below, and then say plainly that the change has **not** merged and why.

Target: `main` of `woxox/orbito` (`origin`). Tools: `git`, `gh` (authenticated). There is no branch protection on this repository (private, free plan), so every gate below is enforced by this skill itself.

## 1. Preflight

```sh
git status -sb
git branch --show-current
git log -3 --format="=== %h%n%B"
```

- Refuse to run on `main` itself; the change must be on its own branch.
- Uncommitted work that belongs to this change: commit it, following the format of the recent commits (`type(scope): 요약`, short bullets or no body, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; no `Claude-Session` trailer).
- Changes that are unrelated or whose scope is unclear: leave them untouched and stop to ask. Never stash, reset or discard them.

## 2. Bring the branch up to date

```sh
git fetch origin
git rebase origin/main
```

Conflict policy (user's choice: resolve automatically when intent is clear):

- Resolve a conflict yourself only when the intended result is clear from both sides and preserves both the branch's change and what landed on `main`. Then `git add` the files and `GIT_EDITOR=true git rebase --continue` (never an interactive rebase or editor).
- If intent is ambiguous, the resolution would drop someone's work, or it touches something unsafe: `git rebase --abort`, report the conflicting files and both sides, and wait for the user.
- After any resolution, redo step 3 before publishing.

Publish:

```sh
git push --force-with-lease -u origin HEAD
```

Only `--force-with-lease`, never `--force`.

## 3. Local verification

There is no build or test CI on pull requests (`.github/workflows/` has only `claude-code-review.yml` for PRs), so local runs are the only behavioral check. Keep them proportional:

- Changes only to docs, `.github/`, `scripts/remote/`, or other non-app files: no app build needed; say so in the report.
- Changes under `src/` (app code): if this worktree has its own `engine/` (set up by `scripts/worktree-engine.sh`, see `AGENTS.md` → "Building in a worktree"), run:
  ```sh
  pnpm build:artifact                                            # package.json "build:artifact"
  cd engine && ./mach python ../scripts/shell-browser-test.py    # Shell tests (usage in the script's docstring)
  cd engine && ./mach python ../scripts/agent-browser-test.py    # assistant tests (usage in the script's docstring)
  ```
  Run the suite(s) matching the changed area (Shell vs assistant); both via `cd engine && ./mach python ../scripts/browser-tests.py` (docstring of that script). Never build or test from the main checkout's `engine/` from a worktree, and do not repoint it.
- If the worktree has no `engine/`, do not set one up implicitly; skip the local run and state in the report that it was not run.
- A failing build or test is a blocker: fix it if it is caused by this change and clearly fixable, otherwise stop and report. Do not merge over a failure.

## 4. Pull request

```sh
gh pr list --head "$(git branch --show-current)" --state open --json number,title,isDraft
```

- An open PR exists: use it. If its description no longer matches the change, update it with `gh pr edit`.
- None exists: create one against `main`:
  ```sh
  gh pr create --base main --title "<type(scope): 요약>" --body "$(cat <<'EOF'
  ## Why
  ...

  ## What changed
  - ...

  Closes #<n>

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  EOF
  )"
  ```
  Title in the commit convention, body in Korean like recent PRs. Include `Closes #<n>` only when the change resolves a GitHub issue.
- A draft PR is a blocker unless the user said it is ready (`gh pr ready <n>` then).

## 5. Check gate (must pass before merging)

```sh
HEAD_SHA=$(git rev-parse HEAD)
gh pr view <n> --json headRefOid,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup
gh pr checks <n> --watch --fail-fast
```

Merge only when all of these hold for the current head:

- `headRefOid` equals `$HEAD_SHA` (the checks being judged belong to the commit being merged).
- Every entry in `statusCheckRollup` is completed with conclusion `SUCCESS` (or `SKIPPED`/`NEUTRAL`). Today that is `claude-review`; it should appear once the PR is opened or synchronized. Pending: keep waiting. Failing, cancelled, missing after a reasonable wait, or unverifiable: blocker; do not treat as success.
- `mergeStateStatus` is `CLEAN` and `mergeable` is `MERGEABLE`; not a draft.
- `reviewDecision` is not `CHANGES_REQUESTED`, and no unresolved review comment from `claude-review` points out a real defect in this change. Address real defects (back to step 3) rather than merging over them.

## 6. Merge

Squash-merge, matching recent history (`<PR title> (#N)` on `main`):

```sh
gh pr merge <n> --squash --match-head-commit "$HEAD_SHA"
```

Do not pass `--delete-branch` (the branch is checked out in a worktree and `main` may be checked out elsewhere). Delete only the remote branch afterwards:

```sh
git push origin --delete "$(git branch --show-current)"
```

If the merge is rejected (head moved, not mergeable), go back to step 2; never use `--admin`.

## 7. Issue tracker

If the PR closed an issue (`Closes #<n>`), set its **Orbito Roadmap** Status to `Done` exactly as in `docs/agents/issue-tracker.md` → "Working a ticket" (option id `98236657`).

## 8. Confirm

```sh
gh pr view <n> --json state,mergeCommit --jq '{state, sha: .mergeCommit.oid}'
git fetch origin
git branch -r --contains <merge-sha> | grep -x '  origin/main'
```

Success only when the PR is `MERGED` and the merge commit is on `origin/main`. Report the PR number, the merge commit, what local verification ran (or why it was skipped), and any issue status updated.
