package store

import (
	"strconv"
	"strings"
	"unicode"
)

// BuildTSQuery turns raw user input into a tsquery expression.
//
// Every term is emitted as a *quoted* lexeme with a `:*` prefix marker, joined
// with `&`. Quoting is what makes this safe: inside single quotes the tsquery
// operators (`&`, `|`, `!`, `(`, `)`, `<->`) are inert, so input like
// `a&b|c!d` parses as an ordinary phrase instead of an operator expression.
// That removes the need to strip characters, which in turn avoids mangling
// legitimate content — "don't" and "rock-n-roll" survive intact and degrade
// into phrase queries, which is exactly what a user searching those means.
//
// Prefix matching is applied to *every* term, not just the last. The index is
// deliberately unstemmed (the corpus mixes Greek and English, and each
// language's stemmer mangles the other), so prefix matching is the only recall
// mechanism available for an inflected language: without it, a search for
// "θαλασσα" would miss the lyric "θάλασσας".
//
// Returns "" when the input contains no usable term. Callers must treat that as
// "no full-text component" — an empty tsquery matches nothing, which is the
// correct degradation, whereas emitting an empty quoted lexeme is a hard
// syntax error in to_tsquery.
func BuildTSQuery(raw string) string {
	fields := strings.FieldsFunc(raw, unicode.IsSpace)

	terms := make([]string, 0, len(fields))
	for _, field := range fields {
		// A term of only punctuation yields no lexemes. Postgres tolerates that
		// with a notice, but there is no reason to send it.
		if !hasSearchableRune(field) {
			continue
		}
		// Doubling is the SQL string-literal escape, applied here to the inner
		// tsquery literal rather than to the outer statement (which is
		// parameterized).
		terms = append(terms, "'"+strings.ReplaceAll(field, "'", "''")+"':*")
	}

	return strings.Join(terms, " & ")
}

// hasSearchableRune reports whether a term contains anything the text search
// parser could turn into a lexeme.
func hasSearchableRune(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

// args accumulates positional query parameters and hands back the `$N`
// placeholder for each, so filter fragments can be assembled in any order
// without hand-counting indexes.
type args struct {
	values []any
}

func (a *args) next(v any) string {
	a.values = append(a.values, v)
	return "$" + strconv.Itoa(len(a.values))
}

// Relevance weighting.
//
// weightArray is ts_rank_cd's {D,C,B,A} vector, matching the setweight labels
// applied in migration 000003: a title hit (A) counts ten times a lyrics-body
// hit (D). The float4[] cast is required — ts_rank_cd has no overload that
// accepts an untyped array literal.
const weightArray = `'{0.1,0.3,0.6,1.0}'::float4[]`

// Full-text rank and trigram similarity measure different things — one is exact
// per token, the other is tolerant of misspelling — so the final score blends
// them rather than picking one. Text rank leads because an exact match should
// always beat an approximate one.
const (
	textRankWeight = 0.65
	trgmWeight     = 0.35
)

// wordSimilarityThreshold is the cutoff for a fuzzy match.
//
// The comparison is `word_similarity`, not `similarity`, and the difference is
// not cosmetic. `similarity` compares the query against the *whole* target, so
// matching "Θεοδορακης" against a credits field also containing three other
// names scores it against all of them at once — the score falls as a song
// gains credits, and fuzzy search stops working on exactly the best-documented
// songs. `word_similarity` scores the query against the best-matching run of
// words inside the target instead, which is stable regardless of how much else
// is in the field.
//
// Postgres defaults this to 0.6. That is too strict here: a Greek name
// misspelled by one letter and stripped of accents lands near 0.57, which is
// precisely the case fuzzy matching exists to catch.
const wordSimilarityThreshold = 0.45

// Snippet highlight delimiters.
//
// ts_headline does NOT escape the text it is given — it returns the source
// verbatim with the delimiters inserted. Using the default `<b>`/`</b>` would
// therefore mean handing the client a string that mixes our markup with
// whatever HTML happens to sit in the lyrics, and any client rendering it as
// HTML would execute it. Lyrics are user-submitted, so that is a stored XSS
// vector.
//
// These sentinels are not markup, so the client splits on them and builds
// elements itself, and injection is structurally impossible rather than
// merely filtered. If the characters ever did appear in real lyrics the worst
// case is a spurious highlight.
const (
	SnippetStartSel = "⟦" // ⟦
	SnippetStopSel  = "⟧" // ⟧
)

// headlineOptions configures ts_headline. Two short fragments read better on a
// phone than one long one.
const headlineOptions = "StartSel=" + SnippetStartSel + ",StopSel=" + SnippetStopSel +
	",MaxFragments=2,MinWords=4,MaxWords=16,FragmentDelimiter= … "
