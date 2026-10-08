package devworld

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Pictures for the catalogue. Photos are freely licensed images from
// Wikimedia Commons, listed with their author and licence in
// catalogue_photos.json. The repository holds only that list: the reset
// downloads each photo once into a cache outside the repository and uploads it
// to the local public media bucket. A photo that cannot be fetched is replaced
// by a generated picture, and so is every logo, so a reset without network
// still gives every restaurant and most dishes an image.

//go:embed catalogue_photos.json
var photoManifestJSON []byte

// Photo is one attributed photo.
type Photo struct {
	File       string `json:"file"`
	Page       string `json:"page"`
	URL        string `json:"url"`
	Author     string `json:"author"`
	Licence    string `json:"licence"`
	LicenceURL string `json:"licence_url"`
}

type photoManifest struct {
	Note   string           `json:"note"`
	Photos map[string]Photo `json:"photos"`
}

// PhotoManifest returns the attributed photos by key.
func PhotoManifest() (map[string]Photo, error) {
	var m photoManifest
	if err := json.Unmarshal(photoManifestJSON, &m); err != nil {
		return nil, fmt.Errorf("devworld: photo manifest: %w", err)
	}
	return m.Photos, nil
}

const photoUserAgent = "hg-mono-devworld/1.0 (https://github.com/shaiknoorullah/hg-mono; local development seed)"

// SeedImages uploads the catalogue's hero, logo and dish pictures to the local
// media bucket and attaches them. It needs HG_MINIO_ENDPOINT and its keys; an
// unset or non-local endpoint, or a missing bucket, skips the step with a
// message rather than failing the reset: pictures are a convenience, and a
// missing picture renders as the contract's placeholder.
func SeedImages(ctx context.Context, dsn string) error {
	endpoint := strings.TrimSpace(os.Getenv("HG_MINIO_ENDPOINT"))
	if endpoint == "" {
		fmt.Fprintln(os.Stderr, "devworld: images skipped (HG_MINIO_ENDPOINT is not set)")
		return nil
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		host = endpoint
	}
	if !LocalDBHost(host) && host != "minio" {
		fmt.Fprintf(os.Stderr, "devworld: images skipped (object store %q is not local)\n", host)
		return nil
	}
	client, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(os.Getenv("HG_MINIO_ACCESS_KEY"), os.Getenv("HG_MINIO_SECRET_KEY"), ""),
		Secure: os.Getenv("HG_MINIO_USE_SSL") == "true",
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "devworld: images skipped (%v)\n", err)
		return nil
	}
	bucket := os.Getenv("HG_MINIO_BUCKET_MEDIA")
	if bucket == "" {
		bucket = "hg-media"
	}
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	ok, err := client.BucketExists(checkCtx, bucket)
	cancel()
	if err != nil || !ok {
		fmt.Fprintf(os.Stderr, "devworld: images skipped (bucket %s is not reachable: %v)\n", bucket, err)
		return nil
	}

	manifest, err := PhotoManifest()
	if err != nil {
		return err
	}
	photos := fetchPhotos(ctx, manifest)

	conn, err := connect(ctx, dsn)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	var uploaded, generated int
	for _, r := range Catalogue {
		jobs := []imageJob{{kind: "hero", key: r.Hero}, {kind: "logo", key: "logo"}}
		for _, c := range r.Categories {
			for _, it := range c.Items {
				if it.Photo == "" {
					continue
				}
				_, versionID := r.ItemIDs(it)
				jobs = append(jobs, imageJob{kind: "item", key: it.Key, photo: it.Photo, versionID: versionID})
			}
		}
		for _, j := range jobs {
			var body []byte
			ctype, ext := "image/jpeg", "jpg"
			switch {
			case j.kind == "logo":
				body = logoPNG(r.Name, r.Palette)
				ctype, ext = "image/png", "png"
			default:
				key := j.photo
				if j.kind == "hero" {
					key = j.key
				}
				body = photos[key]
				if body == nil {
					body = placeholderPNG(key, r.Palette)
					ctype, ext = "image/png", "png"
					generated++
				}
			}
			objectKey := fmt.Sprintf("devworld/%s/%s-%s.%s", r.Slug, j.kind, j.key, ext)
			if _, err := client.PutObject(ctx, bucket, objectKey, bytes.NewReader(body), int64(len(body)),
				minio.PutObjectOptions{ContentType: ctype, CacheControl: "public, max-age=86400"}); err != nil {
				return fmt.Errorf("devworld: upload %s: %w", objectKey, err)
			}
			objID := catalogueID(r.Slug, "image", j.kind, j.key)
			sum := sha256.Sum256(body)
			if _, err := conn.Exec(ctx, `
				INSERT INTO stored_object (
				  id, bucket, object_key, purpose, owner_account_id, restaurant_id,
				  content_type, byte_size, sha256, state, virus_scan_state, uploaded_by, confirmed_at
				) VALUES ($1, $2, $3, 'MENU_IMAGE', $4, $5, $6, $7, $8, 'READY', 'CLEAN', $4, now())
				ON CONFLICT (id) DO UPDATE SET object_key = EXCLUDED.object_key, content_type = EXCLUDED.content_type,
				  byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256, state = 'READY', confirmed_at = now()`,
				objID, bucket, objectKey, catalogueAdminID, r.ID, ctype, len(body), sum[:]); err != nil {
				return fmt.Errorf("devworld: record %s: %w", objectKey, err)
			}
			var q string
			target := r.ID
			switch j.kind {
			case "hero":
				q = `UPDATE restaurant SET cover_object_id = $2 WHERE id = $1`
			case "logo":
				q = `UPDATE restaurant SET logo_object_id = $2 WHERE id = $1`
			default:
				q = `UPDATE menu_item_version SET image_object_id = $2 WHERE id = $1`
				target = j.versionID
			}
			if _, err := conn.Exec(ctx, q, target, objID); err != nil {
				return fmt.Errorf("devworld: attach %s: %w", objectKey, err)
			}
			uploaded++
		}
	}
	fmt.Fprintf(os.Stderr, "devworld: images %d uploaded to %s (%d photos fetched or cached, %d generated stand-ins)\n",
		uploaded, bucket, len(photos), generated)
	return nil
}

