// Package addresses serves the customer delivery-address surface:
// listAddresses, createAddress, getAddress, updateAddress, deleteAddress
// and setDefaultAddress.
//
// Every query is scoped to the caller's account_id; a resource belonging
// to a different account returns 404 (ownership never leaks to 403).
//
// The PostGIS point is resolved server-side from the inbound latitude/longitude
// and stored as geography(Point,4326). The caller never supplies timezone;
// the server derives it from the point.
//
// Spec: C-30 / P-30.
// Contract: /v1/addresses  and  /v1/addresses/{addressId}[/default].
package addresses
