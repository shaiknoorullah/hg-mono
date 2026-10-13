package auth

// A web app on its own host (partners.halalgoes.com beside api.halalgoes.com)
// can refresh its session: hg_csrf is set on the shared parent domain at
// Path=/, so the app reads it from document.cookie and sends it back as
// X-HG-CSRF, while hg_rt stays HttpOnly on the API host at Path=/v1/auth
// (https://github.com/shaiknoorullah/hg-mono/issues/740).

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

func TestWebSessionRefreshesWithTheSharedDomainCSRFCookie(t *testing.T) {
	pool := openTestPool(t)
	srv := buildDenyingTestServer(t, pool, func(s *Secrets) { s.CSRFCookieDomain = ".halalgoes.com" })

	const pw = "CsrfCookiePass12!"
	email := uniqueEmail("csrf_cookie")
	accountID := seedEmailAccount(t, pool, email, pw, httpx.RoleRestaurantOwner)
	cleanupAccount(t, pool, accountID, email)

	login := postAs(t, srv, "/v1/auth/login", ClientRestaurantWeb,
		map[string]any{"email": email, "password": pw})
	_, _ = io.Copy(io.Discard, login.Body)
	login.Body.Close()
	if login.StatusCode != http.StatusOK {
		t.Fatalf("login = %d, want 200", login.StatusCode)
	}
	rt, csrf := sessionCookies(t, login)

	if rt.Path != "/v1/auth" || !rt.HttpOnly || rt.Domain != "" {
		t.Errorf("hg_rt = Path %q HttpOnly %v Domain %q, want Path=/v1/auth, HttpOnly, host-only",
			rt.Path, rt.HttpOnly, rt.Domain)
	}
	// net/http drops the leading dot when it parses Domain.
	if csrf.Path != "/" || csrf.HttpOnly || csrf.Domain != "halalgoes.com" {
		t.Errorf("hg_csrf = Path %q HttpOnly %v Domain %q, want Path=/, readable, Domain=.halalgoes.com",
			csrf.Path, csrf.HttpOnly, csrf.Domain)
	}

	refresh := func(header string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/auth/refresh", strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-HG-Client", string(ClientRestaurantWeb))
		if header != "" {
			req.Header.Set("X-HG-CSRF", header)
		}
		// What the browser sends to the API: both cookies.
		req.AddCookie(&http.Cookie{Name: "hg_rt", Value: rt.Value})
		req.AddCookie(&http.Cookie{Name: "hg_csrf", Value: csrf.Value})
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}

	// Without the header the cookie alone is not enough: that is the CSRF check.
	if resp := refresh(""); resp.StatusCode != http.StatusUnauthorized {
		resp.Body.Close()
		t.Fatalf("refresh without X-HG-CSRF = %d, want 401", resp.StatusCode)
	} else {
		resp.Body.Close()
	}

	// The app read hg_csrf from document.cookie and echoes it: a new session.
	resp := refresh(csrf.Value)
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var out struct {
		Data struct {
			AccessToken string `json:"access_token"`
		} `json:"data"`
	}
	if resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &out) != nil || out.Data.AccessToken == "" {
		t.Fatalf("refresh with X-HG-CSRF = %d %s, want 200 with an access token", resp.StatusCode, raw)
	}
	newRT, newCSRF := sessionCookies(t, resp)
	if newRT.Value == rt.Value || newCSRF.Domain != "halalgoes.com" || newCSRF.Path != "/" {
		t.Errorf("refresh cookies: rotated %v, hg_csrf Domain %q Path %q; want a new hg_rt and hg_csrf on .halalgoes.com at /",
			newRT.Value != rt.Value, newCSRF.Domain, newCSRF.Path)
	}
}

// sessionCookies returns the hg_rt and hg_csrf cookies a SessionGrant set.
func sessionCookies(t *testing.T, resp *http.Response) (rt, csrf *http.Cookie) {
	t.Helper()
	for _, c := range resp.Cookies() {
		switch c.Name {
		case "hg_rt":
			rt = c
		case "hg_csrf":
			csrf = c
		}
	}
	if rt == nil || csrf == nil || rt.Value == "" || csrf.Value == "" {
		t.Fatalf("want hg_rt and hg_csrf cookies, got %q", resp.Header.Values("Set-Cookie"))
	}
	return rt, csrf
}
