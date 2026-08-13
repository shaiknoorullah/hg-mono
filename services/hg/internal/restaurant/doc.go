// Package restaurant serves the restaurant partner surface:
// onboarding, profile, trading hours, compliance documents,
// menu management and the live order dashboard.
//
// Every handler resolves the caller's restaurant from the authenticated
// principal's account_role grant (P-07 ownership), never from a request
// body or path parameter. A principal with no RESTAURANT-scoped grant
// gets 404 on any resource lookup, never 403 (ownership leaks nothing).
//
// Spec sections: R-01 … R-26.
package restaurant
