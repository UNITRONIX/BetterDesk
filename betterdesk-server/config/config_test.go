package config

import (
	"os"
	"testing"
)

func TestValidateAdminInterface(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		port      int
		password  string
		wantError bool
	}{
		{name: "disabled without password"},
		{name: "enabled with password", port: 21115, password: "correct horse battery staple"},
		{name: "enabled without password", port: 21115, wantError: true},
		{name: "enabled with whitespace password", port: 21115, password: " \t", wantError: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := DefaultConfig()
			cfg.AdminPort = tt.port
			cfg.AdminPassword = tt.password

			err := cfg.ValidateAdminInterface()
			if (err != nil) != tt.wantError {
				t.Fatalf("ValidateAdminInterface() error = %v, wantError %v", err, tt.wantError)
			}
		})
	}
}

func TestLoadEnv_GOAPIPortPrecedenceOverAPIPort(t *testing.T) {
	t.Setenv("GO_API_PORT", "21114")
	t.Setenv("API_PORT", "21121")

	cfg := DefaultConfig()
	cfg.APIPort = 9999
	cfg.LoadEnv()

	if cfg.APIPort != 21114 {
		t.Fatalf("APIPort = %d, want 21114 (GO_API_PORT should win over API_PORT)", cfg.APIPort)
	}
}

func TestLoadEnv_APIPortLegacyFallback(t *testing.T) {
	t.Setenv("GO_API_PORT", "")
	os.Unsetenv("GO_API_PORT")
	t.Setenv("API_PORT", "21121")

	cfg := DefaultConfig()
	cfg.APIPort = 9999
	cfg.LoadEnv()

	if cfg.APIPort != 21121 {
		t.Fatalf("APIPort = %d, want 21121 (legacy API_PORT-only installs)", cfg.APIPort)
	}
}

func TestLoadEnv_SignalPortPrecedenceOverPort(t *testing.T) {
	t.Setenv("SIGNAL_PORT", "21116")
	t.Setenv("PORT", "5000")

	cfg := DefaultConfig()
	cfg.SignalPort = 9999
	cfg.LoadEnv()

	if cfg.SignalPort != 21116 {
		t.Fatalf("SignalPort = %d, want 21116 (SIGNAL_PORT should win over PORT)", cfg.SignalPort)
	}
}

func TestLoadEnv_CDAPTLSRequiredEnablesTLS(t *testing.T) {
	t.Setenv("CDAP_TLS_REQUIRED", "true")

	cfg := DefaultConfig()
	cfg.LoadEnv()

	if !cfg.CDAPTLSRequired {
		t.Fatal("CDAPTLSRequired = false, want true")
	}
	if !cfg.CDAPTLS {
		t.Fatal("CDAPTLS = false, want true when TLS is required")
	}
}

func TestLoadEnv_AllowLegacyOutbound(t *testing.T) {
	t.Setenv("ALLOW_LEGACY_OUTBOUND", "yes")

	cfg := DefaultConfig()
	cfg.LoadEnv()

	if !cfg.AllowLegacyOutbound {
		t.Fatal("AllowLegacyOutbound = false, want true")
	}
}

func TestDefaultConfig_LegacyOutboundIsSecureByDefault(t *testing.T) {
	if DefaultConfig().AllowLegacyOutbound {
		t.Fatal("AllowLegacyOutbound must be disabled by default")
	}
}

func TestLoadEnv_LoggedInOnlyInitiator(t *testing.T) {
	t.Setenv("LOGGED_IN_ONLY_INITIATOR", "yes")

	cfg := DefaultConfig()
	cfg.LoadEnv()
	if !cfg.LoggedInOnlyInitiator {
		t.Fatal("LoggedInOnlyInitiator = false, want true")
	}

	t.Setenv("LOGGED_IN_ONLY_INITIATOR", "off")
	cfg = DefaultConfig()
	cfg.LoadEnv()
	if cfg.LoggedInOnlyInitiator {
		t.Fatal("LoggedInOnlyInitiator = true, want false")
	}
}

func TestLoadEnv_OperatorOnlyOutbound(t *testing.T) {
	t.Setenv("OPERATOR_ONLY_OUTBOUND", "yes")

	cfg := DefaultConfig()
	cfg.LoadEnv()
	if !cfg.OperatorOnlyOutbound {
		t.Fatal("OperatorOnlyOutbound = false, want true")
	}

	t.Setenv("OPERATOR_ONLY_OUTBOUND", "off")
	cfg = DefaultConfig()
	cfg.LoadEnv()
	if cfg.OperatorOnlyOutbound {
		t.Fatal("OperatorOnlyOutbound = true, want false")
	}
}

func TestLoadEnv_EnrollmentModeExplicitByDefault(t *testing.T) {
	t.Setenv("ENROLLMENT_MODE", "open")
	t.Setenv("ENROLLMENT_MODE_ENV_OVERRIDE", "")

	cfg := DefaultConfig()
	cfg.LoadEnv()

	if cfg.EnrollmentMode != EnrollmentModeOpen {
		t.Fatalf("EnrollmentMode = %q, want %q", cfg.EnrollmentMode, EnrollmentModeOpen)
	}
	if !cfg.EnrollmentModeEnvOverride {
		t.Fatal("native ENROLLMENT_MODE should be treated as explicit")
	}
}

func TestLoadEnv_EntrypointDefaultIsNotExplicit(t *testing.T) {
	t.Setenv("ENROLLMENT_MODE", "managed")
	t.Setenv("ENROLLMENT_MODE_ENV_OVERRIDE", "N")

	cfg := DefaultConfig()
	cfg.LoadEnv()

	if cfg.EnrollmentMode != EnrollmentModeManaged {
		t.Fatalf("EnrollmentMode = %q, want %q", cfg.EnrollmentMode, EnrollmentModeManaged)
	}
	if cfg.EnrollmentModeEnvOverride {
		t.Fatal("entrypoint-generated enrollment mode must not override panel state")
	}
}
