package db

import (
	"regexp"
	"strings"
)

// usernamePattern is the account-name format accepted everywhere in the product.
// It matches the console's client-side check (`^[a-zA-Z0-9_]{3,32}$` plus the
// wider set allowed for imported identities) and never permits whitespace, path
// separators or control characters — a username ends up in filesystem paths,
// audit log lines and address-book keys.
var usernamePattern = regexp.MustCompile(`^[A-Za-z0-9_.@-]{3,64}$`)

// ValidUsername reports whether name is an acceptable account name.
func ValidUsername(name string) bool {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || trimmed != name {
		return false
	}
	return usernamePattern.MatchString(trimmed)
}

// isUniqueViolation reports whether err is a uniqueness conflict from either
// backend. SQLite says "UNIQUE constraint failed"; PostgreSQL says
// "duplicate key value violates unique constraint".
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint failed") ||
		strings.Contains(msg, "duplicate key value violates unique constraint") ||
		strings.Contains(msg, "sqlite_constraint_unique")
}

// isMissingTable reports whether err is "no such table" / "does not exist".
// Older databases predate some tables, and a rename must not fail because an
// optional table was never created.
func isMissingTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table") ||
		strings.Contains(msg, "does not exist")
}
