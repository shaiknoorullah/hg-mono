package accountstate

// Who may change an account's state, and which changes each of them may make.
//
// The application role cannot write an account's state: migration 00045 takes
// UPDATE on restaurant.account_state and delist_reasons, rider_profile.
// account_status and account.status away from it, lets it INSERT those rows only
// in their default state, and lets it DELETE none of them. The only writers are
// database functions owned by the migrations' role, one per kind of change:
//   - a staff member's action is account_state_apply(), which internal/admin's
//     ApplyAccountAction calls after checking the caller's role and two-step
//     sign-in and settling the work in progress; the function reads the actor's
//     grants as they stand, checks the transition against account_state_rule,
//     the two-person ban and the own-account rule, and writes the state, the
//     history row and the audit row together;
//   - completing a restaurant's onboarding is account_state_complete_onboarding(),
//     which internal/restaurant's RecomputeOnboarding calls (SystemOnboarding);
//   - the halal certificate lapsing and a renewal clearing it are
//     account_state_halal_expiry() and account_state_halal_renewal()
//     (SystemHalalExpiry, SystemHalalRenewal;
//     https://github.com/shaiknoorullah/hg-mono/pull/274 calls them);
//   - a certifying body's acceptance withdrawn or given back is
//     account_state_issuer_listing() (SystemHalalIssuer;
//     https://github.com/shaiknoorullah/hg-mono/issues/355).
//
// A system function takes no actor and no action: it decides the change from the
// data and can make only its own. A test holds account_state_rule equal to
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
	// It writes no account_state_event row (leaving PENDING is no account action);
	// the onboarding transition row and the audit log record it.
	SystemOnboarding System = "ONBOARDING"
	// SystemHalalExpiry records a lapsed halal certificate: it delists a LIVE
	// restaurant with the reason HALAL_CERTIFICATE_EXPIRED, and adds the reason to
	// a restaurant in any other state. It never suspends, bans or lists one
	// (https://github.com/shaiknoorullah/hg-mono/blob/main/docs/spec/05-admin.md#a-17--halal-certificate-expiry-monitoring-and-lapse-handling).
	SystemHalalExpiry System = "HALAL_EXPIRY"
	// SystemHalalRenewal clears a lapse once the certificate is current again, and
	// lists a DELISTED restaurant with no other reason ("no manual reinstatement
	// step, because the lapse was not a punishment", same section). Never out of a
	// suspension, a deactivation or a ban.
	SystemHalalRenewal System = "HALAL_RENEWAL"
	// SystemHalalIssuer follows a certifying body's acceptance: withdrawn, it
	// delists a LIVE restaurant no current certificate from an accepted body
	// vouches for any more; given back, it lists a DELISTED one such a certificate
	// vouches for again. Only LIVE and DELISTED move
	// (https://github.com/shaiknoorullah/hg-mono/issues/355).
	SystemHalalIssuer System = "HALAL_ISSUER"
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
	// Permission is the admin spec's permission name, and the audit action.
	Permission string
	// ReasonCode is the one reason a system principal gives. It is empty for
	// staff, whose reasons are the ones ReasonAllowed accepts.
	ReasonCode string
}

// systemTransitions are the transitions system principals record in the
// account's history. SystemOnboarding has none (see its comment).
var systemTransitions = []Transition{
	{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
		Principal: SystemPrincipal(SystemHalalExpiry), Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
	{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
		Principal: SystemPrincipal(SystemHalalRenewal), Permission: "restaurant.relisted", ReasonCode: "ISSUE_RESOLVED"},
	{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
		Principal: SystemPrincipal(SystemHalalIssuer), Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_UNVERIFIED"},
	{Subject: Restaurant, Action: Delist, From: StateLive, To: StateDelisted,
		Principal: SystemPrincipal(SystemHalalIssuer), Permission: "restaurant.delisted", ReasonCode: "HALAL_CERTIFICATE_EXPIRED"},
	{Subject: Restaurant, Action: Reinstate, From: StateDelisted, To: StateLive,
		Principal: SystemPrincipal(SystemHalalIssuer), Permission: "restaurant.relisted", ReasonCode: "ISSUE_RESOLVED"},
}

// Transitions lists every transition the account's history may record: each
// staff edge of the state machine for every state it leaves, and the system
// principals' transitions. Reinstating a restaurant from anything but DELISTED
// may land on DELISTED instead of LIVE (ReinstatedState), so both are listed.
// Migration 00045 holds the same list in account_state_rule.
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
					out = append(out, Transition{Subject: s, Action: a, From: from, To: e.to, Principal: p, Permission: e.permission})
					if s == Restaurant && a == Reinstate && from != StateDelisted {
						out = append(out, Transition{Subject: s, Action: a, From: from, To: StateDelisted, Principal: p, Permission: e.permission})
					}
				}
			}
		}
	}
	return append(out, systemTransitions...)
}
