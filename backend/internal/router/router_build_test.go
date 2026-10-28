package router

import "testing"

// 路由树构建回归：gin 要求静态段先于参数段注册，
// 顺序写错会在启动期 panic，这里把风险挡在测试里。
func TestNew_RegistersUserProfileRoutes(t *testing.T) {
	r := New(RouterDeps{})

	want := map[string]bool{
		"GET /api/v1/users/:name":             false,
		"GET /api/v1/users/:name/submissions": false,
		"GET /api/v1/users/:name/activity":    false,
		"GET /api/v1/users/me/activity":       false,
		"PUT /api/v1/users/me/profile":        false,
		"POST /api/v1/users/me/banner":        false,
		"GET /api/v1/users/search":            false,
		"GET /api/v1/search":                  false,
		"GET /api/v1/search/counts":           false,
	}
	for _, rt := range r.Routes() {
		key := rt.Method + " " + rt.Path
		if _, ok := want[key]; ok {
			want[key] = true
		}
	}
	for key, ok := range want {
		if !ok {
			t.Errorf("route not registered: %s", key)
		}
	}
}
