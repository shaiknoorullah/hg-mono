// Package rider implements the rider self-service surface: onboarding,
// profile, vehicle registration, document management, and the dashboard.
//
// All endpoints are scoped to the authenticated caller's own rider account;
// the server derives identity from the JWT (never a client-supplied id).
//
// Spec: docs/spec/04-rider.md
// Contract: contracts/openapi.yaml, operationIds getRiderMe,
// getRiderOnboardingStatus, submitRiderProfile, submitRiderVehicle,
// listRiderDocuments, attachRiderDocument, submitRiderDocuments,
// getRiderDashboard.
package rider
