// Package migrations carries the schema history and hands it to the binaries
// that apply it.
//
// The SQL is embedded rather than read from disk because the migration command
// ships as a single static binary in an image that holds no copy of the
// repository. `go:embed` cannot reach outside its own directory, which is why
// this file sits beside the SQL instead of under cmd/.
//
// The tests keep reading the same files from disk (see internal/testutil): they
// have the repository right there, and going through the filesystem is what
// makes a migration edit take effect without a rebuild.
package migrations

import (
	"embed"
	"io/fs"
)

// files holds every .sql file in this directory.
//
// seed.sql is embedded along with the numbered migrations and then ignored:
// golang-migrate's iofs source skips any name that does not parse as
// `<version>_<title>.<up|down>.sql`. Listing the migrations individually would
// mean this pattern needs editing every time one is added, which is exactly the
// step that gets forgotten.
//
//go:embed *.sql
var files embed.FS

// FS returns the embedded migrations for golang-migrate's iofs source.
func FS() fs.FS { return files }
