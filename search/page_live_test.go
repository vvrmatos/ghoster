package search

import (
	"os"
	"testing"
	"time"
)

func TestSearchPageLive(t *testing.T) {
	if os.Getenv("GHOSTER_LIVE") == "" {
		t.Skip("set GHOSTER_LIVE=1 to query the real engines over Tor")
	}
	start := time.Now()
	p1 := SearchPage("hey there", 1)
	t.Logf("page1 web=%d hasMore=%v in %s", len(p1.Web), p1.HasMore, time.Since(start).Round(time.Millisecond))
	if len(p1.Web) < 10 {
		t.Errorf("page 1 only %d web results", len(p1.Web))
	}
	if !p1.HasMore {
		t.Error("page 1 should report hasMore so the UI can offer Next")
	}
	start = time.Now()
	p2 := SearchPage("hey there", 2)
	t.Logf("page2 web=%d hasMore=%v in %s", len(p2.Web), p2.HasMore, time.Since(start).Round(time.Millisecond))
}
