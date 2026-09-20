package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// Route the app's own network (and WKWebView, which honors these on macOS)
	// through the local sanitizing proxy → Tor.
	os.Setenv("HTTP_PROXY", "http://127.0.0.1:8888")
	os.Setenv("HTTPS_PROXY", "http://127.0.0.1:8888")
	os.Setenv("ALL_PROXY", "socks5://127.0.0.1:9050")

	err := wails.Run(&options.App{
		Title:     "Ghoster",
		Width:     1200,
		Height:    800,
		MinWidth:  600,
		MinHeight: 400,
		Frameless: false,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 8, G: 8, B: 12, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			TitleBar:             mac.TitleBarHiddenInset(),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			About: &mac.AboutInfo{
				Title:   "Ghoster",
				Message: "Anonymous browser. Tor built-in.\nEngine: WebKit. Core: Go.\n© 2026 Ghoster",
			},
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
