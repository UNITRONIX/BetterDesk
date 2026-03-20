package cdap

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Manifest describes a CDAP device's capabilities, identity, and widget definitions.
type Manifest struct {
	ManifestVersion   string         `json:"manifest_version"` // "1.0"
	Device            ManifestDevice `json:"device"`
	Bridge            ManifestBridge `json:"bridge,omitempty"`
	Capabilities      []string       `json:"capabilities"`       // telemetry, commands, alerts, logs, ...
	HeartbeatInterval int            `json:"heartbeat_interval"` // seconds (default 15, max 300)
	Widgets           []Widget       `json:"widgets,omitempty"`
	Alerts            []AlertDef     `json:"alerts,omitempty"`
}

// ManifestDevice describes the physical/virtual device identity.
type ManifestDevice struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"` // scada, iot, os_agent, network, camera, desktop, custom
	Vendor      string   `json:"vendor,omitempty"`
	Model       string   `json:"model,omitempty"`
	Firmware    string   `json:"firmware,omitempty"`
	Serial      string   `json:"serial,omitempty"`
	Location    string   `json:"location,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	Icon        string   `json:"icon,omitempty"`
	Description string   `json:"description,omitempty"`
}

// ManifestBridge describes the bridge software connecting the device to CDAP.
type ManifestBridge struct {
	Name       string `json:"name,omitempty"`
	Version    string `json:"version,omitempty"`
	Protocol   string `json:"protocol,omitempty"`
	TargetHost string `json:"target_host,omitempty"`
	TargetPort int    `json:"target_port,omitempty"`
}

// Widget represents a single control/display element on the device.
type Widget struct {
	Type     string `json:"type"` // toggle, gauge, button, led, chart, select, slider, text, table, terminal, desktop, video_stream, file_browser
	ID       string `json:"id"`
	Label    string `json:"label"`
	Group    string `json:"group,omitempty"` // collapsible group name
	Value    any    `json:"value,omitempty"` // initial value
	Readonly bool   `json:"readonly,omitempty"`

	// Gauge/Slider fields
	Unit        string  `json:"unit,omitempty"`
	Min         float64 `json:"min,omitempty"`
	Max         float64 `json:"max,omitempty"`
	Step        float64 `json:"step,omitempty"`
	Precision   int     `json:"precision,omitempty"`
	WarningLow  float64 `json:"warning_low,omitempty"`
	WarningHigh float64 `json:"warning_high,omitempty"`

	// Button fields
	Confirm        bool   `json:"confirm,omitempty"`
	ConfirmMessage string `json:"confirm_message,omitempty"`
	Style          string `json:"style,omitempty"` // primary, danger, etc.
	Icon           string `json:"icon,omitempty"`
	Cooldown       int    `json:"cooldown,omitempty"` // seconds

	// Select fields
	Options []WidgetOption `json:"options,omitempty"`

	// Chart fields
	ChartType string        `json:"chart_type,omitempty"` // line, bar, area
	Points    int           `json:"points,omitempty"`
	Series    []ChartSeries `json:"series,omitempty"`
	Retention string        `json:"retention,omitempty"` // 24h, 7d, etc.

	// Table fields
	Columns  []TableColumn `json:"columns,omitempty"`
	MaxRows  int           `json:"max_rows,omitempty"`
	Sortable bool          `json:"sortable,omitempty"`
}

// WidgetOption for select widgets.
type WidgetOption struct {
	Label string `json:"label"`
	Value any    `json:"value"`
}

// ChartSeries for chart widgets.
type ChartSeries struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Color string `json:"color,omitempty"`
	Unit  string `json:"unit,omitempty"`
}

// TableColumn for table widgets.
type TableColumn struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type,omitempty"` // string, number, boolean, date
}

// AlertDef defines a threshold-based alert.
type AlertDef struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	Severity  string `json:"severity"`  // critical, warning, info
	Condition string `json:"condition"` // expression string
	Message   string `json:"message"`
}

// Allowed device types.
var allowedDeviceTypes = map[string]bool{
	"scada":    true,
	"iot":      true,
	"os_agent": true,
	"network":  true,
	"camera":   true,
	"desktop":  true,
	"custom":   true,
}

