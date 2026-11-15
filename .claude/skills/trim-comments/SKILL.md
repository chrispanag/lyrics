---
name: trim-comments
description: Scan source comments and trim the ones that are outdated, useless, or narrate history, benchmarks and tradeoffs the code already shows. Use when asked to trim, prune, tighten or clean up comments, or to cut comment noise in a file, directory, diff or the whole repo.
argument-hint: "[paths... | --diff]"
---

# Trim comments

Comments should be short and explain what the code cannot: why it is the way it
is, when that is non-obvious and will stay true. Everything else goes.

This overrides the "match the surrounding comment density" default: the
surrounding density is what is being reduced.

## Scope

- **Paths given** (files, directories, globs): only those.
- **`--diff`**: files changed on this branch, `git diff --name-only main...HEAD`
  plus uncommitted changes.
- **Nothing given**: every tracked source file
  (`git ls-files '*.go' '*.ts' '*.tsx' '*.mjs' '*.sql' '*.sh' Makefile '*.yaml' '*.yml'`).

Over ~15 files, split by directory and hand each batch to a parallel subagent
with this file's rubric and the instruction to edit comments only. Batches must
not share files.

Out of scope unless named explicitly: `CLAUDE.md`, `README.md`, other prose docs,
and generated files (`web/AGENTS.md`, `web/CLAUDE.md`, `next-env.d.ts`).

## Rubric

Classify every comment as **Keep**, **Shorten**, or **Delete**.

### Delete

1. **Outdated.** It names an identifier, file, test, route or flag that no longer
   exists, or describes behavior the code below does not have. Verify with `grep`
   before deciding; do not delete on suspicion. If the claim is wrong but the
   point still matters, rewrite it to be true instead.
2. **History.** "Used to", "was", "an earlier version", "the first fix", "now
   that", "since migration N", "replaced X", PR numbers, who found what. The
   code's past belongs in `git log`.
3. **Restating the code.** `// increment i`, a doc comment that repeats the
   function name (`// scanSong scans a song.`), a type described by its fields,
   section banners, "end of X".
4. **Inventories and counts that drift.** "Three places", "the four query keys",
   "both callers", lists of call sites. Point at the one authority instead, or
   drop it.
5. **Benchmarks and measurements.** "28px", "1.6 GB", "~910 rows", "several times
   over", timings. Keep a number only when it *is* the constraint (a limit, a
   protocol value) and is not already the constant's value.
6. **Tradeoff essays the code already answers.** Alternatives considered and
   rejected, "this is deliberate", "belt and suspenders", cost/benefit
   narration, when reading the code makes the chosen shape obvious.
7. **Commented-out code.**

### Shorten

A comment carrying one real point wrapped in paragraphs of narrative. Reduce it
to that point in one or two lines, present tense. Typical keepers after trimming:

- A silent-failure invariant: what breaks, invisibly, if this changes.
- A warning against a tempting "fix": `// Not similarity(): it decays as credits grow.`
- A mirror that must stay in step: `// Mirrors parseYouTubeURL (Go); change both.`
- An external quirk the code works around: `// Prelude's iss is the bare host, not https://.`
- A constraint the code cannot express: ordering, thread-safety, must-run-before.

If the full reasoning matters and is already in `CLAUDE.md`, the comment can be a
one-line pointer to that section.

### Keep untouched

- Tool directives: `//go:embed`, `//go:build`, `//nolint`, `// eslint-disable…`,
  `// @vitest-environment`, `/// <reference …>`, `// @ts-expect-error` (trim only
  the explanation after it), shebangs.
- License headers.
- Short comments that already pass the bar.
- Go doc comments on exported identifiers: shorten, but keep one line starting
  with the identifier's name.

### Target shape

```go
// Before
// buildSongFilters renders the filter clauses common to listing, searching, and
// counting. Each credit filter is an EXISTS subquery rather than a join: joining
// song_credits would multiply a song by its number of matching credits, and two
// credit filters would then intersect incorrectly.

// After
// buildSongFilters renders the WHERE clauses shared by list, search and count.
// Credit filters are EXISTS, not joins: a join multiplies rows and breaks AND.
```

When in doubt between Shorten and Delete, Shorten. When in doubt whether a claim
is still true, check; if you cannot tell, leave it and list it in the report.

## Procedure

1. Resolve the file list from the scope above.
2. For each file: read it whole, classify each comment, verify outdated claims
   with `grep`, then apply edits. **Change comments only** — never code,
   strings, or formatting of code lines, except the whitespace `gofmt`
   realigns once a trailing comment is gone.
3. Confirm only comments changed: review `git diff` and make sure every changed
   line is a comment line, a now-blank line left by a deleted comment (collapse
   duplicated blank lines), or a gofmt realignment.
4. Run `make lint` (gofmt, golangci-lint, go vet, tsc, eslint). Fix anything
   the edit caused, such as an unused `eslint-disable` or a missing directive.
5. Report:
   - Per file: comments deleted / shortened.
   - Comments left alone because truth could not be verified, with
     `file:line` and the doubt.
   - Do not commit unless asked.
