// Package devworld builds a resettable local database of stable personas.
//
// The personas are reference data: accounts, restaurants, riders, menus and
// certificates. Orders, payments and dispatch are not inserted here. Those are
// produced later by calling the API, so a scenario exercises the same path the
// apps use.
//
// Reset refuses every database that is not a local development database. The
// SQL under migrations/devworld is not a goose migration and is never applied
// by make migrate or by a deploy.
package devworld
