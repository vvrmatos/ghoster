package search

import (
	"os"
	"testing"
	"time"
)

func TestFastLive(t *testing.T) {
	if os.Getenv("GHOSTER_LIVE") == "" {
		t.Skip("set GHOSTER_LIVE=1 to query the real engines over Tor")
	}
	ClearCache()
	start := time.Now()
	first := SearchFast("privacy browser architecture")
	cold := time.Since(start)
	start = time.Now()
	second := SearchFast("privacy browser architecture")
	warm := time.Since(start)
	t.Logf("fast cold=%d in %s; cached=%d in %s", len(first.Web), cold.Round(time.Millisecond), len(second.Web), warm.Round(time.Millisecond))
	if len(first.Web) < 10 {
		t.Fatalf("fast tier returned only %d results", len(first.Web))
	}
	if len(second.Web) != len(first.Web) {
		t.Fatalf("cached result count changed: %d -> %d", len(first.Web), len(second.Web))
	}
}
