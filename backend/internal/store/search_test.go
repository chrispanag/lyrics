package store

import "testing"

func TestBuildTSQuery(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"empty", "", ""},
		{"whitespace only", "   \t\n ", ""},
		{"single term", "θαλασσα", `'θαλασσα':*`},
		{"two terms", "αγαπη μου", `'αγαπη':* & 'μου':*`},
		{"collapses repeated spaces", "a    b", `'a':* & 'b':*`},
		{"keeps accents for the SQL side to normalize", "Θάλασσα", `'Θάλασσα':*`},

		// Quoting, not stripping, is what neutralizes the operators — the
		// characters survive into the lexeme and are parsed as ordinary text.
		{"tsquery operators are inert", "a&b|c!d", `'a&b|c!d':*`},
		{"parentheses are inert", "(a)", `'(a)':*`},
		{"phrase operator is inert", "a<->b", `'a<->b':*`},

		// A single quote would terminate the lexeme and let the rest of the
		// string be parsed as tsquery syntax, so it must be doubled.
		{"single quote is escaped", "don't", `'don''t':*`},
		// The bare `|` is dropped as an unusable term, so the surviving lexemes
		// carry their quotes escaped and the operator never reaches the parser.
		{"quote injection attempt", `x' | 'y`, `'x''':* & '''y':*`},

		// Terms that can never yield a lexeme are dropped: emitting `'':*`
		// is a hard syntax error in to_tsquery.
		{"punctuation-only term dropped", "αγαπη ...", `'αγαπη':*`},
		{"all terms unusable", "... ---", ""},

		{"digits are searchable", "1960", `'1960':*`},
		{"mixed scripts", "rock ρεμπετικο", `'rock':* & 'ρεμπετικο':*`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := BuildTSQuery(tt.input); got != tt.want {
				t.Errorf("BuildTSQuery(%q)\n got: %q\nwant: %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSlugify(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{"ascii", "Rock", "rock"},
		{"spaces become dashes", "Classic Rock", "classic-rock"},
		{"accents folded", "Café Music", "cafe-music"},
		{"punctuation collapses", "Rock & Roll!", "rock-roll"},
		{"leading and trailing trimmed", "  --Rock--  ", "rock"},

		// Without transliteration these would slugify to "", making it
		// impossible to create a Greek-named genre at all.
		{"greek transliterated", "Έντεχνο", "entechno"},
		{"greek two words", "Λαϊκό Τραγούδι", "laiko-tragoydi"},
		{"greek final sigma", "Ρεμπέτικος", "rempetikos"},

		{"mixed scripts", "Greek Ρεμπέτικο", "greek-rempetiko"},
		{"digits preserved", "Rock 1960", "rock-1960"},
		{"no usable characters", "!!!", ""},
		{"empty", "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := Slugify(tt.input); got != tt.want {
				t.Errorf("Slugify(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestRoleAtLeast(t *testing.T) {
	tests := []struct {
		have Role
		want Role
		ok   bool
	}{
		{RoleAdmin, RoleAdmin, true},
		{RoleAdmin, RoleContributor, true},
		{RoleAdmin, RoleUser, true},
		{RoleContributor, RoleContributor, true},
		{RoleContributor, RoleUser, true},
		{RoleContributor, RoleAdmin, false},
		{RoleUser, RoleUser, true},
		{RoleUser, RoleContributor, false},
		{RoleUser, RoleAdmin, false},

		// An unset or bogus role must fail closed, including against itself.
		{"", RoleUser, false},
		{"", "", false},
		{"superuser", RoleUser, false},
	}

	for _, tt := range tests {
		if got := tt.have.AtLeast(tt.want); got != tt.ok {
			t.Errorf("Role(%q).AtLeast(%q) = %v, want %v", tt.have, tt.want, got, tt.ok)
		}
	}
}
