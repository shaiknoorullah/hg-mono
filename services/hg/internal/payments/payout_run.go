package payments

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"time"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/httpx"
)

// The weekly payout run (issue #251).
//
// No workflow engine: payout_run.due_at is the schedule column, and a ticker
// in every replica asks every minute whether a run is due. The replica that
// holds the session advisory lock (the lease) runs every due run, one at a
// time; the others skip. A replica that dies mid-run drops its connection and
// with it the lease, and the run, still unfinished, is picked up by the next
// tick anywhere in the fleet. This is the lease pattern of the partition
// maintenance loop (internal/partitions); docs/spec/01-platform.md, "P-39 —
// Background runtime" asks that N replicas produce the same effects as one.
//
// A run for the period [start, end) does, for each partner:
//
//  1. skips a suspended or banned restaurant, whose balance waits until it is
//     reinstated;
//  2. transfers what is still owed from earlier: a payout whose transfer was
//     refused or interrupted, and a payout held in an earlier period once
//     Stripe has payouts turned back on (a hold is released on the next
//     Monday run, not straight away: decision log, "Settled — redesign
//     decisions, round 2", when a held payout is released); and asks again
//     for the bank payout of a transferred payout whose bank payout was
//     refused, interrupted, or failed at the bank;
//  3. builds this period's payout from every unpaid earning created before
//     end — carried balances included — and transfers it, or holds it, or
//     carries a balance that is not positive;
//  4. for a restaurant, blocks new orders once its balance has been below zero
//     for longer than the configured limit, and lifts the block when it
//     recovers.
//
// A payout reaches the partner in two Stripe steps (#301): the transfer, from
// the platform's balance to the partner's connected account, makes it
// TRANSFERRED; the bank payout, from that account's balance to the partner's
// bank, is asked for straight after, and Stripe's payout.paid webhook makes it
// PAID (webhook_effects.go). Connected accounts are on a manual payout
// schedule, so without the second step the money would stay in Stripe.
//
// Every step is idempotent: a partner has at most one payout per period
// (unique index), a ledger entry is stamped with at most one payout, every
// transfer is keyed by its payout id and found by its transfer group before a
// retry, and every bank payout is keyed by its payout id and attempt, found by
// its metadata before a retry, with at most one attempt on its way at a time
// (unique index), so re-running a run, or running two, pays nobody twice.

// PayoutPolicy is payout configuration the owner may still change.
type PayoutPolicy struct {
	// RestaurantNegativeBlockDays: a restaurant whose balance has been below
	// zero for longer than this takes no new orders until the balance
	// recovers; 0 turns the block off. The documented behaviour is 30 days
	// (docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding and
	// payouts (Canada)", Schedules), but whether to block at all is still the
	// owner's open question: https://github.com/shaiknoorullah/hg-mono/issues/164.
	// Riders are never blocked: the owner decided operations follow up by hand
	// (decision log, "Settled — redesign decisions, round 2", a rider whose
	// balance stays below zero).
	RestaurantNegativeBlockDays int
	// RestaurantHold is how long after its order settles a restaurant's
	// earning waits before a run pays it. 0 pays it as soon as it settles.
	RestaurantHold time.Duration
}

// riderHold is how long after delivery a rider's earning waits: an earning is
// PENDING "until the assignment is 60 min old and dispute-free"
// (docs/spec/04-rider.md, "D-26 — Earnings formula and per-delivery ledger").
const riderHold = time.Hour

// hold is the wait for one partner type's order earnings.
func (p PayoutPolicy) hold(payeeType string) time.Duration {
	if payeeType == PayeeRider {
		return riderHold
	}
	return p.RestaurantHold
}

// PayoutRunner runs the weekly payout. Every replica runs one; the lease
// lets one work at a time.
type PayoutRunner struct {
	repo   *Repo
	stripe StripeClient
	policy PayoutPolicy
	log    *slog.Logger
	now    func() time.Time
	// owner names this replica on a payout it is transferring.
	owner string
	// every is how often a replica checks for a due run; maxTick bounds one
	// tick, after which an unfinished run is resumed by the next.
	every   time.Duration
	maxTick time.Duration
	kick    chan struct{}
}

