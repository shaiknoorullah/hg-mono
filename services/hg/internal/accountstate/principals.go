package accountstate

// Who may change an account's state, and which changes each of them may make.
//
// Exactly one function owns each kind of change:
//   - a staff member's action is internal/admin's ApplyAccountAction, which checks
//     the caller's role and two-step sign-in itself, then this package's state
//     machine, the two-person ban and the own-account rule;
//   - completing a restaurant's onboarding is the database function
//     account_state_complete_onboarding(), which internal/restaurant's
//     RecomputeOnboarding calls, as the ONBOARDING system principal;
//   - the halal certificate expiry and renewal are the HALAL_EXPIRY and
//     HALAL_RENEWAL system principals
//     (https://github.com/shaiknoorullah/hg-mono/pull/274 implements them).
//
// Migration 00035 makes the same list a database fact, so no other code can
// change a state with weaker gates: every change of restaurant.account_state,
// rider_profile.account_status or account.status needs an unused history row of
// the same transaction for exactly that change, and the history row is refused
// unless its transition is in account_state_rule and its actor holds, now, the
// role it needs. Only the schema owner writes a system principal's row, so the
// application cannot pose as one. A test holds account_state_rule equal to
// Transitions().

// System is a system principal: a part of the platform, not a person, that
// changes an account's state on its own. It is the actor recorded in the account's
// history (account_state_event.system_actor) and in the audit log, in place of a
// staff member, and it may take only the transitions the specification gives it.
type System string

const (
	// SystemOnboarding takes a restaurant out of PENDING when its onboarding
	// completes: to LIVE, or to DELISTED when its halal certificate is not current
	// (the ReinstatedState rule). It takes no other transition, so completing
	// onboarding can never lift a suspension or a ban. The specification: "LIVE —
	// initiated by the system, on READY"
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#20-the-restaurant-lifecycle-normative-referenced-by-a-13a-22).
	// It is the database function account_state_complete_onboarding(), which
	// checks the onboarding gates and the certificate itself and records its
	// authority where the application cannot write; it writes no
	// account_state_event row, and the onboarding transition row and the audit log
	// record it.
	SystemOnboarding System = "ONBOARDING"
	// SystemHalalExpiry delists a LIVE restaurant whose halal certificate has
	// lapsed, with the reason HALAL_CERTIFICATE_EXPIRED. It only delists: it never
	// suspends, bans or lists a restaurant
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling).
	SystemHalalExpiry System = "HALAL_EXPIRY"
	// SystemHalalRenewal lists a DELISTED restaurant again once a renewed
	// certificate is approved and no delisting reason is left ("no manual
	// reinstatement step, because the lapse was not a punishment", same section).
	// Only from DELISTED: never out of a suspension, a deactivation or a ban.
	SystemHalalRenewal System = "HALAL_RENEWAL"
)

// Principal is who may take a transition: a staff role, or a system principal.
type Principal string

const (
	// PrincipalAdmin is an admin or a super admin.
	PrincipalAdmin Principal = "ADMIN"
	// PrincipalSuperAdmin is a super admin only: confirming a ban, and lifting one.
	PrincipalSuperAdmin Principal = "SUPER_ADMIN"
)

// SystemPrincipal is the principal a system acts as, as account_state_rule
// names it.
func SystemPrincipal(s System) Principal { return Principal("SYSTEM:" + string(s)) }

// Transition is one change of an account's state that the account's history may
// record, and who may make it.
type Transition struct {
	Subject   Subject
	Action    Action
	From      string
	To        string
	Principal Principal
	// ReasonCode is the one reason a system principal gives. It is empty for
	// staff, whose reasons are the ones ReasonAllowed accepts.
	ReasonCode string
}

// systemTransitions are the transitions system principals record in the
// account's history. SystemOnboarding has none (see its comment).
var systemTransitions = []Transition{
	{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
		Principal: SystemPrincipal(SystemHalalExpiry), ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
	{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
		Principal: SystemPrincipal(SystemHalalRenewal), ReasonCode: "ISSUE_RESOLVED"},
}

// Transitions lists every transition the account's history may record: each
// staff edge of the state machine for every state it leaves, and the system
// principals' transitions. Reinstating a restaurant from anything but DELISTED
// may land on DELISTED instead of LIVE (ReinstatedState), so both are listed.
// Migration 00035 holds the same list in account_state_rule.
func Transitions() []Transition {
	var out []Transition
	for _, s := range []Subject{Restaurant, Rider, Customer} {
		for _, a := range allActions {
			for _, e := range table[s][a] {
				p := PrincipalAdmin
				if e.superAdminOnly {
					p = PrincipalSuperAdmin
				}
				for _, from := range e.from {
					out = append(out, Transition{Subject: s, Action: a, From: from, To: e.to, Principal: p})
					if s == Restaurant && a == Reinstate && from != StateDelisted {
						out = append(out, Transition{Subject: s, Action: a, From: from, To: StateDelisted, Principal: p})
					}
				}
			}
		}
	}
	return append(out, systemTransitions...)
}
