package main

import (
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

func ghosterMenu(app *App) *menu.Menu {
	emit := func(action string) menu.Callback {
		return func(*menu.CallbackData) {
			if app.ctx != nil {
				wailsruntime.EventsEmit(app.ctx, "ghoster:shortcut", action)
			}
		}
	}

	file := menu.NewMenu()
	file.AddText("New Tab", keys.CmdOrCtrl("t"), emit("new-tab"))
	file.AddText("Reopen Closed Tab", keys.Combo("t", keys.CmdOrCtrlKey, keys.ShiftKey), emit("reopen-tab"))
	file.AddText("Duplicate Tab", nil, emit("duplicate-tab"))
	file.AddSeparator()
	file.AddText("Close Tab", keys.CmdOrCtrl("w"), emit("close-tab"))

	navigation := menu.NewMenu()
	navigation.AddText("Back", keys.CmdOrCtrl("["), emit("back"))
	navigation.AddText("Forward", keys.CmdOrCtrl("]"), emit("forward"))
	navigation.AddText("Reload", keys.CmdOrCtrl("r"), emit("reload"))
	navigation.AddText("Focus Address Bar", keys.CmdOrCtrl("l"), emit("focus-location"))
	navigation.AddText("Context Menu", keys.Shift("f10"), emit("show-context-menu"))

	tabs := menu.NewMenu()
	tabs.AddText("Next Tab", keys.Control("tab"), emit("next-tab"))
	tabs.AddText("Previous Tab", keys.Combo("tab", keys.ControlKey, keys.ShiftKey), emit("previous-tab"))
	tabs.AddSeparator()
	for i := 1; i <= 9; i++ {
		label := "Tab " + string(rune('0'+i))
		if i == 9 {
			label = "Last Tab"
		}
		tabs.AddText(label, keys.CmdOrCtrl(string(rune('0'+i))), emit("tab-"+string(rune('0'+i))))
	}

	return menu.NewMenuFromItems(
		menu.AppMenu(),
		menu.SubMenu("File", file),
		menu.EditMenu(),
		menu.SubMenu("Go", navigation),
		menu.SubMenu("Tabs", tabs),
		menu.WindowMenu(),
	)
}
