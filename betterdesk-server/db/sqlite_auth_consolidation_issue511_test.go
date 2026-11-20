package db

// Regression coverage for issue #511: -migrate-sqlite-auth failed on real
// legacy installs while -migrate-sqlite-auth-dry-run reported success.
//
// The four defects covered here:
//  1. a shared account with the same password in a different hash format
//     (bcrypt in the console, pbkdf2 in the server) aborted as a "credential
//     conflict";
//  2. tables were created and filled in one alphabetical pass, so a child table
//     hit a foreign key on a parent that did not exist yet;
//  3. users went through the generic column comparison after ensureUserColumns
//     added profile columns, so any non-empty profile field looked like a
//     conflict - and console-only accounts could be lost;
//  4. the dry run never exercised the real path, so it passed for migrations
//     that could not succeed.

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func seedTargetDB(t *testing.T, target string) {
	t.Helper()
	targetDB, err := OpenSQLite(target)
	if err != nil {
		t.Fatal(err)
	}
	if err := targetDB.Migrate(); err != nil {
		t.Fatal(err)
	}
	if err := targetDB.Close(); err != nil {
		t.Fatal(err)
	}
}

func writeLegacyDB(t *testing.T, legacy, ddl string) {
	t.Helper()
	db, err := sql.Open("sqlite", legacy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ddl); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
}

// 1. Only the hash format differs: fail by default, proceed with the flag.
func TestConsolidateSQLiteAuthHashFormatNeedsExplicitOptIn(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	targetDB, err := OpenSQLite(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := targetDB.db.Exec(
		`INSERT INTO users (id, username, password_hash, role, totp_secret, totp_enabled)
		 VALUES (1, 'admin', '$2b$12$consolesaltconsolehashvalue', 'admin', 'SECRETSEED', 1)`); err != nil {
		t.Fatal(err)
	}
	targetDB.Close()

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role, totp_secret, totp_enabled)
			VALUES (1, 'admin', 'pbkdf2-sha256$600000$legacyhashvalue', 'admin', 'SECRETSEED', 1);
	`)

	// Without the flag the migration must still fail loudly.
	_, err = ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
	})
	if err == nil {
		t.Fatal("expected a hash-format conflict to abort without the opt-in flag")
	}
	if !strings.Contains(err.Error(), "prefer-target-credentials") {
		t.Fatalf("error should name the opt-in flag, got: %v", err)
	}
	// Neither hash may leak into the error text.
	if strings.Contains(err.Error(), "consolesaltconsolehashvalue") ||
		strings.Contains(err.Error(), "legacyhashvalue") {
		t.Fatalf("error leaked hash material: %v", err)
	}

	// With the flag the target hash is kept and the account is reported.
	report, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
		PreferTargetCredentials: true,
		Now:                     func() time.Time { return time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatalf("opt-in migration failed: %v", err)
	}
	if len(report.Warnings) == 0 {
		t.Fatal("expected an audit warning naming the resolved account")
	}
	if !strings.Contains(strings.Join(report.Warnings, " "), "admin") {
		t.Fatalf("warning should name the account: %v", report.Warnings)
	}

	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var hash string
	if err := check.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$2b$") {
		t.Fatalf("target hash should win, got %q", hash)
	}
}

// 2. A child table that sorts before its parent must still copy.
func TestConsolidateSQLiteAuthCreatesParentsBeforeChildren(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	// alert_history < alert_rules alphabetically, and it references alert_rules.
	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role) VALUES (5, 'operator', 'hash', 'operator');
		CREATE TABLE alert_rules (
			id INTEGER PRIMARY KEY, name TEXT NOT NULL
		);
		CREATE TABLE alert_history (
			id INTEGER PRIMARY KEY, rule_id INTEGER NOT NULL,
			FOREIGN KEY (rule_id) REFERENCES alert_rules(id)
		);
		INSERT INTO alert_history (id, rule_id) VALUES (1, 1);
	`)
	// The parent row must exist for the FK to be satisfied.
	db, err := sql.Open("sqlite", legacy)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO alert_rules (id, name) VALUES (1, 'disk full')`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	db.Close()

	if _, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
	}); err != nil {
		t.Fatalf("child-before-parent ordering must not fail: %v", err)
	}

	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var count int
	if err := check.QueryRow(`SELECT COUNT(*) FROM alert_history`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("alert_history rows = %d, want 1", count)
	}
}

// 3. A shared account with a populated console profile field must merge, and
// an account that exists only in the console must not be lost.
func TestConsolidateSQLiteAuthMergesProfileFieldsAndKeepsConsoleOnlyUsers(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	targetDB, err := OpenSQLite(target)
	if err != nil {
		t.Fatal(err)
	}
	// Same id and hash on both sides. The console's profile columns exist only
	// in the legacy database; ensureUserColumns adds them to the target as part
	// of the migration, which is exactly what used to make the generic copy
	// report a "conflicting row".
	if _, err := targetDB.db.Exec(`
		INSERT INTO users (id, username, password_hash, role)
		VALUES (1, 'admin', 'shared-hash', 'admin');
		INSERT INTO users (id, username, password_hash, role)
		VALUES (9, 'console-only', 'console-hash', 'viewer')`); err != nil {
		t.Fatal(err)
	}
	targetDB.Close()

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0,
			preferred_language TEXT DEFAULT '', email TEXT DEFAULT ''
		);
		INSERT INTO users (id, username, password_hash, role, preferred_language, email)
			VALUES (1, 'admin', 'shared-hash', 'admin', 'en', 'admin@example.test');
	`)

	if _, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
	}); err != nil {
		t.Fatalf("populated profile columns must not look like a conflict: %v", err)
	}

	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()

	var language, email string
	if err := check.QueryRow(
		`SELECT preferred_language, email FROM users WHERE username='admin'`).Scan(&language, &email); err != nil {
		t.Fatal(err)
	}
	if language != "en" || email != "admin@example.test" {
		t.Fatalf("profile fields were not preserved: lang=%q email=%q", language, email)
	}

	var count int
	if err := check.QueryRow(
		`SELECT COUNT(*) FROM users WHERE username='console-only'`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("console-only account was dropped by the migration")
	}
}

