package store

import (
	"strconv"
	"strings"
	"unicode"
)

// BuildTSQuery turns raw user input into a tsquery expression: each term a
// quoted lexeme with `:*`, joined by `&`. Quoting makes the tsquery operators
// inert without stripping characters. Every term gets `:*` because the index is
// unstemmed and prefix matching is the only recall for Greek inflection.
//
// Returns "" when no term is usable, which callers treat as "no full-text
// component"; an empty quoted lexeme would be a syntax error in to_tsquery.
func BuildTSQuery(raw string) string {
	fields := strings.FieldsFunc(raw, unicode.IsSpace)

	terms := make([]string, 0, len(fields))
	for _, field := range fields {
		// A term of only punctuation yields no lexemes. Postgres tolerates that
		// with a notice, but there is no reason to send it.
		if !hasSearchableRune(field) {
			continue
		}
		terms = append(terms, "'"+escapeLexeme(field)+"':*")
	}

	return strings.Join(terms, " & ")
}

// escapeLexeme makes a raw term safe inside a quoted tsquery lexeme by doubling
// `'` (ends the lexeme) and `\` (tsquery's escape; a trailing one swallows the
// closing quote and to_tsquery raises an unclassified 500 on a public route).
func escapeLexeme(term string) string {
	// Backslashes first: doubling quotes introduces no backslashes, but doubling
	// backslashes after the quotes would leave the added ones unescaped.
	term = strings.ReplaceAll(term, `\`, `\\`)
	return strings.ReplaceAll(term, "'", "''")
}

// likeEscape is the ESCAPE character every LIKE in this package pairs with
// escapeLike.
const likeEscape = `\`

// escapeLike neutralizes the LIKE wildcards in user input, so `%` and `_`
// match literally. Not an injection guard; the pattern is still bound.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
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

// weightArray is ts_rank_cd's {D,C,B,A} vector for the setweight labels in
// migration 000003. The float4[] cast is required: ts_rank_cd has no overload
// for an untyped array literal.
const weightArray = `'{0.1,0.3,0.6,1.0}'::float4[]`

// The score blends full-text rank (exact) with trigram similarity (tolerant of
// misspelling); text rank leads so an exact match beats an approximate one.
const (
	textRankWeight = 0.65
	trgmWeight     = 0.35
)

// wordSimilarityThreshold is the cutoff for a fuzzy match. word_similarity, not
// similarity: the latter decays as a song gains credits. Below Postgres's 0.6
// default so a one-letter Greek misspelling still matches.
const wordSimilarityThreshold = 0.45

// Snippet highlight delimiters. Never `<b>`: ts_headline returns lyrics
// verbatim, so HTML delimiters would make them a stored XSS vector. The client
// splits on these sentinels and builds elements itself.
const (
	SnippetStartSel = "⟦" // ⟦
	SnippetStopSel  = "⟧" // ⟧
)

// headlineOptions configures ts_headline. Two short fragments read better on a
// phone than one long one.
const headlineOptions = "StartSel=" + SnippetStartSel + ",StopSel=" + SnippetStopSel +
	",MaxFragments=2,MinWords=4,MaxWords=16,FragmentDelimiter= … "
