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

// optionalBool is the boolean counterpart of optionalString.
type optionalBool struct {
	Set   bool
	Value bool
}

func (o *optionalBool) UnmarshalJSON(data []byte) error {
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
