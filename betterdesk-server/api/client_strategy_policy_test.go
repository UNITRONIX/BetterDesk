package api

import (
	"encoding/json"
	"testing"
)

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

// RustDesk 1.5.3+ ignores these keys in heartbeat strategy updates (#16696).
// BetterDesk must not treat them as deployable via rustDeskStrategyOptionKeys.
func TestRustDeskStrategyOptionKeysExcludeLockedEndpointKeys(t *testing.T) {
	locked := []string{
		"api-server",
		"custom-rendezvous-server",
		"relay-server",
		"key",
		"2fa",
		"bot",
		"enable-trusted-devices",
		"trusted-device-expiration-days",
		"websocket-port",
	}
	for _, key := range locked {
		if _, ok := rustDeskStrategyOptionKeys[key]; ok {
			t.Fatalf("locked 1.5.3 strategy key %q must not be in rustDeskStrategyOptionKeys", key)
		}
	}
}

func TestNormalizeRustDeskStrategyPermissionsDropsLockedKeys(t *testing.T) {
	got, err := normalizeRustDeskStrategyPermissions(json.RawMessage(`{
		"enable-audio": true,
		"relay-server": "relay.example.com:21117",
		"api-server": "https://api.example.com",
		"unknown": "Y"
	}`))
	if err != nil {
		t.Fatalf("normalize strategy permissions: %v", err)
	}
	var permissions map[string]string
	if err := json.Unmarshal([]byte(got), &permissions); err != nil {
		t.Fatalf("decode normalized permissions: %v", err)
	}
	if permissions["enable-audio"] != "Y" {
		t.Fatalf("allowed option was not preserved: %#v", permissions)
	}
	for _, key := range []string{"relay-server", "api-server", "unknown"} {
		if _, ok := permissions[key]; ok {
			t.Fatalf("disallowed option %q was persisted: %#v", key, permissions)
		}
	}
}
