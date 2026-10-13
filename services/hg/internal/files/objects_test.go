package files

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

// siloImage is the object store the compose file runs (deploy/docker-compose.yml,
// service "minio"), pinned to the same release and digest.
const siloImage = "docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z@sha256:635197cb9f36d01bee221d34d1c7d7960f6a95c48b0b6c01d99cd13bdae51a46"

// TestRemoveDeletesEveryVersionOnAVersionedBucket pins the privacy promise of
// rejecting an upload: the bytes are gone, not kept as an old version.
//
// Every bucket is versioned (the object storage row of
// https://github.com/shaiknoorullah/hg-mono/blob/main/docs/decisions/README.md#settled--platform-decisions-owner-2026-10-01).
// On a versioned bucket a plain delete only adds a delete marker, so a rejected
// KYC upload's bytes would stay stored for 35 more days. Remove must leave no
// version of the key at all, and must not touch another key that merely starts
// with the same characters.
func TestRemoveDeletesEveryVersionOnAVersionedBucket(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	client := startSilo(ctx, t)
	bucket := fmt.Sprintf("hg-kyc-test-%d", time.Now().UnixNano())
	if err := client.MakeBucket(ctx, bucket, minio.MakeBucketOptions{}); err != nil {
		t.Fatalf("make bucket: %v", err)
	}
	if err := client.EnableVersioning(ctx, bucket); err != nil {
		t.Fatalf("enable versioning: %v", err)
	}

	const key = "rider/r1/licence/01J0000000000000000000000.pdf"
	const sibling = key + ".bak"
	put := func(k, body string) {
		t.Helper()
		if _, err := client.PutObject(ctx, bucket, k, strings.NewReader(body), int64(len(body)),
			minio.PutObjectOptions{ContentType: "application/pdf"}); err != nil {
			t.Fatalf("put %s: %v", k, err)
		}
	}
	put(key, "first upload")
	put(key, "overwritten") // a second, noncurrent-making version
	put(sibling, "keep me")

	if err := NewMinIOObjectStore(client).Remove(ctx, bucket, key); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	var left, siblingVersions int
	for v := range client.ListObjects(ctx, bucket, minio.ListObjectsOptions{Prefix: key, WithVersions: true}) {
		if v.Err != nil {
			t.Fatalf("list versions: %v", v.Err)
		}
		switch v.Key {
		case key:
			left++
		case sibling:
			siblingVersions++
		}
	}
	if left != 0 {
		t.Errorf("%d versions (or delete markers) of the removed key are still stored, want none", left)
	}
	if siblingVersions != 1 {
		t.Errorf("the sibling key has %d versions after Remove, want it untouched (1)", siblingVersions)
	}
	obj, err := client.GetObject(ctx, bucket, sibling, minio.GetObjectOptions{})
	if err != nil {
		t.Fatalf("get sibling: %v", err)
	}
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(obj); err != nil || buf.String() != "keep me" {
		t.Errorf("sibling body = %q (err %v), want %q", buf.String(), err, "keep me")
	}
}

// startSilo returns a client for a Silo server: the one at HG_TEST_S3_ENDPOINT
// (host:port, with HG_TEST_S3_ACCESS_KEY and HG_TEST_S3_SECRET_KEY) when set,
// otherwise a container of the pinned image. It skips, rather than fails, when
// neither is available: a skipped integration test is information; a red suite
// on a machine without a daemon is noise.
func startSilo(ctx context.Context, t *testing.T) *minio.Client {
	t.Helper()
	if endpoint := os.Getenv("HG_TEST_S3_ENDPOINT"); endpoint != "" {
		client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(
			os.Getenv("HG_TEST_S3_ACCESS_KEY"), os.Getenv("HG_TEST_S3_SECRET_KEY"), "")})
		if err != nil {
			t.Fatalf("minio client: %v", err)
		}
		return client
	}
	if !dockerAvailable() {
		t.Skip("skipping: no Docker daemon reachable (set DOCKER_HOST, or set " +
			"HG_TEST_S3_ENDPOINT to run this test against an existing server)")
	}
	const user, pass = "hgtest", "hgtest-secret"
	c, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        siloImage,
			Cmd:          []string{"server", "/data"},
			Env:          map[string]string{"MINIO_ROOT_USER": user, "MINIO_ROOT_PASSWORD": pass},
			ExposedPorts: []string{"9000/tcp"},
			WaitingFor:   wait.ForHTTP("/minio/health/ready").WithPort("9000/tcp").WithStartupTimeout(2 * time.Minute),
		},
		Started: true,
	})
	if err != nil {
		t.Skipf("skipping: could not start the Silo container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(c); err != nil {
			t.Logf("terminating container: %v", err)
		}
	})
	endpoint, err := c.PortEndpoint(ctx, "9000/tcp", "")
	if err != nil {
		t.Fatalf("endpoint: %v", err)
	}
	client, err := minio.New(endpoint, &minio.Options{Creds: credentials.NewStaticV4(user, pass, "")})
	if err != nil {
		t.Fatalf("minio client: %v", err)
	}
	return client
}

// dockerAvailable is a cheap pre-check so an absent daemon costs a skip rather
// than a multi-minute timeout inside the container library.
func dockerAvailable() bool {
	if os.Getenv("DOCKER_HOST") != "" {
		return true
	}
	for _, sock := range []string{
		"/var/run/docker.sock",
		os.Getenv("HOME") + "/.docker/run/docker.sock",
		os.Getenv("XDG_RUNTIME_DIR") + "/docker.sock",
	} {
		if fi, err := os.Stat(sock); err == nil && fi.Mode()&os.ModeSocket != 0 {
			return true
		}
	}
	return false
}
