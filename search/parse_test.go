package search

import (
	"os"
	"testing"
)

// TestParsers runs every parser against a saved page so a broken selector is
// caught offline, without hitting the network.
func TestParsers(t *testing.T) {
	cases := []struct {
		file  string
		parse func(string) []Result
		min   int
	}{
		{"brave.html", parseBrave, 15},
		{"marginalia.html", parseMarginalia, 15},
		{"btdigg.html", parseBTDigg, 5},
		{"tordex.html", parseTordex, 10},
		{"bing.html", parseBing, 8},
		{"ddg.html", func(h string) []Result { return parseDDGPage(h, map[string]bool{}) }, 8},
	}
	for _, c := range cases {
		b, err := os.ReadFile("testdata/" + c.file)
		if err != nil {
			t.Fatalf("%s: %v", c.file, err)
		}
		got := c.parse(string(b))
		t.Logf("%-16s %d results", c.file, len(got))
		for i, r := range got {
			if i < 3 {
				t.Logf("    %s | %s | %.60s", r.Title, r.URL, r.Snippet)
			}
		}
		if len(got) < c.min {
			t.Errorf("%s: got %d results, want >= %d", c.file, len(got), c.min)
		}
	}
}
