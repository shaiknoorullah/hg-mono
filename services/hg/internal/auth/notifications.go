package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/notify"
)

// The three emails auth sends, each carrying one single-use token: the
// restaurant's email verification, the password reset, and the staff
// invitation (issue #248). Each is enqueued through the notification outbox
// (internal/notify) in the same transaction that stores the token's hash, so
// a token exists exactly when its email is queued. The plaintext token goes
// only into the delivery job and the email; the inbox row says that a link
// was sent, never what it is.

// staffInviteTTL is how long an invitation link works. The invitee sets their
// first password with it through the reset-password operation.
const staffInviteTTL = 72 * time.Hour

// UseNotifications wires the outbox. Without it (tests that build a bare
// Service) the flows still issue tokens but send nothing, and say so in the log.
func (s *Service) UseNotifications(enq notify.TxEnqueuer) { s.notify = enq }

// UseNotifications wires the outbox into the module's service. Call it once
// at boot, before serving.
func (m *Module) UseNotifications(enq notify.TxEnqueuer) { m.svc.UseNotifications(enq) }

// StaffInviter is the auth service as the admin and restaurant modules need
// it: it mints a staff invitation inside their transaction.
func (m *Module) StaffInviter() notify.StaffInviter { return m.svc }

// linkEmailSender returns the TokenIssued hook that enqueues one link email.
func (s *Service) linkEmailSender(build func(notify.LinkEmail) (notify.New, error), role notify.RoleContext,
	to, token, zone string) TokenIssued {
	return func(ctx context.Context, tx pgx.Tx, accountID, tokenID string, expiresAt time.Time) error {
		if s.notify == nil {
			s.log.WarnContext(ctx, "email not enqueued: notifications are not wired", "account_id", accountID)
			return nil
		}
		id, err := uuid.Parse(accountID)
		if err != nil {
			return fmt.Errorf("auth: account id %q: %w", accountID, err)
		}
		n, err := build(notify.LinkEmail{
			AccountID: id, Role: role, To: to, Token: token, TokenID: tokenID,
			ExpiresAt: expiresAt, Zone: notify.Zone(zone),
		})
		if err != nil {
			return err
		}
		_, err = s.notify.Enqueue(ctx, tx, n)
		return err
	}
}

// InviteStaff implements notify.StaffInviter: inside the caller's transaction
// (the one that created the INVITED account), it stores a single-use token and
// enqueues the invitation email that carries it. The token is a
// PASSWORD_RESET credential with a longer life, so the invitee sets their
// first password through the existing resetPassword operation and no new API
// is needed; consuming it also verifies their email (ResetPassword).
func (s *Service) InviteStaff(ctx context.Context, tx pgx.Tx, inv notify.StaffInvitation) error {
	token, tokenHash, err := NewOpaqueToken()
	if err != nil {
		return err
	}
	var tokenID string
	var expiresAt time.Time
	if err := tx.QueryRow(ctx, `
		INSERT INTO credential_token (account_id, kind, token_hash, expires_at)
		VALUES ($1, 'PASSWORD_RESET', $2, now() + $3::interval)
		RETURNING id, expires_at`,
		inv.AccountID, tokenHash, staffInviteTTL.String()).Scan(&tokenID, &expiresAt); err != nil {
		return fmt.Errorf("auth: store staff invitation token: %w", err)
	}
	if s.notify == nil {
		s.log.WarnContext(ctx, "staff invitation not enqueued: notifications are not wired", "account_id", inv.AccountID)
		return nil
	}
	n, err := notify.StaffInviteEmail(notify.StaffInvite{
		LinkEmail: notify.LinkEmail{
			AccountID: inv.AccountID, Role: inv.Role, To: inv.Email, Token: token, TokenID: tokenID,
			ExpiresAt: expiresAt, Zone: notify.Zone(""),
		},
		InviteeName: inv.InviteeName,
		TeamName:    inv.TeamName,
		RoleLabel:   inv.RoleLabel,
	})
	if err != nil {
		return err
	}
	_, err = s.notify.Enqueue(ctx, tx, n)
	return err
}
