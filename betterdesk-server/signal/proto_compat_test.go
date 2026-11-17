package signal

import (
	"testing"

	pb "github.com/unitronix/betterdesk-server/proto"
	"google.golang.org/protobuf/proto"
)

func TestRustDesk15RelayFieldsRoundTrip(t *testing.T) {
	in := &pb.RequestRelay{
		Id:         "TARGET",
		Uuid:       "relay-uuid",
		SwitchCode: "switch-code",
		ControlledContext: &pb.ControlledContext{
			ConnAuditRef: "audit-ref",
		},
		ControlPermissions: &pb.ControlPermissions{
			Permissions: 1 << 12,
		},
	}

	data, err := proto.Marshal(in)
	if err != nil {
		t.Fatalf("marshal RequestRelay: %v", err)
	}
	var out pb.RequestRelay
	if err := proto.Unmarshal(data, &out); err != nil {
		t.Fatalf("unmarshal RequestRelay: %v", err)
	}
	if out.SwitchCode != in.SwitchCode {
		t.Fatalf("switch_code = %q, want %q", out.SwitchCode, in.SwitchCode)
	}
	if out.ControlledContext == nil || out.ControlledContext.ConnAuditRef != "audit-ref" {
		t.Fatalf("controlled_context was not preserved: %#v", out.ControlledContext)
	}
	if out.ControlPermissions == nil || out.ControlPermissions.Permissions != 1<<12 {
		t.Fatalf("privacy_mode permission bit was not preserved: %#v", out.ControlPermissions)
	}
	if pb.RegisterPkResponse_NOT_DEPLOYED != 8 {
		t.Fatalf("NOT_DEPLOYED enum = %d, want 8", pb.RegisterPkResponse_NOT_DEPLOYED)
	}
}
