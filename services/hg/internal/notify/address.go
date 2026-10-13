package notify

import (
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"golang.org/x/net/idna"
)

// ErrInvalidAddress is returned for an email address that is not exactly one
// plain address: a display name, a comment, a list, a line break or a control
// character, or a non-ASCII local part.
var ErrInvalidAddress = errors.New("notify: not a single plain email address")

// CanonicalEmail parses an address once and returns the one form that is both
// checked and sent. Everything that decides where an email goes — the
// non-production allow-list and the provider call — uses this result, never
// the raw string, so a value that one parser reads as an allowed address and
// another reads as someone else ("victim@evil.com <ok@halalgoes.com>",
// "ok@halalgoes.com, victim@evil.com", a CR/LF header injection) is refused
// instead of slipping past the check.
//
// The domain is lower-cased after IDNA normalisation (bücher.example becomes
// xn--bcher-kva.example); the local part is kept as written and must be ASCII.
func CanonicalEmail(raw string) (string, error) {
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return "", fmt.Errorf("%w: control character", ErrInvalidAddress)
		}
	}
	trimmed := strings.TrimSpace(raw)
	addr, err := mail.ParseAddress(trimmed)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidAddress, err)
	}
	// A display name, a comment, angle brackets or quoting all make the
	// parsed address differ from the input. Only the bare address is accepted.
	if addr.Name != "" || addr.Address != trimmed {
		return "", fmt.Errorf("%w: only a bare address is accepted", ErrInvalidAddress)
	}
	at := strings.LastIndexByte(addr.Address, '@')
	if at <= 0 || at == len(addr.Address)-1 {
		return "", fmt.Errorf("%w: no domain", ErrInvalidAddress)
	}
	local, domain := addr.Address[:at], addr.Address[at+1:]
	for _, r := range local {
		if r > 0x7e {
			return "", fmt.Errorf("%w: non-ASCII local part", ErrInvalidAddress)
		}
	}
	ascii, err := canonicalDomain(domain)
	if err != nil {
		return "", err
	}
	return local + "@" + ascii, nil
}

// canonicalDomain is the IDNA (lookup profile) ASCII form, lower-cased.
func canonicalDomain(domain string) (string, error) {
	ascii, err := idna.Lookup.ToASCII(domain)
	if err != nil || ascii == "" || !strings.Contains(ascii, ".") {
		return "", fmt.Errorf("%w: domain %q", ErrInvalidAddress, domain)
	}
	return strings.ToLower(ascii), nil
}

// AllowList is the set of addresses a non-production environment may really
// email: full addresses ("owner@example.com") or whole domains
// ("@halalgoes.com"), each stored in canonical form.
type AllowList struct {
	addresses map[string]bool // canonical, lower-cased
	domains   map[string]bool // "@" + canonical domain
}

// NewAllowList parses HG_EMAIL_ALLOWLIST entries. An entry that is not a
// plain address or an @domain is an error, so a typo fails the boot rather
// than silently letting nobody (or somebody unexpected) through.
func NewAllowList(entries []string) (AllowList, error) {
	a := AllowList{addresses: map[string]bool{}, domains: map[string]bool{}}
	for _, e := range entries {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if strings.HasPrefix(e, "@") {
			d, err := canonicalDomain(e[1:])
			if err != nil {
				return AllowList{}, fmt.Errorf("notify: allow-list entry %q: %w", e, err)
			}
			a.domains["@"+d] = true
			continue
		}
		c, err := CanonicalEmail(e)
		if err != nil {
			return AllowList{}, fmt.Errorf("notify: allow-list entry %q: %w", e, err)
		}
		a.addresses[strings.ToLower(c)] = true
	}
	return a, nil
}

// MustAllowList is NewAllowList for tests and literals.
func MustAllowList(entries ...string) AllowList {
	a, err := NewAllowList(entries)
	if err != nil {
		panic(err)
	}
	return a
}

// Len is the number of entries.
func (a AllowList) Len() int { return len(a.addresses) + len(a.domains) }

// Permits reports whether a canonical address (CanonicalEmail's result) is on
// the list. Comparison ignores case.
func (a AllowList) Permits(canonical string) bool {
	c := strings.ToLower(canonical)
	if a.addresses[c] {
		return true
	}
	at := strings.LastIndexByte(c, '@')
	return at > 0 && a.domains[c[at:]]
}
