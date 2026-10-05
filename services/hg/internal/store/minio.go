package store

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/shaiknoorullah/hg-mono/services/hg/internal/config"
)

// MinIO is the object-store client (P-27) plus the address it actually dialled.
type MinIO struct {
	// Client talks to the store over the internal network (minio:9000). It is
	// for server-side calls only; a link it signed would name a host no phone
	// can reach.
	Client *minio.Client
	// Signer only signs. It is configured for the public host phones reach
	// (config.MinIO.PresignBaseURL) and never opens a connection: see NewSigner.
	Signer *minio.Client

	rec      *addrRecorder
	endpoint string
	secure   bool
}

func openMinIO(ctx context.Context, cfg config.MinIO) (*MinIO, error) {
	rec := newAddrRecorder()
	transport := &http.Transport{
		DialContext:           rec.DialContext,
		MaxIdleConns:          64,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 5 * time.Second,
	}

	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:     credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure:    cfg.UseSSL,
		Region:    cfg.Region,
		Transport: transport,
	})
	if err != nil {
		return nil, err
	}

	signer, err := NewSigner(cfg)
	if err != nil {
		return nil, err
	}

	listCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := client.ListBuckets(listCtx); err != nil {
		return nil, err
	}
	return &MinIO{Client: client, Signer: signer, rec: rec, endpoint: cfg.Endpoint, secure: cfg.UseSSL}, nil
}

// NewSigner builds the client that mints presigned links. A SigV4 signature
// covers the Host header, so the host must be the public one at signing time;
// rewriting the host of a link signed for minio:9000 breaks the signature.
//
// Signing is offline. The region is fixed, so the client never asks the store
// for a bucket's location, and its transport refuses every request, so the
// signer cannot be used by mistake for a server-side call that should stay on
// the internal network. Path-style addressing keeps the bucket in the path,
// where the proxy in front of the store expects it.
func NewSigner(cfg config.MinIO) (*minio.Client, error) {
	if cfg.Region == "" {
		return nil, errors.New("minio signer: a region is required so that signing never calls the store")
	}
	u, err := url.Parse(cfg.PresignBaseURL)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("minio signer: presign base URL %q is not scheme://host", cfg.PresignBaseURL)
	}
	return minio.New(u.Host, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure:       u.Scheme == "https",
		Region:       cfg.Region,
		BucketLookup: minio.BucketLookupPath,
		Transport:    refuseTransport{},
	})
}

// refuseTransport fails every request. The signer only signs.
type refuseTransport struct{}

func (refuseTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return nil, fmt.Errorf("minio signer: refusing %s %s — the signing client never sends requests; use MinIO.Client", r.Method, r.URL.Host)
}

// RemoteAddr returns the peer address of the last connection the client dialled.
func (m *MinIO) RemoteAddr() string {
	if m == nil || m.rec == nil {
		return ""
	}
	return m.rec.get()
}

func (m *MinIO) check(ctx context.Context, cfg config.MinIO) Dependency {
	d := Dependency{Name: DepMinIO, ConfiguredAddress: cfg.Endpoint}
	if m == nil || m.Client == nil {
		d.Detail = errNotOpen.Error()
		return d
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	start := time.Now()
	_, err := m.Client.ListBuckets(ctx)
	d.Latency = time.Since(start)
	d.ResolvedAddress = m.RemoteAddr()
	if err != nil {
		d.Detail = err.Error()
		return d
	}
	d.Connected = true
	return d
}

// probeBucketPrivacy is the P-27 boot probe, and it is not decorative: the
// previous platform kept restaurant licences, owner IDs and halal certificates
// in a bucket that was world-readable *and* world-writable.
//
// For each private bucket it asserts (a) the bucket exists, (b) it carries no
// anonymous access policy, and (c) an unauthenticated GET of a canary object is
// refused rather than served. Any anonymous success is a probe failure, which
// FatalProbeError turns into a non-zero exit outside local.
func (m *MinIO) probeBucketPrivacy(ctx context.Context, cfg config.MinIO) []Probe {
	if m == nil || m.Client == nil {
		return []Probe{{Name: ProbeBucketPrivacy, Detail: errNotOpen.Error()}}
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	var failures []string
	for _, bucket := range cfg.Buckets.Private() {
		exists, err := m.Client.BucketExists(ctx, bucket)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", bucket, err))
			continue
		}
		if !exists {
			failures = append(failures, fmt.Sprintf("%s: bucket does not exist", bucket))
			continue
		}
		policy, err := m.Client.GetBucketPolicy(ctx, bucket)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%s: reading policy: %v", bucket, err))
			continue
		}
		if strings.Contains(policy, `"*"`) || strings.Contains(policy, "AllUsers") {
			failures = append(failures, fmt.Sprintf(
				"%s: carries an anonymous access policy — this bucket must be private", bucket))
			continue
		}
		if err := m.assertAnonymousReadRefused(ctx, bucket); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", bucket, err))
		}
	}

	p := Probe{Name: ProbeBucketPrivacy}
	if len(failures) == 0 {
		p.Passed = true
		p.Detail = fmt.Sprintf("%d private bucket(s) verified", len(cfg.Buckets.Private()))
		return []Probe{p}
	}
	p.Detail = strings.Join(failures, "; ")
	return []Probe{p}
}

// assertAnonymousReadRefused performs a credential-free GET of a canary key.
// A 200 means the bucket serves objects to the internet.
func (m *MinIO) assertAnonymousReadRefused(ctx context.Context, bucket string) error {
	scheme := "http"
	if m.secure {
		scheme = "https"
	}
	u := url.URL{
		Scheme: scheme,
		Host:   m.endpoint,
		Path:   "/" + bucket + "/hg-privacy-canary",
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{
		Timeout:   5 * time.Second,
		Transport: &http.Transport{DialContext: m.rec.DialContext},
	}
	resp, err := client.Do(req)
	if err != nil {
		// The probe could not run. Report it rather than passing by default.
		return fmt.Errorf("anonymous read probe could not run: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
		_ = resp.Body.Close()
	}()

	if resp.StatusCode == http.StatusOK {
		return fmt.Errorf("an unauthenticated GET returned 200 — the bucket is publicly readable")
	}
	return nil
}
