package files

import (
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// eicar is the industry-standard antivirus test string. Real scanners report
// it as infected; the fake below does the same.
const eicar = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

// fakeClamd is the server side of clamd's INSTREAM command. It reassembles the
// length-prefixed chunks and answers the way clamd does: "stream: OK",
// "stream: <signature> FOUND", or — once more than limit bytes arrive — the
// size-limit error, which it sends without waiting for the rest of the stream.
type fakeClamd struct {
	addr  string
	limit int

	mu   sync.Mutex
	got  []byte // the last stream, reassembled
	cmds []string
}

func startFakeClamd(t *testing.T, limit int) *fakeClamd {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	f := &fakeClamd{addr: ln.Addr().String(), limit: limit}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return f
}

func (f *fakeClamd) serve(conn net.Conn) {
	defer conn.Close()
	cmd := make([]byte, len("zINSTREAM\x00"))
	if _, err := io.ReadFull(conn, cmd); err != nil {
		return
	}
	var got []byte
	reply := "stream: OK"
	for {
		var size [4]byte
		if _, err := io.ReadFull(conn, size[:]); err != nil {
			return
		}
		n := binary.BigEndian.Uint32(size[:])
		if n == 0 {
			break
		}
		chunk := make([]byte, n)
		if _, err := io.ReadFull(conn, chunk); err != nil {
			return
		}
		got = append(got, chunk...)
		if len(got) > f.limit {
			reply = "INSTREAM size limit exceeded. ERROR"
			break
		}
	}
	if reply == "stream: OK" && bytes.Contains(got, []byte(eicar)) {
		reply = "stream: Eicar-Test-Signature FOUND"
	}
	f.mu.Lock()
	f.got, f.cmds = got, append(f.cmds, string(cmd))
	f.mu.Unlock()
	_, _ = conn.Write([]byte(reply + "\x00"))
	// Drain whatever the client is still sending before hanging up, so the close
	// is a FIN and not a reset that could race the reply.
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _ = io.Copy(io.Discard, conn)
}

// The scanner speaks INSTREAM correctly — the bytes clamd reassembles are the
// bytes sent, across many chunks — and maps every clamd answer to the right
// verdict. A wrong mapping here is a virus approved or a clean file blocked.
func TestClamdScannerVerdicts(t *testing.T) {
	const limit = 1 << 20
	f := startFakeClamd(t, limit)
	s := NewClamdScanner(f.addr, 5*time.Second)
	ctx := context.Background()

	clean := bytes.Repeat([]byte("%PDF-1.7 clean "), 20_000) // ~300 KiB: several chunks
	cases := []struct {
		name       string
		data       []byte
		want       Verdict
		wantDetail string
	}{
		{"clean, multi-chunk", clean, VerdictClean, ""},
		{"infected", append([]byte("%PDF-1.7\n"), eicar...), VerdictInfected, "Eicar-Test-Signature"},
		{"over clamd's stream limit", make([]byte, limit+instreamChunk), VerdictTooLarge, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v, detail, err := s.Scan(ctx, bytes.NewReader(c.data))
			if err != nil {
				t.Fatalf("Scan: %v", err)
			}
			if v != c.want {
				t.Fatalf("verdict = %s, want %s", v, c.want)
			}
			if c.wantDetail != "" && detail != c.wantDetail {
				t.Errorf("detail = %q, want %q", detail, c.wantDetail)
			}
		})
	}

	// Framing: what clamd reassembled is exactly what was sent, under the
	// z-prefixed (NUL-terminated) INSTREAM command.
	if _, _, err := s.Scan(ctx, bytes.NewReader(clean)); err != nil {
		t.Fatalf("Scan: %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if last := f.cmds[len(f.cmds)-1]; last != "zINSTREAM\x00" {
		t.Errorf("command = %q, want zINSTREAM", last)
	}
	if !bytes.Equal(f.got, clean) {
		t.Errorf("clamd reassembled %d bytes, want the %d sent", len(f.got), len(clean))
	}
}

// A scanner that cannot be reached is an error, never a verdict: the file must
// wait, not pass.
func TestClamdScannerDownIsAnError(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close() // nothing listens here now

	v, _, err := NewClamdScanner(addr, time.Second).Scan(context.Background(), bytes.NewReader([]byte("x")))
	if err == nil {
		t.Fatalf("Scan against a closed port returned verdict %q; want an error", v)
	}
}
