package api

import (
	"encoding/json"
	"strings"
)

// optionalString distinguishes the three states a JSON field can be in, which
// a plain *string cannot express:
//
//	{}                       -> Set=false          leave the value alone
//	{"field": null}          -> Set=true, Value=nil clear the value
//	{"field": "something"}   -> Set=true, Value=ptr set the value
//
// Without this, PATCH with an empty body would clear every omitted field —
// the caller says nothing and the server hears "erase it".
type optionalString struct {
	Set   bool
	Value *string
}

// UnmarshalJSON records that the field was present. It is only called when the
// key actually appears in the payload, which is what makes Set meaningful.
func (o *optionalString) UnmarshalJSON(data []byte) error {
	o.Set = true

	if string(data) == "null" {
		o.Value = nil
		return nil
	}

	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}

	// A field blanked in a form arrives as "" and means "clear it", which is
	// the same intent as null.
	if trimmed := strings.TrimSpace(s); trimmed != "" {
		o.Value = &trimmed
	} else {
		o.Value = nil
	}
	return nil
}

// There was an optionalInt here, and its one field was a song's release year.
// The year belongs to a recording now, and a recording is written whole — the
// collection idiom, where nil means absent and `[]` means "remove them all" —
// so no integer on a PATCH is nullable any more. Bring it back for the next one
// rather than reaching for a plain *int: the distinction it drew is real, and an
// explicit null has to be able to clear a value the schema allows to be NULL.

// optionalBool is the boolean counterpart of optionalString.
type optionalBool struct {
	Set   bool
	Value bool
}

func (o *optionalBool) UnmarshalJSON(data []byte) error {
	// Unmarshalling a JSON null into a bool is a documented no-op that returns
	// no error, so without this branch `{"is_public": null}` would arrive as
	// Set=true, Value=false and silently make a public list private. The
	// columns behind this type are NOT NULL, so a null carries nothing to
	// apply: treat it as absent, which is what the tri-state contract means by
	// "leave the value alone".
	if string(data) == "null" {
		return nil
	}
	o.Set = true
	return json.Unmarshal(data, &o.Value)
}

// ptr returns the value when set, and nil otherwise, for passing to store
// update structs that use nil to mean "unchanged".
func (o *optionalBool) ptr() *bool {
	if !o.Set {
		return nil
	}
	return &o.Value
}
