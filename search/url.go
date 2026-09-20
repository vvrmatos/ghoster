package search

import "net/url"

func urlEncode(s string) string { return url.QueryEscape(s) }

func urlDecode(s string) string {
	d, err := url.QueryUnescape(s)
	if err != nil {
		return s
	}
	return d
}
