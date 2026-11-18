package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unitronix/betterdesk-server/ratelimit"
)

// Audit M5 (2026-11-13): caller-supplied pagination must be clamped so an
// authenticated reader cannot ask the database for an unbounded result set.
func TestQueryLimitOffsetClampsInput(t *testing.T) {
	cases := []struct {
		name       string
		query      string
		wantLimit  int
		wantOffset int
	}{
		{"defaults", "", 100, 0},
		{"explicit values", "?limit=25&offset=50", 25, 50},
		{"huge limit clamped", "?limit=99999999", 500, 0},
		{"huge offset clamped", "?offset=99999999", 100, 10000},
		{"negative limit falls back", "?limit=-5", 100, 0},
		{"negative offset clamped", "?offset=-5", 100, 0},
		{"non numeric ignored", "?limit=abc&offset=xyz", 100, 0},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/audit/conn"+tc.query, nil)
			limit, offset := queryLimitOffset(req)
			if limit != tc.wantLimit {
				t.Errorf("limit = %d, want %d", limit, tc.wantLimit)
			}
			if offset != tc.wantOffset {
				t.Errorf("offset = %d, want %d", offset, tc.wantOffset)
			}
		})
	}
}

// Audit M6 (2026-11-13): the public audit write endpoints must be rate limited.
func TestAuditWriteEndpointsAreRateLimited(t *testing.T) {
	srv := &Server{
		auditWriteLimiter: ratelimit.NewIPLimiter(1, time.Minute, time.Minute),
	}
	defer srv.auditWriteLimiter.Stop()
	handler := srv.rateLimitPublic(srv.auditWriteLimiter, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	first := httptest.NewRecorder()
	handler(first, httptest.NewRequest(http.MethodPost, "/api/audit/conn", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first request status = %d, want 200", first.Code)
	}

	second := httptest.NewRecorder()
	handler(second, httptest.NewRequest(http.MethodPost, "/api/audit/conn", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second request status = %d, want 429", second.Code)
	}
}
