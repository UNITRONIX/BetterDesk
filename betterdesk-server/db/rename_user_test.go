package db

import (
	"errors"
	"testing"
)

// Issue #498 (2026-11-13): renaming a user must cascade to every table that
// keys on the username, in one transaction, and must refuse collisions.
func TestRenameUserCascadesAddressBookAndAssignments(t *testing.T) {
	database := newTestDB(t)
	defer database.Close()

	user := &User{Username: "oldadmin", PasswordHash: "x", Role: "admin"}
	if err := database.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	if err := database.SaveAddressBook("oldadmin", "legacy", `{"peers":["1"]}`); err != nil {
		t.Fatalf("SaveAddressBook: %v", err)
	}

	if err := database.RenameUser(user.ID, "newadmin"); err != nil {
		t.Fatalf("RenameUser: %v", err)
	}

	renamed, err := database.GetUserByID(user.ID)
	if err != nil || renamed == nil {
		t.Fatalf("GetUserByID: %v %+v", err, renamed)
	}
	if renamed.Username != "newadmin" {
		t.Fatalf("username = %q, want newadmin", renamed.Username)
	}

	if old, err := database.GetUser("oldadmin"); err != nil {
		t.Fatalf("GetUser(old): %v", err)
	} else if old != nil {
		t.Fatalf("old username still resolves: %+v", old)
	}

	book, err := database.GetAddressBook("newadmin", "legacy")
	if err != nil {
		t.Fatalf("GetAddressBook: %v", err)
	}
	if book == "" {
		t.Fatal("address book did not follow the rename")
	}
	if stale, err := database.GetAddressBook("oldadmin", "legacy"); err != nil {
		t.Fatalf("GetAddressBook(old): %v", err)
	} else if stale != "{}" {
		t.Fatalf("address book left under the old name: %q", stale)
	}
}

func TestRenameUserRejectsCollision(t *testing.T) {
	database := newTestDB(t)
	defer database.Close()

	first := &User{Username: "alice", PasswordHash: "x", Role: "admin"}
	second := &User{Username: "bob", PasswordHash: "x", Role: "viewer"}
	if err := database.CreateUser(first); err != nil {
		t.Fatalf("CreateUser alice: %v", err)
	}
	if err := database.CreateUser(second); err != nil {
		t.Fatalf("CreateUser bob: %v", err)
	}

	err := database.RenameUser(first.ID, "bob")
	if !errors.Is(err, ErrUsernameTaken) {
		t.Fatalf("RenameUser collision err = %v, want ErrUsernameTaken", err)
	}

	if still, _ := database.GetUser("alice"); still == nil {
		t.Fatal("alice must be unchanged after a refused rename")
	}
}

func TestRenameUserRejectsInvalidName(t *testing.T) {
	database := newTestDB(t)
	defer database.Close()

	user := &User{Username: "carol", PasswordHash: "x", Role: "admin"}
	if err := database.CreateUser(user); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	for _, bad := range []string{"", "  ", "a", "has space", "../etc", "x/y", "a&b"} {
		if err := database.RenameUser(user.ID, bad); !errors.Is(err, ErrInvalidUsername) {
			t.Errorf("RenameUser(%q) err = %v, want ErrInvalidUsername", bad, err)
		}
	}
}

func TestRenameUserMissingUser(t *testing.T) {
	database := newTestDB(t)
	defer database.Close()

	if err := database.RenameUser(9999, "ghost"); !errors.Is(err, ErrPeerNotFound) {
		t.Fatalf("RenameUser missing err = %v, want ErrPeerNotFound", err)
	}
}

func TestValidUsername(t *testing.T) {
	for _, ok := range []string{"admin", "ops.admin", "ops_admin", "ops-admin", "ops@example"} {
		if !ValidUsername(ok) {
			t.Errorf("ValidUsername(%q) = false, want true", ok)
		}
	}
	for _, bad := range []string{"", "ab", "a b", "a/b", "../x", "a&b", "a\nb"} {
		if ValidUsername(bad) {
			t.Errorf("ValidUsername(%q) = true, want false", bad)
		}
	}
}
