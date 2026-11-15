---
name: ship-pr
description: Take finished work all the way to main. Opens a draft PR, runs /simplify, runs /code-review high --fix, marks the PR ready, waits for CI and fixes any failures, then squash-merges.
argument-hint: "[optional PR title or notes for the description]"
disable-model-invocation: true
---

# Ship a PR

Invoking this skill authorizes every outward-facing step in it, including the
merge. Do not stop to ask for confirmation between steps. Stop and report only
when a step below says to.

Arguments, if any: `$ARGUMENTS`. Treat them as the PR title or as notes for the
description.

## 0. Preconditions

1. The work is done. If the conversation shows unfinished work, finish it first.
2. Run `git status` and `git branch --show-current`. If the current branch is
   `main`, create a branch with a short descriptive name before doing anything
   else.
3. Commit any uncommitted changes. Write a message that matches the style of
   `git log` and ends with the attribution line from the system reminder.
4. Run `make check`. Fix anything it reports and commit the fix. A PR that
   fails locally only wastes a CI run.

## 1. Open a draft PR

1. `git push -u origin HEAD`
2. Run `gh pr view` to see whether this branch already has a PR. If it does,
   reuse it. Mark it draft with `gh pr ready --undo` if it is open.
3. Otherwise run `gh pr create --draft --base main` with:
   - **Title:** a plain-language sentence stating what changed and why, in the
     style of recent titles (`git log --oneline -10`). Do not use a
     conventional-commit prefix.
   - **Body:** prose in American English, written to match recent PRs
     (`gh pr view <recent number>`). Cover what the change does, the reasoning a
     reviewer needs, what was deliberately left out, and the checks that were
     run. End with the attribution line from the system reminder. Pass it
     through a heredoc so the formatting survives.

Record the PR number. Every later step uses it.

## 2. Simplify

Invoke the `simplify` skill through the Skill tool. Once it finishes:

- If it changed files, run `make check`, fix anything it broke, then commit
  (`Simplify <area>` or similar) and push.
- If it changed nothing, continue.

## 3. Code review

Invoke the `code-review` skill through the Skill tool with `args: "high --fix"`.
Once it finishes:

- If it changed files, run `make check`, fix anything it broke, then commit
  (`Address review findings` or similar) and push.
- Findings it reported but did not fix are still your problem. Fix each one
  that holds up. Dismiss each one that does not, with a one-line reason that
  goes in the final summary. Do not drop findings silently.

If steps 2 or 3 changed what the PR does, or made a claim in the body untrue,
update the body with `gh pr edit <n> --body-file -`.

## 4. Mark ready

`gh pr ready <n>`

## 5. Wait for CI

Checks can take a few seconds to register after a push, and
`gh pr checks --watch` exits immediately when none exist yet. Run this with
`run_in_background: true`, since you are notified when it exits:

```bash
until gh pr checks <n> >/dev/null 2>&1 || [ $? -eq 8 ]; do sleep 10; done
gh pr checks <n> --watch --interval 30
```

Exit code 8 means checks are pending, which also means they have registered.
Do not poll while it runs. Wait for the notification.

## 6. If CI fails, fix it and go back to 5

1. Find the failing run with `gh pr checks <n>`, then read the failure with
   `gh run view <run-id> --log-failed`.
2. Reproduce it locally before changing anything. The same `make` target, or
   the exact command from `.github/workflows/ci.yml`, will usually do it.
   Backend tests need `make up` first, because they skip rather than fail when
   no database is reachable, and a skipped test would hide the failure.
3. Fix the root cause. Do not skip, delete, or loosen a test to make it pass.
   If the test itself is wrong, say so explicitly in the commit message and in
   the summary.
4. Run `make check`, commit, push, and go back to step 5.

If the failure is outside this PR's control (flaky infrastructure, an outage, a
missing secret), rerun it once with `gh run rerun <run-id> --failed`. If it
fails the same way again, stop and report.

**Stop after three fix rounds** that do not turn CI green. Report what is still
failing and what you tried. Leave the PR open. Do not merge.

## 7. Merge

When every check passes:

1. Run `gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision`. If the
   PR is not mergeable, stop and report why. For example, a required review may
   be missing, or a conflict with `main` may need resolving. Resolve conflicts
   by rebasing onto `origin/main`, then run `make check`, force-push with
   `--force-with-lease`, and go back to step 5.
2. Run `gh pr merge <n> --squash`. Never pass `--admin`. Do not pass
   `--delete-branch`, because inside a git worktree it tries to check out
   `main`, and that branch is already checked out in the main checkout.
3. Confirm the merge with `gh pr view <n> --json state,mergeCommit`.

## 8. Report

Keep it short:

- the PR link and its final state (merged, or open and why)
- what `/simplify` and `/code-review` changed, plus any findings dismissed and
  why
- any CI failures and how each was fixed
