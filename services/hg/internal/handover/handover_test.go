package handover

import "testing"

// TestSealedCodeOpensOnlyForItsOrderAndKind pins the storage rule
// (https://github.com/shaiknoorullah/hg-mono/issues/289): a code is sealed to
// one order and one handover, so a ciphertext copied to another order, or from
// the pickup column to the delivery column, never opens and never matches.
func TestSealedCodeOpensOnlyForItsOrderAndKind(t *testing.T) {
	const orderA = "01a1068b-2028-7a8c-b0f4-07bd2004ebcf"
	const orderB = "01a1068b-2028-7a8c-b0f4-07bd2004ebd0"
	code, err := newCode()
	if err != nil || !WellFormed(code) {
		t.Fatalf("newCode() = %q, %v; want four digits", code, err)
	}
	sealed, err := seal(orderA, Pickup, code)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	if got := Reveal(orderA, Pickup, sealed); got == nil || *got != code {
		t.Fatalf("Reveal on its own order and kind = %v, want %s", got, code)
	}
	if !matches(orderA, Pickup, sealed, code) {
		t.Error("the right code does not match")
	}
	wrong := "0000"
	if code == wrong {
		wrong = "0001"
	}
	for name, ok := range map[string]bool{
		"a wrong code":                   matches(orderA, Pickup, sealed, wrong),
		"the code on another order":      matches(orderB, Pickup, sealed, code),
		"the code as the other handover": matches(orderA, Delivery, sealed, code),
		"no code stored":                 matches(orderA, Pickup, nil, code),
		"a malformed code":               matches(orderA, Pickup, sealed, code+"0"),
	} {
		if ok {
			t.Errorf("%s matched", name)
		}
	}
	if Reveal(orderB, Pickup, sealed) != nil || Reveal(orderA, Delivery, sealed) != nil {
		t.Error("a sealed code opened outside its order and kind")
	}
}
