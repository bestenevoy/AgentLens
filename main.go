package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"strings"
)

//go:embed all:web/dist
var webFS embed.FS

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

	// 静态 UI (React 构建产物) + SPA fallback
	distFS, err := fs.Sub(webFS, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	fileServer := http.StripPrefix("/admin/", http.FileServer(http.FS(distFS)))
	mux.HandleFunc("/admin/", func(w http.ResponseWriter, r *http.Request) {
		// /admin/api/* 走 API 路由（已注册），这里只处理静态资源
		if strings.HasPrefix(r.URL.Path, "/admin/api/") {
			http.NotFound(w, r)
			return
		}
		// 尝试静态文件
		path := strings.TrimPrefix(r.URL.Path, "/admin/")
		if path == "" {
			path = "index.html"
		}
		// 如果文件存在，直接服务
		if f, err := distFS.Open(path); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback: 返回 index.html
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/admin/index.html"
		fileServer.ServeHTTP(w, r2)
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
