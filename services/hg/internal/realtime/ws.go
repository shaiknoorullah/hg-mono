package realtime

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// The WebSocket transport is implemented against RFC 6455 with the standard
// library only. The service has no vendored WebSocket dependency and this
// environment cannot fetch one, so the handshake and the frame codec live here.
// It is deliberately minimal: text and binary data frames, ping/pong, close, and
// the mask handling a compliant server must perform on client frames.

// wsGUID is the RFC 6455 magic value concatenated to Sec-WebSocket-Key.
const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// wsOpcode is a frame opcode.
type wsOpcode byte

const (
	opContinuation wsOpcode = 0x0
	opText         wsOpcode = 0x1
	opBinary       wsOpcode = 0x2
	opClose        wsOpcode = 0x8
	opPing         wsOpcode = 0x9
	opPong         wsOpcode = 0xA
)

// maxFrameBytes is the §1.4 limit: 64 KiB. A client frame larger than this is a
// protocol error and closes the socket.
const maxFrameBytes = 64 << 10

// wsConn is a single upgraded WebSocket connection. Writes are serialised behind
// a mutex because the read loop, the heartbeat and the fan-out all write.
type wsConn struct {
	raw net.Conn
	br  *bufio.Reader

	wmu    sync.Mutex
	closed bool
	cmu    sync.Mutex
}

// acceptKey computes the Sec-WebSocket-Accept response value for a client key.
func acceptKey(key string) string {
	h := sha1.New()
	_, _ = io.WriteString(h, key+wsGUID)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// upgrade performs the RFC 6455 opening handshake on an HTTP request, hijacking
// the connection. It returns a wsConn ready for framed reads and writes.
//
// The caller has already resolved identity from the ticket; upgrade does not
// look at identity at all. Sec-WebSocket-Protocol negotiation echoes "hg.v1"
// when the client offered it (the native bearer sub-protocol path), which the
// browser and native clients both send.
func upgrade(w http.ResponseWriter, r *http.Request) (*wsConn, error) {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return nil, errors.New("not a websocket upgrade")
	}
	if !headerContainsToken(r.Header.Get("Connection"), "upgrade") {
		return nil, errors.New("missing Connection: upgrade")
	}
	if r.Header.Get("Sec-WebSocket-Version") != "13" {
		return nil, errors.New("unsupported websocket version")
	}
	key := strings.TrimSpace(r.Header.Get("Sec-WebSocket-Key"))
	if key == "" {
		return nil, errors.New("missing Sec-WebSocket-Key")
	}

	hj, ok := w.(http.Hijacker)
	if !ok {
		return nil, errors.New("response writer does not support hijacking")
	}
	conn, brw, err := hj.Hijack()
	if err != nil {
		return nil, fmt.Errorf("hijack: %w", err)
	}

	var b strings.Builder
	b.WriteString("HTTP/1.1 101 Switching Protocols\r\n")
	b.WriteString("Upgrade: websocket\r\n")
	b.WriteString("Connection: Upgrade\r\n")
	b.WriteString("Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n")
	// Echo the hg.v1 sub-protocol when offered so a native client's
	// "hg.v1, bearer.<jwt>" negotiation completes.
	if proto := negotiateSubprotocol(r.Header.Get("Sec-WebSocket-Protocol")); proto != "" {
		b.WriteString("Sec-WebSocket-Protocol: " + proto + "\r\n")
	}
	b.WriteString("\r\n")

	if _, err := brw.WriteString(b.String()); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("write handshake: %w", err)
	}
	if err := brw.Flush(); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("flush handshake: %w", err)
	}
	return &wsConn{raw: conn, br: brw.Reader}, nil
}

// negotiateSubprotocol returns "hg.v1" when the client offered it, else "".
func negotiateSubprotocol(header string) string {
	for _, p := range strings.Split(header, ",") {
		if strings.TrimSpace(p) == "hg.v1" {
			return "hg.v1"
		}
	}
	return ""
}

func headerContainsToken(header, token string) bool {
	for _, p := range strings.Split(header, ",") {
		if strings.EqualFold(strings.TrimSpace(p), token) {
			return true
		}
	}
	return false
}