// payoutLeaseSQL is the key of the session advisory lock one tick holds.
const payoutLeaseSQL = `hashtextextended('hg.payout_run', 0)`

// NewPayoutRunner builds the runner. sc must be non-nil: without Stripe
// nothing can be paid, and the server does not start the runner.
func NewPayoutRunner(repo *Repo, sc StripeClient, policy PayoutPolicy, owner string, log *slog.Logger) *PayoutRunner {
	if log == nil {
		log = slog.Default()
	}
	return &PayoutRunner{
		repo: repo, stripe: sc, policy: policy, log: log, now: time.Now, owner: owner,
		every: time.Minute, maxTick: 30 * time.Minute, kick: make(chan struct{}, 1),
	}
}

// Run checks for due runs at once, then every minute and whenever an admin
// queues one on this replica, until ctx is cancelled.
func (r *PayoutRunner) Run(ctx context.Context) {
	t := time.NewTicker(r.every)
	defer t.Stop()
	for {
		tickCtx, cancel := context.WithTimeout(ctx, r.maxTick)
		if _, err := r.RunDue(tickCtx); err != nil && !errors.Is(err, context.Canceled) {
			r.log.Error("payout run failed", slog.String("error", err.Error()))
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-r.kick:
		}
	}
}

// Kick asks this replica's loop to check for due runs now.
func (r *PayoutRunner) Kick() {
	select {
	case r.kick <- struct{}{}:
	default:
	}
}

