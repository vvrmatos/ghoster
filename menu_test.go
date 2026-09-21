package main

import (
	"testing"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

func TestGhosterMenuContainsNativeBrowserShortcuts(t *testing.T) {
	root := ghosterMenu(&App{})
	items := map[string]*menu.MenuItem{}
	var collect func(*menu.Menu)
	collect = func(current *menu.Menu) {
		for _, item := range current.Items {
			items[item.Label] = item
			if item.SubMenu != nil {
				collect(item.SubMenu)
			}
		}
	}
	collect(root)

	for _, label := range []string{
		"New Tab", "Reopen Closed Tab", "Close Tab",
		"Back", "Forward", "Reload", "Focus Address Bar", "Context Menu",
		"Next Tab", "Previous Tab", "Tab 1", "Last Tab",
	} {
		item := items[label]
		if item == nil {
			t.Errorf("native menu missing %q", label)
			continue
		}
		if item.Accelerator == nil {
			t.Errorf("native menu item %q has no accelerator", label)
		}
	}
}
