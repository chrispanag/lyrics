// Package migrations embeds the schema history for cmd/migrate.
//
// It sits beside the SQL because go:embed cannot reach outside its directory.
// Tests read the same files from disk (internal/testutil), so SQL edits apply
// without a rebuild.
package migrations

import (
	"embed"
	"io/fs"
)

// files holds every .sql file here. iofs skips seed.sql, whose name does not
// parse as `<version>_<title>.<up|down>.sql`.
//
//go:embed *.sql
var files embed.FS

// FS returns the embedded migrations for golang-migrate's iofs source.
func FS() fs.FS { return files }
