package api

import (
	"strings"
	"testing"

	"github.com/unitronix/betterdesk-server/db"
)

func TestGuacInstructionParserHandlesFragmentedInput(t *testing.T) {
	wire := encodeGuacInstruction(guacInstruction{
		opcode: "connect",
		args:   []string{"hostname", "password", "ą"},
	})
	parser := &guacInstructionParser{}
	var got []guacInstruction
	for _, part := range []string{string(wire[:3]), string(wire[3:])} {
		instructions, err := parser.Feed([]byte(part))
		if err != nil {
			t.Fatalf("Feed: %v", err)
		}
		got = append(got, instructions...)
	}
	if len(got) != 1 || got[0].opcode != "connect" {
		t.Fatalf("parsed instructions = %#v", got)
	}
	if strings.Join(got[0].args, "|") != "hostname|password|ą" {
		t.Fatalf("parsed args = %#v", got[0].args)
	}
}

func TestRewriteRemoteTargetConnectPinsServerValues(t *testing.T) {
	target := &db.RemoteTarget{
		Host:           "192.168.10.5",
		Port:           3389,
		Username:       "operator",
		CredentialMode: "saved",
	}
	values := rewriteRemoteTargetConnect(
		[]string{"browser-host", "1", "browser-user", "browser-password", "true"},
		[]string{"hostname", "port", "username", "password", "ignore-cert"},
		target,
		"secret",
	)
	want := []string{"192.168.10.5", "3389", "operator", "secret", "false"}
	for index := range want {
		if values[index] != want[index] {
			t.Fatalf("value %d = %q, want %q", index, values[index], want[index])
		}
	}
}

func TestResolveRemoteTargetHostBlocksMetadataAndLoopback(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "::1", "169.254.169.254", "localhost"} {
		if _, err := resolveRemoteTargetHost(host); err == nil {
			t.Fatalf("host %q was not blocked", host)
		}
	}
}
