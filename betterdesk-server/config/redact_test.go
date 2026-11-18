package config

import (
	"strings"
	"testing"
)

// GHSA-qxwx-jg77-5v67: the startup banner used to print the raw DBPath, which
// leaked the PostgreSQL password into container logs on every start.
func TestRedactedDBPathHidesPassword(t *testing.T) {
	cases := []struct {
		name       string
		dsn        string
		wantSecret string // must NOT appear in the result
		mustKeep   []string
	}{
		{
			name:       "postgres dsn with password",
			dsn:        "postgres://bdesk:S3cr3tP@ss@postgres:5432/betterdesk?sslmode=disable",
			wantSecret: "S3cr3tP@ss",
			mustKeep:   []string{"postgres://", "bdesk", "postgres:", "5432", "betterdesk", "sslmode=disable"},
		},
		{
			name:       "postgres dsn without password",
			dsn:        "postgres://bdesk@db:5432/betterdesk",
			wantSecret: "",
			mustKeep:   []string{"bdesk", "db", "5432"},
		},
		{
			name:       "password in query string",
			dsn:        "postgres://bdesk@db:5432/betterdesk?password=Hunter2",
			wantSecret: "Hunter2",
			mustKeep:   []string{"bdesk", "betterdesk"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := RedactedDBPath(tc.dsn)
			if tc.wantSecret != "" && strings.Contains(got, tc.wantSecret) {
				t.Fatalf("redacted DSN still contains the password: %q", got)
			}
			for _, keep := range tc.mustKeep {
				if !strings.Contains(got, keep) {
					t.Errorf("redacted DSN lost %q: %q", keep, got)
				}
			}
		})
	}
}

func TestRedactedDBPathLeavesSQLitePathsAlone(t *testing.T) {
	for _, path := range []string{
		"db_v2.sqlite3",
		"/var/lib/betterdesk/db_v2.sqlite3",
		"data/auth.db",
	} {
		if got := RedactedDBPath(path); got != path {
			t.Errorf("filesystem path should be unchanged: got %q, want %q", got, path)
		}
	}
	if got := RedactedDBPath(""); got != "" {
		t.Errorf("empty DSN should stay empty, got %q", got)
	}
}

func TestRedactedDBPathNeverEchoesUnparseableInput(t *testing.T) {
	// A DSN we cannot parse might still hold a secret; do not echo it back.
	got := RedactedDBPath("postgres://user:secret@[::1:5432/bad")
	if strings.Contains(got, "secret") {
		t.Fatalf("unparseable DSN leaked its secret: %q", got)
	}
}