type imageJob struct {
	kind      string // hero, logo, item
	key       string
	photo     string
	versionID string
}

// photoCacheDir is where downloaded photos are kept between resets. It is
// outside the repository: the photos are never committed.
func photoCacheDir() string {
	if dir := os.Getenv("HG_DEVWORLD_PHOTO_CACHE"); dir != "" {
		return dir
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = os.TempDir()
	}
	return filepath.Join(base, "hg-devworld", "photos")
}

// fetchPhotos returns the bytes of every manifest photo it could load from the
// cache or download. HG_DEVWORLD_PHOTOS=off skips the network.
func fetchPhotos(ctx context.Context, manifest map[string]Photo) map[string][]byte {
	dir := photoCacheDir()
	_ = os.MkdirAll(dir, 0o755)
	offline := os.Getenv("HG_DEVWORLD_PHOTOS") == "off"
	client := &http.Client{Timeout: 40 * time.Second}

	out := map[string][]byte{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	var failures []string
	for key, p := range manifest {
		wg.Add(1)
		go func(key string, p Photo) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			path := filepath.Join(dir, key+".jpg")
			body, err := os.ReadFile(path)
			if err != nil || !isJPEG(body) {
				if offline {
					return
				}
				body, err = download(ctx, client, p.URL)
				if err != nil {
					mu.Lock()
					failures = append(failures, key)
					mu.Unlock()
					return
				}
				tmp := path + ".tmp"
				if os.WriteFile(tmp, body, 0o644) == nil {
					_ = os.Rename(tmp, path)
				}
			}
			mu.Lock()
			out[key] = body
			mu.Unlock()
		}(key, p)
	}
	wg.Wait()
	if len(failures) > 0 {
		fmt.Fprintf(os.Stderr, "devworld: %d photos could not be downloaded; generated pictures stand in (%s)\n",
			len(failures), strings.Join(failures, ", "))
	}
	return out
}

func download(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(attempt*2) * time.Second):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", photoUserAgent)
		res, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
		res.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if res.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("http %d", res.StatusCode)
			continue
		}
		if !isJPEG(body) {
			return nil, errors.New("not a JPEG")
		}
		return body, nil
	}
	return nil, lastErr
}

func isJPEG(b []byte) bool {
	if len(b) < 1024 {
		return false
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(b))
	return err == nil && format == "jpeg" && cfg.Width >= 300
}

// Keep the jpeg decoder registered for DecodeConfig.
var _ = jpeg.Decode
