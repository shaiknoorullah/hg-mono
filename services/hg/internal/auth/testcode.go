package auth

import "regexp"

// TestSignInCode is the only code a reserved development phone accepts.
// It is a fixture, not a secret: the range is fictional, and FixedTestCode
// refuses it outside local and staging.
const TestSignInCode = "000000"

// testSignInPhone is the fictional E.164 range +15550100100 through
// +15550100199. One hundred numbers, all inside the unused 555 block.
var testSignInPhone = regexp.MustCompile(`^\+155501001[0-9]{2}$`)

const (
	otpViaStored   = "stored"
	otpViaVerifier = "verifier"
	otpViaFixed    = "fixed"
)

func fixedTestEnv(env string) bool {
	return env == "local" || env == "staging"
}

// FixedTestCode reports whether this environment accepts the reserved
// development code for this phone. Production, an empty environment, and
// every other value return false. A phone outside the reserved range
// returns false in every environment.
func FixedTestCode(env, phone string) bool {
	if !fixedTestEnv(env) {
		return false
	}
	return testSignInPhone.MatchString(phone)
}

// otpDelivery chooses how a sign-in code is issued. The reserved range wins
// over a configured phone verifier, so those numbers never reach the
// provider. Production never selects the fixed path.
func otpDelivery(env string, verifierSet bool, phone string) string {
	if FixedTestCode(env, phone) {
		return otpViaFixed
	}
	if verifierSet {
		return otpViaVerifier
	}
	return otpViaStored
}
