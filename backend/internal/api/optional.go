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
type optionalString struct {
	Set   bool
	Value *string
}

// UnmarshalJSON records that the field was present; it only runs when the key
// appears.
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

	// "" means clear, like null.
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
	// null is absent: the columns are NOT NULL, and unmarshalling null into a
	// bool would otherwise read as Set=true, Value=false.
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
