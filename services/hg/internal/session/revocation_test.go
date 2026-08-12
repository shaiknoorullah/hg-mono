package session

import (
	"context"
	"testing"
	"time"
)

func TestDenySetSessionAndAccount(t *testing.T) {
	d := NewDenySet()
	if d.Denied("s1", "a1") {
		t.Fatal("fresh deny set denies nothing")
	}
	d.AddSession("s1")
	if !d.RevokedSession("s1") || !d.Denied("s1", "a1") {
		t.Fatal("session s1 should be denied after AddSession")
	}
	if d.Denied("s2", "a1") {
		t.Fatal("session s2 was not revoked")
	}
	d.AddAccount("a2")
	if !d.RevokedAccount("a2") || !d.Denied("s3", "a2") {
		t.Fatal("account a2 should be wholesale denied")
	}
}

func TestDenySetReplaceIsAuthoritative(t *testing.T) {
	d := NewDenySet()
	d.AddSession("old")
	d.Replace([]string{"new"}, []string{"acc"})
	if d.RevokedSession("old") {
		t.Fatal("Replace did not swap out the old set")
	}
	if !d.RevokedSession("new") || !d.RevokedAccount("acc") {
		t.Fatal("Replace did not install the new set")
	}
}

type fakeLoader struct {
	sessions, accounts []string
	calls              int
}

func (f *fakeLoader) LoadRevoked(context.Context) ([]string, []string, error) {
	f.calls++
	return f.sessions, f.accounts, nil
}

func TestRunRefresherLoadsImmediately(t *testing.T) {
	d := NewDenySet()
	l := &fakeLoader{sessions: []string{"s1"}, accounts: []string{"a1"}}
	ctx, cancel := context.WithCancel(context.Background())
	go d.RunRefresher(ctx, l, time.Hour)
	// The immediate load happens before the first tick; poll briefly.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if d.RevokedSession("s1") {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancel()
	if !d.RevokedSession("s1") || !d.RevokedAccount("a1") {
		t.Fatal("RunRefresher did not perform the immediate load")
	}
}
