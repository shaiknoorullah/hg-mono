package config

import (
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"strings"
)

// SecretSettings are the settings that hold a secret. Each may be given either
// as NAME or as NAME_FILE, the path of a file holding the value, so that the
// value stays out of the container's environment, where anything that can
// inspect containers can read it (issue #309:
// https://github.com/shaiknoorullah/hg-mono/issues/309).
//
// A new secret setting is added here, and nowhere else, to get the same
// treatment: the file form, the both-set refusal, the file-mode check and the
// placeholder refusal outside HG_ENV=local.
var SecretSettings = []string{
	// The connection string carries the database password.
	"HG_POSTGRES_DSN",
	"HG_REDIS_PASSWORD",
	// The object store's (Silo's) keys.
	"HG_MINIO_ACCESS_KEY",
	"HG_MINIO_SECRET_KEY",
	"HG_STRIPE_SECRET_KEY",
	"HG_STRIPE_WEBHOOK_SECRET",
	"HG_TWILIO_AUTH_TOKEN",
	// Read by auth.LoadSecrets through Config.Lookup: the sign-in code pepper,
	// the access-token signing seed, and the key that seals TOTP secrets.
	"HG_OTP_PEPPER",
	"HG_AUTH_SIGNING_KEY_SEED",
	"HG_APP_DATA_KEY",
}

// SecretSource says where a secret setting's value came from. It is what the
// boot log reports about a secret: never the value, never its length.
type SecretSource string

const (
	// SecretNotSet: neither NAME nor NAME_FILE is set.
	SecretNotSet SecretSource = "not set"
	// SecretFromEnv: the value came from the environment variable NAME.
	SecretFromEnv SecretSource = "environment"
	// SecretFromFile: the value came from the file NAME_FILE names.
	SecretFromFile SecretSource = "file"
)

// groupOrWorldReadable is the permission bits that let anyone but the file's
// owner read it.
const groupOrWorldReadable fs.FileMode = 0o044

// ReadSecret resolves one secret setting from name or from name_FILE.
//
//   - Both set (non-blank) is an error: which one wins would be a guess.
//   - The file must exist, be a regular file and hold a non-blank value. One
//     trailing newline is trimmed, since `echo value > file` writes one.
//   - A file its group or everyone can read is refused when strict (outside
//     HG_ENV=local) and returned as a warning otherwise.
//
// Neither the warning nor the error ever contains the value, the file's
// contents or their length: they name the setting and the path only.
func ReadSecret(getenv func(string) string, name string, strict bool) (value string, src SecretSource, warning string, err error) {
	fileVar := name + "_FILE"
	direct := strings.TrimSpace(getenv(name))
	path := strings.TrimSpace(getenv(fileVar))

	switch {
	case direct != "" && path != "":
		return "", SecretNotSet, "", fmt.Errorf("%s and %s are both set: set exactly one", name, fileVar)
	case path == "" && direct == "":
		return "", SecretNotSet, "", nil
	case path == "":
		return direct, SecretFromEnv, "", nil
	}

	info, err := os.Stat(path)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return "", SecretNotSet, "", fmt.Errorf("%s: %s does not exist", fileVar, path)
		}
		return "", SecretNotSet, "", fmt.Errorf("%s: cannot read %s: %v", fileVar, path, pathErrCause(err))
	}
	if !info.Mode().IsRegular() {
		return "", SecretNotSet, "", fmt.Errorf("%s: %s is not a regular file", fileVar, path)
	}
	// The mode is checked before the file is opened, so a refused file is
	// never read.
	if perm := info.Mode().Perm(); perm&groupOrWorldReadable != 0 {
		msg := fmt.Sprintf("%s: %s can be read by its group or by everyone (mode %04o); "+
			"make it mode 0400, owned by the user this process runs as", fileVar, path, perm)
		if strict {
			return "", SecretNotSet, "", errors.New(msg + " (refused outside HG_ENV=local)")
		}
		warning = msg
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return "", SecretNotSet, "", fmt.Errorf("%s: cannot read %s: %v", fileVar, path, pathErrCause(err))
	}
	v := string(raw)
	if strings.HasSuffix(v, "\r\n") {
		v = v[:len(v)-2]
	} else if strings.HasSuffix(v, "\n") {
		v = v[:len(v)-1]
	}
	if strings.TrimSpace(v) == "" {
		return "", SecretNotSet, "", fmt.Errorf("%s: %s is empty", fileVar, path)
	}
	return v, SecretFromFile, warning, nil
}

// pathErrCause drops the path an *fs.PathError repeats, keeping the reason
// ("permission denied"). The path is already in the message.
func pathErrCause(err error) error {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Err
	}
	return err
}

// placeholderMarkers are the stand-ins deploy/.env.example ships in place of
// a secret ("change-me-in-your-env", "change-me-openssl-rand-base64-32").
// Matching is by substring so a placeholder password inside a connection
// string is caught too.
var placeholderMarkers = []string{"change-me", "changeme"}

// IsPlaceholder reports whether v is, or contains, one of the placeholder
// values deploy/.env.example ships with. Outside HG_ENV=local a secret that
// is still a placeholder is refused at boot (issue #316:
// https://github.com/shaiknoorullah/hg-mono/issues/316).
func IsPlaceholder(v string) bool {
	lower := strings.ToLower(v)
	for _, m := range placeholderMarkers {
		if strings.Contains(lower, m) {
			return true
		}
	}
	return false
}

// resolvedSecret is one secret setting after ReadSecret.
type resolvedSecret struct {
	value  string
	source SecretSource
	// failed is true when resolving it already recorded an error, so the
	// "required and was not set" rule does not report it a second time.
	failed bool
}

// resolveSecrets reads every secret setting once, from its variable or its
// file, recording errors and warnings on the loader.
func (l *loader) resolveSecrets(strict bool) {
	l.secrets = make(map[string]resolvedSecret, len(SecretSettings))
	for _, name := range SecretSettings {
		v, src, warning, err := ReadSecret(l.getenv, name, strict)
		r := resolvedSecret{value: v, source: src}
		if err != nil {
			l.errs = append(l.errs, err.Error())
			r.failed = true
		}
		if warning != "" {
			l.warns = append(l.warns, warning)
		}
		if strict && v != "" && IsPlaceholder(v) {
			l.errf("%s is still the placeholder from deploy/.env.example; set a real secret "+
				"(refused outside HG_ENV=local)", name)
			r.failed = true
		}
		l.secrets[name] = r
	}
}

// Lookup returns a setting as Load resolved it: a secret setting given as
// NAME_FILE comes back as the file's value, and every other name is read from
// the environment Load was given. It exists for auth.LoadSecrets, which parses
// its own keys; nothing else should need it.
func (c *Config) Lookup(key string) string {
	if c.lookup == nil {
		return ""
	}
	return c.lookup(key)
}

// LogSecretSources logs where each secret setting came from (a file, the
// environment, or nowhere) and every warning Load raised. It never logs a
// value, a file's contents, or a length.
func (c *Config) LogSecretSources(log *slog.Logger) {
	attrs := make([]any, 0, len(SecretSettings))
	for _, name := range SecretSettings {
		src := c.SecretSources[name]
		if src == "" {
			src = SecretNotSet
		}
		attrs = append(attrs, slog.String(name, string(src)))
	}
	log.Info("secret settings", attrs...)
	for _, w := range c.Warnings {
		log.Warn("configuration warning", slog.String("detail", w))
	}
}
