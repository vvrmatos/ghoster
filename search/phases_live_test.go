package search

import (
	"os"
	"testing"
	"time"
)

// TestPhases times the fast pass and the deep sweep separately.
func TestPhases(t *testing.T) {
	if os.Getenv("GHOSTER_LIVE") == "" {
		t.Skip("set GHOSTER_LIVE=1 to query the real engines over Tor")
	}
	for _, q := range []string{"hey there", "gabriel garcia marquez"} {
		start := time.Now()
		fast := SearchWeb(q)
		fastAt := time.Since(start)

		start = time.Now()
		more := SearchMore(q)
		merged := interleave([][]Result{fast.Web, more.Web})
		t.Logf("q=%q fast=%d in %s | deep=+%d in %s | total unique=%d",
			q, len(fast.Web), fastAt.Round(time.Millisecond),
			len(more.Web), time.Since(start).Round(time.Millisecond), len(merged))
	}
}
