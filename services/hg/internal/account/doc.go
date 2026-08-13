// Package account implements the self-service profile, push-device registration,
// and notification inbox for the Halal Goes API.
//
// Operations:
//   - updateCustomerProfile [PATCH /v1/me/profile]        x-roles: CUSTOMER
//   - registerDevice        [POST /v1/devices]            x-roles: CUSTOMER,RIDER,RESTAURANT_OWNER,RESTAURANT_MANAGER,RESTAURANT_STAFF
//   - unregisterDevice      [DELETE /v1/devices/{deviceId}] x-roles: same as above
//   - listNotifications     [GET /v1/notifications]       x-roles: same as above
//   - markNotificationRead  [POST /v1/notifications/{notificationId}/read] x-roles: same as above
//
// Invariants (from AGENTS.md):
//   - Ownership / IDOR: every query is scoped by account_id = caller; a
//     foreign resource returns 404, never 403 or another tenant's data.
//   - Inbound bodies may not carry price/amount fields (invariant 1).
//   - DisallowUnknownFields on every decode (invariant 2).
//   - Deny by default: no route is Public.
package account
