package search

import "testing"

func TestSearchPageClamps(t *testing.T) {
	if got := clampPage(0); got != 1 {
		t.Fatalf("page 0 -> %d, want 1", got)
	}
	if got := clampPage(-3); got != 1 {
		t.Fatalf("page -3 -> %d, want 1", got)
	}
	if got := clampPage(4); got != 4 {
		t.Fatalf("page 4 -> %d, want 4", got)
	}
}

func TestWaitAllHasMore(t *testing.T) {
	got, more := waitAll([]func() []Result{
		func() []Result {
			out := make([]Result, 10)
			for i := range out {
				out[i] = Result{URL: "https://a.example/" + itoa(i), Title: "a", Source: "web"}
			}
			return out
		},
		func() []Result { return nil },
	})
	if !more {
		t.Fatal("expected hasMore when one engine returned a full page")
	}
	if len(got) != 10 {
		t.Fatalf("got %d results, want 10", len(got))
	}
}
