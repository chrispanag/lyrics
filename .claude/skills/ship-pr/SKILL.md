---
name: ship-pr
description: Take finished work from a draft PR through /simplify, /code-review and CI to a squash-merge.
argument-hint: "[optional PR title or notes for the description]"
disable-model-invocation: true
---

# Ship a PR

Invoking this skill authorizes every outward-facing step in it, including the
merge. Do not stop to ask for confirmation between steps. Stop and report only
when a step below says to.

Arguments, if any: `$ARGUMENTS`. Treat them as the PR title or as notes for the
description.

## Verify

Several steps below say **verify**. That means:

1. Run the checks the change can affect. `make check` covers everything. If
   the diff touches only one stack, that stack's targets are enough:
   `make lint-backend test-backend` or `make lint-web test-web`. A diff that
   touches no code needs none.
2. Fix anything they report.
3. Commit whatever changed, with a message in the style of `git log`. If
   nothing changed, there is nothing to commit.

Pushing is done separately, so that several commits can go up in one push and
start one CI run, not several.

## 1. Open a draft PR

1. Run `git status` and `git branch --show-current`. If the current branch is
   `main`, create a branch with a short descriptive name first.
2. If the work is uncommitted, **verify** it.
3. `git push -u origin HEAD`
4. Run `gh pr view --json number,state,isDraft` to see whether this branch
   already has a PR. Reuse it only if its state is `OPEN`, and mark it draft
   with `gh pr ready --undo` unless it already is. A `MERGED` or `CLOSED` PR
   for the same branch name does not count: `gh pr view` falls back to one
   when no PR is open, and it cannot be pushed to or merged again.
5. Otherwise run `gh pr create --draft --base main`, passing the body with
   `--body-file`:
   - **Title:** a plain-language sentence stating what changed and why, in the
     style of recent titles (`git log --oneline -10`). Do not use a
     conventional-commit prefix.
   - **Body:** prose in American English, written to match recent PRs
     (`gh pr view <recent number>`). Cover what the change does, the reasoning
     a reviewer needs, what was deliberately left out, and the checks that
     were run.

Record the PR number as `<n>`.

## 2. Simplify, review, and mark ready

1. Invoke the `simplify` skill through the Skill tool.
2. Invoke the `code-review` skill through the Skill tool, with
   `args: "high --fix"`. Findings it reported but did not fix are still your
   problem. Fix each one that holds up. Dismiss each one that does not, with a
   one-line reason that goes in the final summary. Do not drop findings
   silently.
3. If the working tree changed, whether by either skill or by your own fixes
   for its findings, **verify**, then push once.
4. If the changes altered what the PR does, or made a claim in the body untrue,
   update the body with `gh pr edit <n> --body-file`.
5. `gh pr ready <n>`

## 3. Wait for CI

Checks take a few seconds to register after a push, and until they do,
`gh pr checks` may report the previous commit's results or none at all. Get
the pushed SHA with a plain `git rev-parse HEAD` first, and write it into the
loop as `<sha>`: a worktree-isolated session refuses a `git` call nested inside
a compound command. Then run this with `run_in_background: true`, since you are
notified when it exits:

```bash
head=<sha>
for i in $(seq 30); do
  if [ "$(gh pr view <n> --json headRefOid -q .headRefOid)" = "$head" ]; then
    count=$(gh pr checks <n> --json name -q length 2>/dev/null)
    [ "${count:-0}" -gt 0 ] && break
  fi
  sleep 10
done
gh pr checks <n> --watch --interval 30
```

The loop counts the checks rather than reading the exit code, because
`gh pr checks` exits 1 both when no checks exist yet and when one has already
failed. If the loop runs out (five minutes) and the watch reports no checks,
stop and report: CI is not running for this PR. Do not poll while the job runs.
Wait for the notification.

## 4. If CI fails, fix it and go back to 3

1. Find the failing run with `gh pr checks <n>`, then read the failure with
   `gh run view <run-id> --log-failed`.
2. Reproduce it locally with the matching `make` target before changing
   anything. Use the raw command from `.github/workflows/ci.yml` only for a
   step that has no target, such as `next build` or an image build.
3. Fix the root cause. Do not skip, delete, or loosen a test to make it pass.
   If the test itself is wrong, say so explicitly in the commit message and in
   the summary.
4. **Verify**, push, and go back to step 3.

If the failure is outside this PR's control (flaky infrastructure, an outage, a
missing secret), rerun it once with `gh run rerun <run-id> --failed`, then
wait for it with `gh run watch <run-id> --exit-status`, run in the background
like step 3. If it fails the same way again, stop and report.

**Stop after three fix rounds** that do not turn CI green. Report what is still
failing and what you tried. Leave the PR open. Do not merge.

## 5. Merge

When every check passes:

1. Run `gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision`. If
   `mergeable` is `UNKNOWN`, GitHub has not computed it yet: wait ten seconds
   and ask again, up to five times, before deciding. If the PR is not
   mergeable, stop and report why. For example, a required review may be
   missing. The exception is a conflict with `main` (`CONFLICTING`): run
   `git fetch origin`, rebase onto `origin/main`, resolve the conflicts,
   **verify**, push with `--force-with-lease`, and go back to step 3. Without
   the fetch, `origin/main` is the stale copy the branch already sits on, the
   rebase does nothing, and the conflict comes straight back. Rebase once; if
   the PR still conflicts afterwards, stop and report.
2. Run `gh pr merge <n> --squash`. Never pass `--admin`.
3. Delete the remote branch with `git push origin --delete <branch>`. Do not
   use `gh pr merge --delete-branch` for this. It also switches the local
   checkout to `main`, which fails inside a worktree.
4. Confirm the merge with `gh pr view <n> --json state,mergeCommit`.

## 6. Report

Keep it short:

- the PR link and its final state (merged, or open and why)
- what `/simplify` and `/code-review` changed, plus any findings dismissed and
  why
- any CI failures and how each was fixed
