package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	// Initialize database
	initDatabase()

	// Initialize the persistent game (also starts game loop + round timer internally)
	game := initPersistentGame()
	setPersistentGame(game)

	// Start heartbeat for WebSocket connections
	startHeartbeat()

	// Determine frontend directory
	cwd, _ := os.Getwd()
	frontendDir := filepath.Join(cwd, "frontend")

	// Check if frontend dir exists (might be running from backend-go/)
	if _, err := os.Stat(frontendDir); os.IsNotExist(err) {
		// Try parent directory
		parentFrontend := filepath.Join(cwd, "..", "frontend")
		if _, err := os.Stat(parentFrontend); err == nil {
			frontendDir = parentFrontend
		}
	}

	fmt.Printf("📁 Serving frontend from: %s\n", frontendDir)

	// Static file server for the frontend
	fileServer := http.FileServer(http.Dir(frontendDir))

	mux := http.NewServeMux()

	// WebSocket endpoint
	mux.HandleFunc("/socket", handleWebSocket)

	// Serve static files with SPA fallback
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Security headers
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		// Try to serve the file
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		// Check if the file exists
		fullPath := filepath.Join(frontendDir, filepath.Clean(path))
		if _, err := os.Stat(fullPath); err == nil {
			// File exists, serve it
			// Set cache headers based on path
			if strings.HasPrefix(path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=604800, immutable")
			} else if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") {
				w.Header().Set("Cache-Control", "public, max-age=3600")
			}
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback: serve index.html for non-file routes
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
	})

	addr := fmt.Sprintf("0.0.0.0:%s", port)
	fmt.Printf("🎮 Backend running on http://%s\n", addr)
	fmt.Printf("🌐 Frontend available at http://localhost:%s/\n", port)
	fmt.Printf("🔌 WebSocket server running on ws://localhost:%s/socket\n", port)

	if err := http.ListenAndServe(addr, mux); err != nil {
		fmt.Printf("❌ Server error: %v\n", err)
		os.Exit(1)
	}
}
