// Throwaway dev helper: print the current 6-digit TOTP code for a base32 secret
// (from cmd/seedtotp). Used to drive an MFA login in dev. Delete after use.
package main

import (
	"fmt"
	"os"
	"time"

	"github.com/pquerna/otp/totp"
)

func main() {
	secret := os.Getenv("SECRET")
	if secret == "" {
		fmt.Println("SECRET required")
		os.Exit(1)
	}
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		panic(err)
	}
	fmt.Println(code)
}
