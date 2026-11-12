package api

import "testing"

func TestNormalizeStrategyOptionValue(t *testing.T) {
	tests := []struct {
		name string
		in   any
		want string
		ok   bool
	}{
		{name: "enabled bool", in: true, want: "Y", ok: true},
		{name: "disabled bool", in: false, want: "N", ok: true},
		{name: "lowercase enabled", in: "y", want: "Y", ok: true},
		{name: "invalid", in: "maybe", ok: false},
	}
	for _, test := range tests {
		got, ok := normalizeStrategyOptionValue(test.in)
		if got != test.want || ok != test.ok {
			t.Fatalf("%s: got (%q, %v), want (%q, %v)", test.name, got, ok, test.want, test.ok)
		}
	}
}

func TestMergeRustDeskStrategyOptionsPreservesBrandingLocks(t *testing.T) {
	got := mergeRustDeskStrategyOptions(
		map[string]string{"display-name": "Acme", "enable-file-transfer": "N"},
		map[string]string{"display-name": "Override", "enable-file-transfer": "Y", "enable-audio": "N"},
	)
	if got["display-name"] != "Acme" {
		t.Fatalf("branding display name was overwritten: %#v", got)
	}
	if got["enable-file-transfer"] != "N" {
		t.Fatalf("branding lock was weakened: %#v", got)
	}
	if got["enable-audio"] != "N" {
		t.Fatalf("strategy option was not merged: %#v", got)
	}
}
