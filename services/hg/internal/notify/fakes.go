package notify

import (
	"context"
	"fmt"
	"sync"

	"github.com/google/uuid"
)

// FakeSend is one recorded call, common to every fake sender below. Tests
// assert against a fake's Sends slice rather than a live provider.
type FakeSend struct {
	Target         string
	Message        Message
	IdempotencyKey string
}

// FakeChannelSender is an in-memory ChannelSender for local dev and tests.
// It never talks to the network: Send just records the call and returns a
// synthetic provider message id, unless FailNext/FailAlways is set, in which
// case it returns Err. Safe for concurrent use.
type FakeChannelSender struct {
	mu    sync.Mutex
	Sends []FakeSend

	// FailAlways makes every Send fail with Err (or a default error).
	FailAlways bool
	// FailN makes the next N calls fail, then succeed. Useful for exercising
	// the failover/retry path deterministically.
	FailN int
	Err   error

	nextID int
}

// NewFakeSender returns a fake that always succeeds.
func NewFakeSender() *FakeChannelSender { return &FakeChannelSender{} }

// NewFailingFakeSender returns a fake whose every Send fails with err (or a
// default error if err is nil).
func NewFailingFakeSender(err error) *FakeChannelSender {
	return &FakeChannelSender{FailAlways: true, Err: err}
}

func (f *FakeChannelSender) Send(_ context.Context, target string, msg Message) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.Sends = append(f.Sends, FakeSend{Target: target, Message: msg, IdempotencyKey: msg.IdempotencyKey})

	shouldFail := f.FailAlways
	if f.FailN > 0 {
		shouldFail = true
		f.FailN--
	}
	if shouldFail {
		if f.Err != nil {
			return "", f.Err
		}
		return "", fmt.Errorf("notify: fake sender configured to fail")
	}

	f.nextID++
	return fmt.Sprintf("fake-%d", f.nextID), nil
}

// Count returns how many Send calls this fake has recorded.
func (f *FakeChannelSender) Count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Sends)
}

// LastTarget returns the target of the most recent Send, or "" if none.
func (f *FakeChannelSender) LastTarget() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.Sends) == 0 {
		return ""
	}
	return f.Sends[len(f.Sends)-1].Target
}

// FakeAccountLookup is a static, in-memory AccountLookup for tests and local
// dev — a real implementation lives in whichever module owns account/device
// rows (see AccountLookup's doc comment).
type FakeAccountLookup struct {
	mu      sync.Mutex
	targets map[uuid.UUID]AccountTargets
}

// NewFakeAccountLookup returns an empty lookup; use Set to seed it.
func NewFakeAccountLookup() *FakeAccountLookup {
	return &FakeAccountLookup{targets: make(map[uuid.UUID]AccountTargets)}
}

// Set registers the targets to return for accountID (any role).
func (f *FakeAccountLookup) Set(accountID uuid.UUID, t AccountTargets) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.targets[accountID] = t
}

func (f *FakeAccountLookup) ResolveTargets(_ context.Context, accountID uuid.UUID, _ RoleContext) (AccountTargets, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.targets[accountID], nil
}