// readMessage reads one complete data message, coalescing continuation frames
// and answering control frames (ping→pong, close→close). It returns the opcode
// of the data message and its payload. Control frames are handled internally and
// do not surface except close, which returns io.EOF.
func (c *wsConn) readMessage() (wsOpcode, []byte, error) {
	var msg []byte
	var dataOp wsOpcode
	assembling := false

	for {
		fin, op, payload, err := c.readFrame()
		if err != nil {
			return 0, nil, err
		}
		switch op {
		case opPing:
			if err := c.writeControl(opPong, payload); err != nil {
				return 0, nil, err
			}
			continue
		case opPong:
			// A client pong to our ping. Surface it so the gateway can clear the
			// heartbeat deadline.
			return opPong, payload, nil
		case opClose:
			_ = c.writeControl(opClose, payload)
			return 0, nil, io.EOF
		case opText, opBinary:
			if assembling {
				return 0, nil, errors.New("new data frame before previous message finished")
			}
			dataOp = op
			msg = append(msg, payload...)
			if fin {
				return dataOp, msg, nil
			}
			assembling = true
		case opContinuation:
			if !assembling {
				return 0, nil, errors.New("continuation without a start frame")
			}
			msg = append(msg, payload...)
			if len(msg) > maxFrameBytes {
				return 0, nil, errors.New("message exceeds 64 KiB")
			}
			if fin {
				return dataOp, msg, nil
			}
		default:
			return 0, nil, fmt.Errorf("unknown opcode %d", op)
		}
	}
}

// readFrame reads a single RFC 6455 frame from a client. Client frames MUST be
// masked; an unmasked client frame is a protocol error.
func (c *wsConn) readFrame() (fin bool, op wsOpcode, payload []byte, err error) {
	var h [2]byte
	if _, err = io.ReadFull(c.br, h[:]); err != nil {
		return
	}
	fin = h[0]&0x80 != 0
	op = wsOpcode(h[0] & 0x0f)
	masked := h[1]&0x80 != 0
	length := uint64(h[1] & 0x7f)

	switch length {
	case 126:
		var ext [2]byte
		if _, err = io.ReadFull(c.br, ext[:]); err != nil {
			return
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err = io.ReadFull(c.br, ext[:]); err != nil {
			return
		}
		length = binary.BigEndian.Uint64(ext[:])
	}
	if length > maxFrameBytes {
		err = fmt.Errorf("frame length %d exceeds 64 KiB", length)
		return
	}
	if !masked {
		// RFC 6455 §5.1: a server must close on an unmasked client frame.
		err = errors.New("client frame is not masked")
		return
	}
	var mask [4]byte
	if _, err = io.ReadFull(c.br, mask[:]); err != nil {
		return
	}
	payload = make([]byte, length)
	if _, err = io.ReadFull(c.br, payload); err != nil {
		return
	}
	for i := range payload {
		payload[i] ^= mask[i&3]
	}
	return
}

// writeText writes a text data message (server frames are never masked).
func (c *wsConn) writeText(b []byte) error {
	return c.writeFrame(opText, b)
}

// writeControl writes a control frame (ping/pong/close). Payload must be <= 125.
func (c *wsConn) writeControl(op wsOpcode, payload []byte) error {
	if len(payload) > 125 {
		payload = payload[:125]
	}
	return c.writeFrame(op, payload)
}

func (c *wsConn) writeFrame(op wsOpcode, payload []byte) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.isClosed() {
		return net.ErrClosed
	}

	var head []byte
	b0 := byte(0x80) | byte(op) // FIN set; the server never fragments
	n := len(payload)
	switch {
	case n <= 125:
		head = []byte{b0, byte(n)}
	case n <= 0xffff:
		head = []byte{b0, 126, 0, 0}
		binary.BigEndian.PutUint16(head[2:], uint16(n))
	default:
		head = make([]byte, 10)
		head[0] = b0
		head[1] = 127
		binary.BigEndian.PutUint64(head[2:], uint64(n))
	}

	_ = c.raw.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if _, err := c.raw.Write(head); err != nil {
		return err
	}
	if _, err := c.raw.Write(payload); err != nil {
		return err
	}
	return nil
}

// writeClose sends a close frame with the given code and reason, then closes the
// socket. Codes are the §1.5 application codes (1000, 1001, 4400, 4401, …).
func (c *wsConn) writeClose(code int, reason string) error {
	body := make([]byte, 2+len(reason))
	binary.BigEndian.PutUint16(body, uint16(code))
	copy(body[2:], reason)
	err := c.writeControl(opClose, body)
	c.close()
	return err
}

func (c *wsConn) writePing() error {
	var t [8]byte
	binary.BigEndian.PutUint64(t[:], uint64(time.Now().UnixMilli()))
	return c.writeControl(opPing, t[:])
}

// setReadDeadline bounds a single read so a silent peer cannot pin a goroutine.
func (c *wsConn) setReadDeadline(t time.Time) { _ = c.raw.SetReadDeadline(t) }

func (c *wsConn) isClosed() bool {
	c.cmu.Lock()
	defer c.cmu.Unlock()
	return c.closed
}

func (c *wsConn) close() {
	c.cmu.Lock()
	already := c.closed
	c.closed = true
	c.cmu.Unlock()
	if !already {
		_ = c.raw.Close()
	}
}