// RunDue takes the lease, makes sure the scheduled runs exist, and runs every
// run that is due. ran is false when another replica holds the lease.
func (r *PayoutRunner) RunDue(ctx context.Context) (ran bool, err error) {
	c, err := r.repo.pool.Acquire(ctx)
	if err != nil {
		return false, err
	}
	conn := c.Conn()
	defer func() {
		// The lock belongs to the session, so a connection that could not
		// unlock must not go back to the pool still holding it.
		if ran {
			if _, uerr := conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(`+payoutLeaseSQL+`)`); uerr != nil {
				_ = conn.Close(context.WithoutCancel(ctx))
			}
		}
		c.Release()
	}()
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(`+payoutLeaseSQL+`)`).Scan(&ran); err != nil || !ran {
		return false, err
	}

	now := r.now()
	// The schedule: the run for the period that closed most recently (due
	// this Monday 09:00, or already past) and the one after it, so the next
	// run is always on the table. A replica that was down on a Monday catches
	// up on start: the late run still pays everything owed before its cutoff.
	closed := closedPeriodAt(now)
	next := closedPeriodAt(closed.End.Add(8 * 24 * time.Hour))
	for _, p := range []PayoutPeriod{closed, next} {
		if err := r.repo.ensureScheduledRun(ctx, p, scheduledRunAt(p.End)); err != nil {
			return true, fmt.Errorf("schedule payout run for %s: %w", p.End.Format(time.DateOnly), err)
		}
	}

	for {
		// Read the clock each time, so a run an admin queued while this loop
		// was busy is picked up before the lease is let go.
		run, err := r.repo.nextDueRun(ctx, r.now())
		if errors.Is(err, ErrNotFound) {
			return true, nil
		}
		if err != nil {
			return true, err
		}
		if err := r.execute(ctx, run); err != nil {
			return true, err
		}
	}
}

// execute runs one payout run to the end. When ctx ends first the run is left
// unfinished, and the next tick resumes it.
func (r *PayoutRunner) execute(ctx context.Context, run PayoutRunRow) error {
	attempt, err := r.repo.startRun(ctx, run.ID)
	if err != nil {
		return fmt.Errorf("start payout run %s: %w", run.ID, err)
	}
	log := r.log.With(slog.String("payout_run", run.ID), slog.String("kind", run.Kind),
		slog.String("period_end", run.PeriodEnd.Format(time.RFC3339)), slog.Int("attempt", int(attempt)))
	log.Info("payout run started")

	// An admin run pays only if its admin may still ask for it, decided now,
	// not when it was queued.
	refusal, own, err := r.repo.adminRunAllowed(ctx, run)
	if err != nil {
		return fmt.Errorf("check payout run %s: %w", run.ID, err)
	}
	if refusal != "" {
		log.Warn("payout run refused", slog.String("reason", refusal))
		return r.repo.finishRun(context.WithoutCancel(ctx), run.ID, runTally{}, errors.New(refusal))
	}

	var payees []PayeeRef
	if run.Payee != nil {
		payees = []PayeeRef{*run.Payee}
	} else if payees, err = r.repo.runPayees(ctx, run.PeriodEnd); err != nil {
		return r.repo.finishRun(context.WithoutCancel(ctx), run.ID, runTally{}, fmt.Errorf("list partners: %w", err))
	}
	// Nobody runs their own payout, by naming themselves or by asking for
	// everyone: an admin run leaves out the admin's own rider account and
	// restaurants, which the scheduled Monday run pays.
	if len(own) > 0 {
		payees = slices.DeleteFunc(payees, func(p PayeeRef) bool {
			if own[p] {
				log.Info("payout run leaves out the requesting admin's own payout",
					slog.String("payee_type", p.Type), slog.String("payee_id", p.ID))
			}
			return own[p]
		})
	}

	t := runTally{Partners: int32(len(payees))}
	for _, p := range payees {
		if ctx.Err() != nil {
			log.Warn("payout run stopped before the end; the next tick resumes it")
			return ctx.Err()
		}
		r.payPayee(ctx, run, attempt, p, &t)
	}
	if err := r.repo.finishRun(ctx, run.ID, t, nil); err != nil {
		return fmt.Errorf("finish payout run %s: %w", run.ID, err)
	}
	log.Info("payout run finished", slog.Int("partners", int(t.Partners)), slog.Int("paid", int(t.Paid)),
		slog.Int("held", int(t.Held)), slog.Int("released", int(t.Released)),
		slog.Int("carried", int(t.Carried)), slog.Int("failed", int(t.Failed)),
		slog.Int64("paid_cents", t.PaidCents))
	return nil
}

// payPayee does one run's work for one partner and writes a line for every
// action. A failure is a line too; the run moves on to the next partner.
func (r *PayoutRunner) payPayee(ctx context.Context, run PayoutRunRow, attempt int32, p PayeeRef, t *runTally) {
	line := func(o PayoutRunOutcome, payoutID string, cents int64, detail string) {
		t.add(o, cents)
		if err := r.repo.addRunLine(ctx, run.ID, attempt, p, o, payoutID, cents, detail); err != nil {
			r.log.Error("payout run line not written", slog.String("payout_run", run.ID),
				slog.String("payee_type", p.Type), slog.String("payee_id", p.ID),
				slog.String("outcome", string(o)), slog.String("error", err.Error()))
		}
		if o == OutcomeError || o == OutcomeTransferFailed || o == OutcomeBankPayoutFailed {
			r.log.Error("payout failed for a partner", slog.String("payout_run", run.ID),
				slog.String("payee_type", p.Type), slog.String("payee_id", p.ID),
				slog.String("payout_id", payoutID), slog.String("detail", detail))
		}
	}
	fail := func(step string, err error) { line(OutcomeError, "", 0, step+": "+err.Error()) }

	// 1. A suspended or banned restaurant is not paid until it is reinstated
	// (docs/spec/03-restaurant.md, "R-32 — Payout schedule, preferences and
	// payout requests", rule 2). Riders are always paid for work done. This
	// read only saves work: building and claiming a payout check again, in
	// their own transactions, so a suspension that lands after it still
	// stops the transfer.
	if p.Type == PayeeRestaurant {
		suspended, state, err := r.repo.restaurantSuspended(ctx, p.ID)
		if err != nil {
			fail("read restaurant", err)
			return
		}
		if suspended {
			line(OutcomePartnerSuspended, "", 0, "the restaurant is "+state+"; its balance is kept until it is reinstated")
			return
		}
	}

	// 2. What is still owed from earlier.
	owed, err := r.repo.owedPayouts(ctx, p)
	if err != nil {
		fail("read owed payouts", err)
		return
	}
	for _, o := range owed {
		switch {
		case o.State == "HELD" && !o.PeriodEnd.Before(run.PeriodEnd):
			continue // held this period: released by a later period's run
		case o.State == "TRANSFERRED":
			r.bankPayout(ctx, run, o.ID, line) // transferred already: only the bank payout is owed
		default:
			r.transfer(ctx, run, o.ID, o.PeriodEnd, line)
		}
	}

	// 3. This period's payout.
	now := r.now()
	pp, err := r.repo.createPeriodPayout(ctx, p, PayoutPeriod{Start: run.PeriodStart, End: run.PeriodEnd},
		r.policy.hold(p.Type), now.Add(10*time.Minute), nextScheduledRun(now), runActorFor(run))
	if err != nil {
		fail("build payout", err)
		return
	}
	var bal *payeeBalance
	balance := func() (payeeBalance, error) {
		if bal == nil {
			b, err := r.repo.balanceAt(ctx, p, run.AsOf)
			if err != nil {
				return b, err
			}
			bal = &b
		}
		return *bal, nil
	}
	switch {
	case pp.Ready:
		r.transfer(ctx, run, pp.PayoutID, run.PeriodEnd, line)
	case pp.Outcome == OutcomeHeld:
		line(OutcomeHeld, pp.PayoutID, pp.AmountCents, "Stripe has payouts turned off for this partner: "+pp.HoldReason)
	case pp.Outcome == OutcomePartnerSuspended:
		line(OutcomePartnerSuspended, "", 0, "the restaurant is "+pp.State+"; its balance is kept until it is reinstated")
		return
	case pp.Outcome == OutcomeAlreadyPaid:
		line(OutcomeAlreadyPaid, pp.PayoutID, pp.AmountCents, "this period's payout already exists ("+pp.State+")")
	case pp.Outcome == OutcomeCarriedNegative:
		detail := "the unpaid balance is not positive; it is carried to the next run"
		if b, err := balance(); err == nil && b.NegativeSince != nil {
			detail = "below zero since " + b.NegativeSince.In(payoutZone).Format(time.DateOnly) + "; carried to the next run"
		}
		line(OutcomeCarriedNegative, "", pp.AmountCents, detail)
	case pp.Outcome == OutcomeNoPayoutAccount:
		line(OutcomeNoPayoutAccount, "", 0, "no Stripe account yet; the balance is paid once onboarding is complete")
	default:
		line(OutcomeNothingDue, "", 0, "")
	}

	// 4. A restaurant's balance below zero for too long blocks its new orders.
	if p.Type == PayeeRestaurant {
		b, err := balance()
		if err != nil {
			fail("read balance", err)
			return
		}
		r.orderBlock(ctx, run, p, b, line)
	}
}

// orderBlock opens or lifts the order block on a restaurant whose balance is
// below zero (docs/spec/01-platform.md, "P-19 — Stripe Connect: onboarding
// and payouts (Canada)", Schedules: negative for more than 30 days, it
// escalates to collections and blocks new orders). Still the owner's open
// question, so the limit is configuration: see PayoutPolicy and #164.
func (r *PayoutRunner) orderBlock(ctx context.Context, run PayoutRunRow, p PayeeRef, b payeeBalance,
	line func(PayoutRunOutcome, string, int64, string)) {
	days := r.policy.RestaurantNegativeBlockDays
	switch {
	case days > 0 && b.NegativeSince != nil && run.AsOf.Sub(*b.NegativeSince) > time.Duration(days)*24*time.Hour:
		opened, err := r.repo.openCollection(ctx, p.ID, b, runActorFor(run), days)
		if err != nil {
			line(OutcomeError, "", 0, "block orders: "+err.Error())
			return
		}
		if opened {
			line(OutcomeOrdersBlocked, "", b.Cents, fmt.Sprintf(
				"balance below zero since %s, more than %d days: no new orders until it recovers",
				b.NegativeSince.In(payoutZone).Format(time.DateOnly), days))
		}
	case b.Cents >= 0, days == 0:
		reason, detail := "BALANCE_RECOVERED", "the balance has recovered"
		if b.Cents < 0 {
			reason, detail = "BLOCK_TURNED_OFF", "the order block is turned off"
		}
		closed, err := r.repo.closeCollection(ctx, p.ID, runActorFor(run), reason, b.Cents)
		if err != nil {
			line(OutcomeError, "", 0, "lift order block: "+err.Error())
			return
		}
		if closed {
			line(OutcomeOrdersUnblocked, "", b.Cents, detail)
		}
	}
}

// transfer moves one payout to the partner's Stripe account. periodEnd is the
// payout's own period: a payout from an earlier period is RELEASED, this
// period's is PAID.
func (r *PayoutRunner) transfer(ctx context.Context, run PayoutRunRow, payoutID string, periodEnd time.Time,
	line func(PayoutRunOutcome, string, int64, string)) {
	earlier := periodEnd.Before(run.PeriodEnd)
	claim, err := r.repo.claimTransfer(ctx, payoutID, r.owner, nextScheduledRun(r.now()), runActorFor(run))
	if err != nil {
		line(OutcomeError, payoutID, 0, "claim transfer: "+err.Error())
		return
	}
	switch {
	case claim.Suspended != "":
		line(OutcomePartnerSuspended, payoutID, claim.AmountCents,
			"the restaurant is "+claim.Suspended+"; this payout is kept until it is reinstated")
		return
	case claim.Held && claim.WasHeld:
		line(OutcomeStillHeld, payoutID, claim.AmountCents, "Stripe still has payouts turned off: "+claim.HoldReason)
		return
	case claim.Held:
		line(OutcomeHeld, payoutID, claim.AmountCents, "Stripe has payouts turned off for this partner: "+claim.HoldReason)
		return
	case !claim.Claimed:
		return // paid already, or another worker is transferring it right now
	}

	if claim.AmountCents <= 0 {
		// Unreachable while payout_amount_positive holds; never send it.
		line(OutcomeError, payoutID, claim.AmountCents, "refused to transfer an amount that is not positive")
		return
	}
	group := "payout_" + payoutID
	var tr *StripeTransfer
	if claim.PriorAttempts > 0 {
		// An earlier attempt may have reached Stripe; find its transfer rather
		// than trust an idempotency key Stripe may have forgotten.
		if tr, err = r.stripe.FindTransfer(ctx, group); err != nil {
			r.transferFailed(ctx, run, payoutID, claim.AmountCents, err, line)
			return
		}
	}
	if tr == nil {
		tr, err = r.stripe.CreateTransfer(ctx, CreateTransferInput{
			AmountCents:     claim.AmountCents,
			Currency:        "cad",
			DestinationAcct: claim.StripeAccountID,
			IdempotencyKey:  "po:" + payoutID,
			PayoutID:        payoutID,
			TransferGroup:   group,
		})
		if err != nil {
			r.transferFailed(ctx, run, payoutID, claim.AmountCents, err, line)
			return
		}
	}
	if err := r.repo.markTransferred(ctx, payoutID, tr.ID, runActorFor(run), earlier, claim.AmountCents); err != nil {
		// The transfer exists; the payout stays TRANSFERRING until its lease
		// lapses, and the next run finds the transfer by its group.
		line(OutcomeError, payoutID, claim.AmountCents, "record transfer "+tr.ID+": "+err.Error())
		return
	}
	outcome := OutcomePaid
	if earlier || claim.WasHeld {
		outcome = OutcomeReleased
	}
	line(outcome, payoutID, claim.AmountCents, "Stripe transfer "+tr.ID)
	r.bankPayout(ctx, run, payoutID, line)
}

// bankPayout asks Stripe to pay a transferred payout out of the partner's
// Stripe balance to their bank. Nothing here moves the platform's money: the
// transfer did that, once, and no path from here makes another. A retry first
// looks for what an interrupted call made; a refusal is kept for the next run.
func (r *PayoutRunner) bankPayout(ctx context.Context, run PayoutRunRow, payoutID string,
	line func(PayoutRunOutcome, string, int64, string)) {
	claim, err := r.repo.claimBankPayout(ctx, payoutID, r.owner)
	if err != nil {
		line(OutcomeBankPayoutFailed, payoutID, 0, "claim bank payout: "+err.Error())
		return
	}
	switch {
	case claim.PayoutsOff != "":
		line(OutcomeBankPayoutFailed, payoutID, claim.AmountCents,
			"transferred, but Stripe has payouts to the bank turned off for this partner: "+claim.PayoutsOff+
				"; the money waits in their Stripe balance and the next run asks again")
		return
	case !claim.Claimed:
		return // its bank payout is on its way, or another worker is asking for it right now
	}
	if claim.AmountCents <= 0 {
		// Unreachable while payout_amount_positive holds; never send it.
		line(OutcomeBankPayoutFailed, payoutID, claim.AmountCents, "refused to pay out an amount that is not positive")
		return
	}
	failed := func(cause error) {
		msg := cause.Error()
		if err := r.repo.bankPayoutFailed(ctx, payoutID, claim.Attempt, msg, runActorFor(run), nextScheduledRun(r.now()),
			claim.AmountCents); err != nil {
			msg += " (and recording the failure: " + err.Error() + ")"
		}
		line(OutcomeBankPayoutFailed, payoutID, claim.AmountCents, msg+"; the next run asks again")
	}
	var po *StripeBankPayout
	if claim.Reuse {
		// The call for this attempt may have reached Stripe: find what it made
		// rather than trust an idempotency key Stripe may have forgotten.
		if po, err = r.stripe.FindBankPayout(ctx, claim.StripeAccountID, payoutID, claim.Attempt,
			claim.Since.Add(-time.Hour)); err != nil {
			failed(err)
			return
		}
	}
	if po == nil {
		po, err = r.stripe.CreateBankPayout(ctx, CreateBankPayoutInput{
			StripeAccountID: claim.StripeAccountID,
			AmountCents:     claim.AmountCents,
			Currency:        "cad",
			IdempotencyKey:  "pb:" + payoutID + ":" + strconv.Itoa(claim.Attempt),
			PayoutID:        payoutID,
			Attempt:         claim.Attempt,
		})
		if err != nil {
			failed(err)
			return
		}
	}
	if err := r.repo.recordBankPayout(ctx, payoutID, claim.Attempt, po.ID, runActorFor(run), claim.AmountCents); err != nil {
		// Stripe has it; the attempt keeps its lease until it lapses, and the
		// next run finds the bank payout by its metadata.
		line(OutcomeBankPayoutFailed, payoutID, claim.AmountCents, "record bank payout "+po.ID+": "+err.Error())
		return
	}
	line(OutcomeBankPayout, payoutID, claim.AmountCents, "Stripe bank payout "+po.ID)
}

func (r *PayoutRunner) transferFailed(ctx context.Context, run PayoutRunRow, payoutID string, cents int64, cause error,
	line func(PayoutRunOutcome, string, int64, string)) {
	msg := cause.Error()
	if err := r.repo.markTransferFailed(ctx, payoutID, msg, runActorFor(run), nextScheduledRun(r.now()), cents); err != nil {
		msg += " (and recording the failure: " + err.Error() + ")"
	}
	line(OutcomeTransferFailed, payoutID, cents, msg)
}

// ---------------------------------------------------------------------------
// Admin requests.
// ---------------------------------------------------------------------------

// PayoutRunRequest is an admin's request to run the payout now. It names who
// and as of when, never an amount: every amount comes from the ledger. Who is
// asking is never part of it: Request reads the caller from the context.
type PayoutRunRequest struct {
	Payee          *PayeeRef
	AsOf           *time.Time
	Reason         string
	IdempotencyKey string
}

// requirePayoutAdmin is the authorisation for payout runs, checked here in the
// service whoever the caller is, not only at the route: the principal in ctx
// must be an admin or a super admin. Restaurant staff, riders, customers and
// support agents never run or read payout runs, for themselves or anyone
// else; a payee id in a request scopes nothing. Queuing a run moves money, so
// it also needs a session that signed in with two-step sign-in
// (docs/spec/05-admin.md, "A-02 — Role-based access control model": money
// permissions need a verified second factor; staff sessions last at most 12
// hours, decision log "Settled — redesign decisions, round 2", staff session
// length).
func requirePayoutAdmin(ctx context.Context, moneyMoves bool) (adminActor, error) {
	p := httpx.PrincipalFrom(ctx)
	if p.Anonymous || p.AccountID == "" || !(p.HasRole(httpx.RoleAdmin) || p.HasRole(httpx.RoleSuperAdmin)) {
		return adminActor{}, ErrNotPayoutAdmin
	}
	if moneyMoves && !slices.Contains(p.AMR, "pwd+totp") {
		return adminActor{}, ErrTwoStepRequired
	}
	a := adminActor{AccountID: p.AccountID, SessionID: p.SessionID, RequestID: httpx.RequestIDFrom(ctx)}
	for _, role := range p.Roles {
		a.Roles = append(a.Roles, string(role))
	}
	return a, nil
}

// Request queues an admin run and wakes this replica's loop. replayed is true
// when the same admin already sent this Idempotency-Key with the same body; a
// different body is ErrIdempotencyReuse.
func (r *PayoutRunner) Request(ctx context.Context, req PayoutRunRequest) (run PayoutRunRow, replayed bool, err error) {
	actor, err := requirePayoutAdmin(ctx, true)
	if err != nil {
		return run, false, err
	}
	if n := len([]rune(req.Reason)); n < 10 || n > 500 {
		return run, false, ErrReasonRequired
	}
	now := r.now()
	asOf := now
	if req.AsOf != nil {
		// A run as of the future would pay earnings before their week closed.
		if req.AsOf.After(now.Add(time.Minute)) {
			return run, false, ErrAsOfInFuture
		}
		asOf = *req.AsOf
	}
	// The token said admin; the database decides, in the transaction that
	// queues the run, that the admin still is one and that the partner is
	// not the admin.
	fp := requestFingerprint(req)
	run, inserted, err := r.repo.insertAdminRun(ctx, closedPeriodAt(asOf), asOf, now, req.Payee,
		req.Reason, actor.AccountID, req.IdempotencyKey, fp, actor)
	if err != nil {
		return run, false, err
	}
	if !inserted {
		if run.Fingerprint == nil || *run.Fingerprint != fp {
			return PayoutRunRow{}, false, ErrIdempotencyReuse
		}
		return run, true, nil
	}
	r.Kick()
	return run, false, nil
}

// requestFingerprint is the request body in canonical form.
func requestFingerprint(req PayoutRunRequest) string {
	fp := "payee="
	if req.Payee != nil {
		fp += req.Payee.Type + ":" + req.Payee.ID
	}
	fp += ";as_of="
	if req.AsOf != nil {
		fp += req.AsOf.UTC().Format(time.RFC3339Nano)
	}
	return fp + ";reason=" + req.Reason
}

// Errors an admin request can return.
var (
	ErrAsOfInFuture     = errors.New("as_of is in the future")
	ErrIdempotencyReuse = errors.New("idempotency key reused with a different body")
	ErrOwnPayout        = errors.New("an admin may not run their own payout")
	ErrNotPayoutAdmin   = errors.New("only an admin or a super admin may run or read payout runs")
	ErrTwoStepRequired  = errors.New("running a payout needs a session signed in with two-step sign-in")
	ErrReasonRequired   = errors.New("a payout run needs a reason of 10 to 500 characters")
)
