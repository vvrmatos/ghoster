package search

import (
	"os"
	"testing"
	"time"
)

// TestLive hits the real engines through Tor.
// Run with: GHOSTER_LIVE=1 go test ./search -run Live -v
func TestLive(t *testing.T) {
	if os.Getenv("GHOSTER_LIVE") == "" {
		t.Skip("set GHOSTER_LIVE=1 to query the real engines over Tor")
	}
	for _, q := range []string{"linux", "tor browser", "gabriel garcia marquez"} {
		start := time.Now()
		web := SearchWeb(q)
		t.Logf("q=%q web=%d in %s", q, len(web.Web), time.Since(start).Round(time.Millisecond))
		for i, r := range web.Web {
			if i < 5 {
				t.Logf("   %d. %s  %s", i+1, r.Title, r.URL)
			}
		}
		if len(web.Web) < 20 {
			t.Errorf("q=%q only %d web results", q, len(web.Web))
		}
	}
	start := time.Now()
	dark := SearchDark("linux")
	t.Logf("dark onion=%d torrent=%d in %s", len(dark.Onion), len(dark.Torrent), time.Since(start).Round(time.Millisecond))
}
