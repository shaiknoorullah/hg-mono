package auth

import "testing"

func TestFixedTestCodeRefusesProduction(t *testing.T) {
	const reserved = "+15550100101"
	const ordinary = "+14165550199"

	allowed := map[string]bool{"local": true, "staging": true}
	for _, env := range []string{"local", "staging", "production", "", "prod", "dev", "test"} {
		got := FixedTestCode(env, reserved)
		if got != allowed[env] {
			t.Errorf("FixedTestCode(%q, reserved) = %v, want %v", env, got, allowed[env])
		}
		if FixedTestCode(env, ordinary) {
			t.Errorf("FixedTestCode(%q, ordinary phone) = true, want false", env)
		}
	}

	edges := []string{"+15550100100", "+15550100199", "+1555010010", "+155501001000", "+1555010010a", "+15550100200", "15550100101"}
	for _, phone := range edges {
		want := phone == "+15550100100" || phone == "+15550100199"
		if got := FixedTestCode("local", phone); got != want {
			t.Errorf("FixedTestCode(local, %q) = %v, want %v", phone, got, want)
		}
		if FixedTestCode("production", phone) {
			t.Errorf("production accepted %q", phone)
		}
	}
}

func TestOTPDeliveryNeverFixesProduction(t *testing.T) {
	const reserved = "+15550100142"
	cases := []struct {
		env      string
		verifier bool
		phone    string
		want     string
	}{
		{"local", false, reserved, otpViaFixed},
		{"local", true, reserved, otpViaFixed},
		{"staging", true, reserved, otpViaFixed},
		{"production", true, reserved, otpViaVerifier},
		{"production", false, reserved, otpViaStored},
		{"", true, reserved, otpViaVerifier},
		{"prod", true, reserved, otpViaVerifier},
		{"dev", false, reserved, otpViaStored},
		{"test", true, reserved, otpViaVerifier},
		{"local", true, "+14165550100", otpViaVerifier},
		{"staging", false, "+14165550100", otpViaStored},
		{"production", false, "+14165550100", otpViaStored},
	}
	for _, tc := range cases {
		got := otpDelivery(tc.env, tc.verifier, tc.phone)
		if got != tc.want {
			t.Errorf("otpDelivery(%q, verifier=%v, %s) = %q, want %q", tc.env, tc.verifier, tc.phone, got, tc.want)
		}
	}
}
