package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

//go:embed static
var staticFiles embed.FS

func main() {
	store.Load()

	mux := http.NewServeMux()

	// OpenAI 兼容接口
	mux.HandleFunc("/v1/chat/completions", handleChatCompletions)
	mux.HandleFunc("/v1/models", handleListModels)

	// Admin API
	mux.HandleFunc("/admin/api/config", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			handleGetConfig(w, r)
		case http.MethodPut:
			handlePutConfig(w, r)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})
	mux.HandleFunc("/admin/api/providers", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			handleCreateProvider(w, r)
		} else {
			http.Error(w, "method not allowed", 405)
		}
	})
	mux.HandleFunc("/admin/api/providers/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/admin/api/providers/")
		if id == "" {
			http.Error(w, "not found", 404)
			return
		}
		switch r.Method {
		case http.MethodPut:
			handleUpdateProvider(w, r, id)
		case http.MethodDelete:
			handleDeleteProvider(w, r, id)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})
	mux.HandleFunc("/admin/api/requests", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodDelete {
			handleClearRequests(w, r)
		} else {
			handleListRequests(w, r)
		}
	})
	mux.HandleFunc("/admin/api/requests/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/admin/api/requests/")
		if id == "" {
			http.Error(w, "not found", 404)
			return
		}
		handleGetRequest(w, r, id)
	})
	mux.HandleFunc("/admin/api/custom-responses", func(w http.ResponseWriter, r *http.Request) {
		handleListCustom(w, r)
	})
	mux.HandleFunc("/admin/api/custom-responses/", func(w http.ResponseWriter, r *http.Request) {
		hash := strings.TrimPrefix(r.URL.Path, "/admin/api/custom-responses/")
		if hash == "" {
			http.Error(w, "not found", 404)
			return
		}
		switch r.Method {
		case http.MethodPost:
			handleSetCustom(w, r, hash)
		case http.MethodDelete:
			handleDeleteCustom(w, r, hash)
		default:
			http.Error(w, "method not allowed", 405)
		}
	})

	// 静态 UI
	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/admin/static/", http.StripPrefix("/admin/static/", http.FileServer(http.FS(staticFS))))
	mux.HandleFunc("/admin/", func(w http.ResponseWriter, r *http.Request) {
		data, err := fs.ReadFile(staticFS, "index.html")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
	mux.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", 302)
	})

	addr := ":12010"
	fmt.Printf("OpenAI Mock Inspector running on http://localhost%s\n", addr)
	fmt.Printf("  OpenAI API: http://localhost%s/v1\n", addr)
	fmt.Printf("  Admin UI:   http://localhost%s/admin/\n", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}