// A legacy user missing from the target must be inserted by the merge.
func TestConsolidateSQLiteAuthInsertsLegacyOnlyUsers(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role) VALUES (4, 'legacy-only', 'legacy-hash', 'operator');
	`)

	report, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsString(report.TablesCopied, "users") {
		t.Fatalf("users should be reported as merged: %v", report.TablesCopied)
	}

	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var role string
	if err := check.QueryRow(`SELECT role FROM users WHERE username='legacy-only'`).Scan(&role); err != nil {
		t.Fatalf("legacy-only account was not inserted: %v", err)
	}
	if role != "operator" {
		t.Fatalf("role = %q", role)
	}
}

// 4. The dry run must fail where the real run fails.
func TestConsolidateSQLiteAuthDryRunExercisesRealPath(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	targetDB, err := OpenSQLite(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := targetDB.db.Exec(
		`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'go-hash', 'admin')`); err != nil {
		t.Fatal(err)
	}
	targetDB.Close()

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'console-hash', 'viewer');
	`)

	// A role conflict cannot be resolved by any flag, so the dry run has to
	// report it instead of claiming success.
	if _, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, DryRun: true,
	}); err == nil {
		t.Fatal("dry run must fail for a migration that the real run rejects")
	}

	// The dry run must not have touched either database.
	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var hash string
	if err := check.QueryRow(`SELECT password_hash FROM users WHERE username='admin'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash != "go-hash" {
		t.Fatalf("dry run modified the target: %q", hash)
	}
	if consolidated, err := SQLiteAuthConsolidated(target); err != nil || consolidated {
		t.Fatalf("dry run marked the target consolidated (err=%v)", err)
	}
}

// A successful dry run must report the tables it would copy.
func TestConsolidateSQLiteAuthDryRunSucceedsForValidInput(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role) VALUES (3, 'alice', 'hash', 'operator');
	`)

	report, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, DryRun: true,
	})
	if err != nil {
		t.Fatalf("valid dry run failed: %v", err)
	}
	if !report.DryRun {
		t.Fatal("report should be flagged as a dry run")
	}
	if !containsString(report.TablesCopied, "users") {
		t.Fatalf("dry run should report the users merge: %v", report.TablesCopied)
	}
}

// A long-running install can already carry foreign key violations (orphaned
// audit_log rows after a user is deleted). Requiring a pristine database would
// abort a migration that is otherwise correct, which is the #511 failure mode.
func TestConsolidateSQLiteAuthToleratesPreexistingForeignKeyViolations(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "db_v2.sqlite3")
	legacy := filepath.Join(dir, "auth.db")
	seedTargetDB(t, target)

	// Simulate an aged database: an audit row whose user no longer exists.
	// Writes go through the raw handle with enforcement off, the same way such
	// rows appear in practice (a user is deleted and its audit trail stays).
	targetDB, err := OpenSQLite(target)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := targetDB.db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER REFERENCES users(id),
			action TEXT NOT NULL DEFAULT '',
			created_at TEXT DEFAULT (datetime('now'))
		);`); err != nil {
		t.Fatal(err)
	}
	if _, err := targetDB.db.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	if _, err := targetDB.db.Exec(
		`INSERT INTO audit_log (user_id, action) VALUES (424242, 'login')`); err != nil {
		t.Fatal(err)
	}
	targetDB.Close()

	writeLegacyDB(t, legacy, `
		CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
			role TEXT NOT NULL, totp_secret TEXT DEFAULT '', totp_enabled INTEGER DEFAULT 0
		);
		INSERT INTO users (id, username, password_hash, role) VALUES (2, 'newbie', 'hash', 'viewer');
	`)

	report, err := ConsolidateSQLiteAuth(SQLiteAuthConsolidationOptions{
		DBPath: target, AuthDBPath: legacy, BackupDir: filepath.Join(dir, "backups"),
	})
	if err != nil {
		t.Fatalf("pre-existing foreign key violations must not block the merge: %v", err)
	}

	check, err := sql.Open("sqlite", target)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()
	var users int
	if err := check.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("users = %d, want the single legacy account merged in", users)
	}
	var role string
	if err := check.QueryRow(`SELECT role FROM users WHERE username='newbie'`).Scan(&role); err != nil {
		t.Fatalf("legacy account missing: %v", err)
	}
	if role != "viewer" {
		t.Fatalf("role = %q", role)
	}
	if !containsString(report.TablesCopied, "users") {
		t.Fatalf("users should be reported as merged: %v", report.TablesCopied)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