// Allowed widget types.
var allowedWidgetTypes = map[string]bool{
	"toggle":       true,
	"gauge":        true,
	"button":       true,
	"led":          true,
	"chart":        true,
	"select":       true,
	"slider":       true,
	"text":         true,
	"table":        true,
	"terminal":     true,
	"desktop":      true,
	"video_stream": true,
	"file_browser": true,
}

// Allowed capabilities.
var allowedCapabilities = map[string]bool{
	"telemetry":      true,
	"commands":       true,
	"alerts":         true,
	"logs":           true,
	"remote_desktop": true,
	"video_stream":   true,
	"audio":          true,
	"clipboard":      true,
	"file_transfer":  true,
	"input_control":  true,
}

// maxWidgets is the hard limit on widget count per device.
const maxWidgets = 200

// ParseManifest parses and validates a CDAP device manifest from raw JSON.
func ParseManifest(data json.RawMessage) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	if err := ValidateManifest(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

// ValidateManifest checks that a manifest is well-formed.
func ValidateManifest(m *Manifest) error {
	if m.ManifestVersion == "" {
		m.ManifestVersion = "1.0"
	}
	if m.ManifestVersion != "1.0" {
		return fmt.Errorf("unsupported manifest version: %s", m.ManifestVersion)
	}

	// Device name required
	m.Device.Name = strings.TrimSpace(m.Device.Name)
	if m.Device.Name == "" {
		return fmt.Errorf("device name is required")
	}
	if len(m.Device.Name) > 128 {
		return fmt.Errorf("device name too long (max 128 chars)")
	}

	// Device type validation
	m.Device.Type = strings.ToLower(strings.TrimSpace(m.Device.Type))
	if m.Device.Type == "" {
		m.Device.Type = "custom"
	}
	if !allowedDeviceTypes[m.Device.Type] {
		return fmt.Errorf("invalid device type: %s", m.Device.Type)
	}

	// Heartbeat interval bounds
	if m.HeartbeatInterval <= 0 {
		m.HeartbeatInterval = 15
	}
	if m.HeartbeatInterval > 300 {
		m.HeartbeatInterval = 300
	}

	// Capabilities validation
	for _, cap := range m.Capabilities {
		if !allowedCapabilities[strings.ToLower(cap)] {
			return fmt.Errorf("unknown capability: %s", cap)
		}
	}

	// Widget validation
	if len(m.Widgets) > maxWidgets {
		return fmt.Errorf("too many widgets (%d, max %d)", len(m.Widgets), maxWidgets)
	}

	widgetIDs := make(map[string]bool, len(m.Widgets))
	for i := range m.Widgets {
		w := &m.Widgets[i]
		w.Type = strings.ToLower(strings.TrimSpace(w.Type))
		if !allowedWidgetTypes[w.Type] {
			return fmt.Errorf("widget %d: invalid type: %s", i, w.Type)
		}
		w.ID = strings.TrimSpace(w.ID)
		if w.ID == "" {
			return fmt.Errorf("widget %d: id is required", i)
		}
		if len(w.ID) > 64 {
			return fmt.Errorf("widget %d: id too long (max 64 chars)", i)
		}
		if widgetIDs[w.ID] {
			return fmt.Errorf("widget %d: duplicate id: %s", i, w.ID)
		}
		widgetIDs[w.ID] = true

		w.Label = strings.TrimSpace(w.Label)
		if w.Label == "" {
			w.Label = w.ID
		}
	}

	// Alert validation
	alertIDs := make(map[string]bool, len(m.Alerts))
	for i := range m.Alerts {
		a := &m.Alerts[i]
		a.ID = strings.TrimSpace(a.ID)
		if a.ID == "" {
			return fmt.Errorf("alert %d: id is required", i)
		}
		if alertIDs[a.ID] {
			return fmt.Errorf("alert %d: duplicate id: %s", i, a.ID)
		}
		alertIDs[a.ID] = true

		a.Severity = strings.ToLower(strings.TrimSpace(a.Severity))
		if a.Severity != "critical" && a.Severity != "warning" && a.Severity != "info" {
			return fmt.Errorf("alert %d: invalid severity: %s", i, a.Severity)
		}
	}

	// Tags: max 20 tags, max 64 chars each
	if len(m.Device.Tags) > 20 {
		return fmt.Errorf("too many device tags (%d, max 20)", len(m.Device.Tags))
	}
	for i, tag := range m.Device.Tags {
		if len(tag) > 64 {
			return fmt.Errorf("device tag %d too long (max 64 chars)", i)
		}
	}

	return nil
}
