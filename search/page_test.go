package search

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

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

func TestSessionCache(t *testing.T) {
	ClearCache()
	key := cacheKey("web", "  HeY There  ", 1)
	want := Results{
		Query: "hey there",
		Page:  1,
		Web:   []Result{{URL: "https://example.com", Title: "example", Source: "web"}},
	}
	cachePut(key, want)

	got, ok := cacheGet(cacheKey("web", "hey there", 1))
	if !ok {
		t.Fatal("normalized query did not hit the cache")
	}
	if len(got.Web) != 1 || got.Web[0].URL != want.Web[0].URL {
		t.Fatalf("cache returned %#v, want %#v", got, want)
	}

	ClearCache()
	if _, ok := cacheGet(key); ok {
		t.Fatal("ClearCache left the entry behind")
	}
}

func TestCachedCallCoalescesConcurrentRefreshes(t *testing.T) {
	ClearCache()
	var calls atomic.Int32
	load := func() Results {
		calls.Add(1)
		time.Sleep(20 * time.Millisecond)
		return Results{Query: "same", Web: []Result{{URL: "https://example.com"}}}
	}
	valid := func(Results) bool { return true }

	var wg sync.WaitGroup
	wg.Add(3)
	for range 3 {
		go func() {
			defer wg.Done()
			got := cachedCall("same-key", valid, load)
			if len(got.Web) != 1 {
				t.Errorf("got %d results, want 1", len(got.Web))
			}
		}()
	}
	wg.Wait()
	if got := calls.Load(); got != 1 {
		t.Fatalf("load ran %d times, want exactly 1", got)
	}
}

func TestFirstUsefulDoesNotWaitForSlowEngine(t *testing.T) {
	start := time.Now()
	got := firstUseful([]func() []Result{
		func() []Result {
			out := make([]Result, 20)
			for i := range out {
				out[i] = Result{URL: "https://fast.example/" + itoa(i)}
			}
			return out
		},
		func() []Result {
			time.Sleep(250 * time.Millisecond)
			return []Result{{URL: "https://slow.example"}}
		},
	}, time.Second, 20)
	if len(got) != 20 {
		t.Fatalf("got %d results, want 20", len(got))
	}
	if elapsed := time.Since(start); elapsed >= 200*time.Millisecond {
		t.Fatalf("fast tier waited for slow engine: %s", elapsed)
	}
}
