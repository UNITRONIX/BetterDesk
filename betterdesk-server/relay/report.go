package relay

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// reportSessionEnded tells the signal server that a relayed session has finished.
//
// On a split deployment the relay is the only component that observes the pipe
// closing: signal recorded the session when it issued the ticket, but the bytes
// never pass through it. Without this report the session stays open until the
// target device goes offline, so the connected-time report keeps accruing after
// the operator has disconnected.
//
// Failures are logged and dropped. Session bookkeeping must never delay or fail
// the relay path, and the signal server reaps sessions whose device has gone
// away as a backstop.
func (s *Server) reportSessionEnded(uuid string, endedAt time.Time) {
	if s.cfg == nil || s.cfg.RelayReportURL == "" || s.cfg.RelayReportAPIKey == "" || uuid == "" {
		return
	}
	payload, err := json.Marshal(map[string]string{
		"action":     "end",
		"relay_uuid": uuid,
		"ended_at":   endedAt.UTC().Format(time.RFC3339Nano),
		"reason":     "relay_session_ended",
	})
	if err != nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), relayReportTimeout)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, http.MethodPost,
			s.cfg.RelayReportURL+"/api/relay/session-event", bytes.NewReader(payload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-API-Key", s.cfg.RelayReportAPIKey)

		resp, err := relayReportClient.Do(req)
		if err != nil {
			log.Printf("[relay] report session end for %s: %v", relayUUIDLogID(uuid), err)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			log.Printf("[relay] report session end for %s: signal returned %s", relayUUIDLogID(uuid), resp.Status)
		}
	}()
}

const relayReportTimeout = 5 * time.Second

var relayReportClient = &http.Client{Timeout: relayReportTimeout}
