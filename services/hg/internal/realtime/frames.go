package realtime

import "encoding/json"

// Protocol is the envelope protocol version advertised in hello (contract §4.1).
const Protocol = 1

// HeartbeatSeconds is the server ping cadence (contract §1.4).
const HeartbeatSeconds = 25

// Envelope is the exact server → client message shape (contract §2). Control
// frames carry Seq: 0 and Channel: "".
type Envelope struct {
	ID      string          `json:"id"`
	Seq     int64           `json:"seq"`
	Channel string          `json:"channel"`
	Type    string          `json:"type"`
	V       int             `json:"v"`
	TS      string          `json:"ts"`
	Data    json.RawMessage `json:"data"`
}

// RelayMessage is the internal Redis fan-out payload: the client Envelope plus
// the event's audience. It never reaches the client — the gateway strips the
// audience and forwards only the Envelope, projected per viewer. Carrying the
// audience here lets each replica apply the §5 audience gate without a second
// Postgres read.
type RelayMessage struct {
	Audience []string `json:"audience"`
	Envelope Envelope `json:"envelope"`
}

// Inbound frame types — the complete vocabulary (contract §3.2). There are five,
// and none of them carries identity: there is no user_id/role/restaurant_id
// field to represent, so a client asserting identity is unrepresentable.
const (
	InSubscribe   = "subscribe"
	InUnsubscribe = "unsubscribe"
	InResume      = "resume"
	InReauth      = "reauth"
	InPong        = "pong"
)

// inboundFrame is decoded with DisallowUnknownFields so any unknown field on one
// of the five frames is rejected with error{code:"UNKNOWN_FIELD"} and the
// principal is left unchanged.
//
// The union is flat rather than per-type because the wire is flat; the gateway
// dispatches on Type and reads only the fields that type defines. Crucially,
// there is no user_id, role, restaurant_id or account_id member here — the
// schema cannot represent client-asserted identity.
type inboundFrame struct {
	Type        string `json:"type"`
	Channel     string `json:"channel,omitempty"`
	AfterSeq    *int64 `json:"after_seq,omitempty"`
	AccessToken string `json:"access_token,omitempty"`
	T           *int64 `json:"t,omitempty"`
}

// Control-frame type names (contract §4.1), SCREAMING for none of them — these
// are lower_snake wire types, not ErrorCode.
const (
	CtrlHello          = "hello"
	CtrlSubscribed     = "subscribed"
	CtrlUnsubscribed   = "unsubscribed"
	CtrlSubscribeError = "subscribe_error"
	CtrlResumeComplete = "resume_complete"
	CtrlPing           = "ping"
	CtrlPong           = "pong"
	CtrlError          = "error"
	CtrlReauthRequired = "reauth_required"
)

// helloData is the hello control payload (contract §4.1).
type helloData struct {
	AccountID       string      `json:"account_id"`
	Roles           []helloRole `json:"roles"`
	SessionID       string      `json:"session_id"`
	AllowedChannels []string    `json:"allowed_channels"`
	ServerTime      string      `json:"server_time"`
	HeartbeatS      int         `json:"heartbeat_s"`
	Protocol        int         `json:"protocol"`
}

// helloRole is one {r, s} pair: a role and its optional scope id.
type helloRole struct {
	R string  `json:"r"`
	S *string `json:"s"`
}

// subscribedData tells a fresh subscriber the current head so it knows where it
// starts (contract §4.1).
type subscribedData struct {
	Channel   string `json:"channel"`
	CursorSeq int64  `json:"cursor_seq"`
}

// Unsubscribe reasons — the closed set (contract §4.1).
const (
	ReasonClientRequest = "client_request"
	ReasonNoLongerAuth  = "no_longer_authorized"
	ReasonOrderTerminal = "order_terminal"
)

type unsubscribedData struct {
	Channel string `json:"channel"`
	Reason  string `json:"reason"`
}

// subscribe_error codes — its OWN closed, lower-case set, deliberately NOT
// ErrorCode (contract §4.1).
const (
	SubErrNotFound       = "not_found"
	SubErrForbidden      = "forbidden"
	SubErrSubLimit       = "subscription_limit"
	SubErrInvalidChannel = "invalid_channel"
)

type subscribeErrorData struct {
	Channel string `json:"channel"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type resumeCompleteData struct {
	Channel   string `json:"channel"`
	FromSeq   int64  `json:"from_seq"`
	ToSeq     int64  `json:"to_seq"`
	Replayed  int    `json:"replayed"`
	Truncated bool   `json:"truncated"`
}

type pingData struct {
	T int64 `json:"t"`
}

// errorData is the SCREAMING_SNAKE error control payload (contract §4.1). code is
// a member of the contract's ErrorCode enum — never subscribe_error's set.
type errorData struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

// Error codes carried on the error control frame. These are the two the socket
// itself raises; both are members of ErrorCode in openapi.yaml.
const (
	ErrCodeUnknownField     = "UNKNOWN_FIELD"
	ErrCodeValidationFailed = "VALIDATION_FAILED"
	ErrCodeRateLimited      = "RATE_LIMITED"
)

type reauthRequiredData struct {
	Deadline string `json:"deadline"`
}

// WebSocket close codes (contract §1.5).
const (
	CloseNormal         = 1000
	CloseGoingAway      = 1001
	CloseTryAgainLater  = 1013 // slow_consumer, at_capacity or connection_limit: reconnect, then resume
	CloseMalformedFrame = 4400
	CloseUnauthorized   = 4401 // session_revoked, reauth_timeout, ticket invalid
	CloseOriginNotAllow = 4403
	CloseFrameFlood     = 4429
)
