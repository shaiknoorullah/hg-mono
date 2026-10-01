package files

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"time"
)

// Verdict is what the virus scanner concluded about one file. Each value maps
// one-to-one onto stored_object.virus_scan_state; a scanner that could not
// reach a conclusion returns an error instead, and the file stays PENDING.
type Verdict string

const (
	// VerdictClean: the scanner read the whole file and found nothing.
	VerdictClean Verdict = "CLEAN"
	// VerdictInfected: the scanner matched a signature; the detail names it.
	VerdictInfected Verdict = "INFECTED"
	// VerdictTooLarge: the file is bigger than the scanner will read, so it was
	// never fully scanned. Flagged, never passed: an unscanned tail could hide
	// anything.
	VerdictTooLarge Verdict = "TOO_LARGE"
)

// Scanner scans a stream of bytes. A nil error means the verdict is final; an
// error means the scanner could not be asked (down, timed out, garbled reply)
// and the caller must try again later.
type Scanner interface {
	Scan(ctx context.Context, r io.Reader) (Verdict, string, error)
}

// ClamdScanner talks to clamd over TCP using the INSTREAM command:
//
//	zINSTREAM\0  then  <uint32 big-endian length><bytes> ...  then  <0x00000000>
//
// and reads one NUL-terminated reply: "stream: OK", "stream: <signature>
// FOUND", or "INSTREAM size limit exceeded. ERROR" when the stream passes
// clamd's StreamMaxLength. The protocol is small enough that a dependency would
// add more surface than it saves. Reference:
// https://docs.clamav.net/manual/Usage/Scanning.html#clamd (the INSTREAM
// command).
type ClamdScanner struct {
	addr    string
	timeout time.Duration
	dial    func(ctx context.Context, network, addr string) (net.Conn, error)
}

// NewClamdScanner returns a scanner for the clamd at addr (host:port). timeout
// bounds one whole scan: dial, stream and reply.
func NewClamdScanner(addr string, timeout time.Duration) *ClamdScanner {
	var d net.Dialer
	return &ClamdScanner{addr: addr, timeout: timeout, dial: d.DialContext}
}

// instreamChunk is the size of each INSTREAM chunk. It must stay below clamd's
// StreamMaxLength; 64 KiB keeps memory flat for any file size.
const instreamChunk = 64 << 10

// replyTooLarge is clamd's answer when the stream exceeds StreamMaxLength.
const replyTooLarge = "INSTREAM size limit exceeded"

// Scan streams r to clamd and returns its verdict.
func (c *ClamdScanner) Scan(ctx context.Context, r io.Reader) (Verdict, string, error) {
	if c.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.timeout)
		defer cancel()
	}
	conn, err := c.dial(ctx, "tcp", c.addr)
	if err != nil {
		return "", "", fmt.Errorf("clamd: dial %s: %w", c.addr, err)
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}

	srcErr, connErr := streamInstream(conn, r)
	if srcErr != nil {
		// The input failed, not clamd. The stream was never terminated, so there
		// is no verdict to wait for.
		return "", "", fmt.Errorf("clamd: read input: %w", srcErr)
	}
	// clamd answers as soon as it has a verdict — including mid-stream, when the
	// size limit trips, after which it stops reading and our writes fail. So read
	// the reply even when writing failed; only a missing reply is an error.
	reply, readErr := bufio.NewReader(conn).ReadString(0)
	reply = strings.TrimSpace(strings.TrimRight(reply, "\x00"))
	if reply == "" {
		if connErr != nil {
			return "", "", fmt.Errorf("clamd: stream: %w", connErr)
		}
		return "", "", fmt.Errorf("clamd: no reply: %w", readErr)
	}
	return parseClamdReply(reply)
}

// streamInstream writes the INSTREAM command, r in length-prefixed chunks, and
// the zero-length terminator. It reports a failure reading r apart from a
// failure writing to clamd, because only the second can still have a reply.
func streamInstream(w io.Writer, r io.Reader) (srcErr, connErr error) {
	if _, err := io.WriteString(w, "zINSTREAM\x00"); err != nil {
		return nil, err
	}
	buf := make([]byte, 4+instreamChunk)
	for {
		n, err := io.ReadFull(r, buf[4:])
		if n > 0 {
			binary.BigEndian.PutUint32(buf[:4], uint32(n))
			if _, werr := w.Write(buf[:4+n]); werr != nil {
				return nil, werr
			}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			break
		}
		if err != nil {
			return err, nil
		}
	}
	_, err := w.Write([]byte{0, 0, 0, 0})
	return nil, err
}

// parseClamdReply turns one clamd reply line into a verdict. Anything that is
// not a clear OK, FOUND or size-limit answer is an error, so the file waits
// for a scanner that can answer rather than being passed on a guess.
func parseClamdReply(reply string) (Verdict, string, error) {
	switch {
	case strings.HasPrefix(reply, replyTooLarge):
		return VerdictTooLarge, reply, nil
	case strings.HasSuffix(reply, " ERROR"):
		return "", "", fmt.Errorf("clamd: %s", reply)
	}
	body := strings.TrimPrefix(reply, "stream: ")
	switch {
	case body == "OK":
		return VerdictClean, "", nil
	case strings.HasSuffix(body, " FOUND"):
		return VerdictInfected, strings.TrimSuffix(body, " FOUND"), nil
	}
	return "", "", fmt.Errorf("clamd: unrecognised reply %q", reply)
}
