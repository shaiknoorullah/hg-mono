package addresses

// addressInputDTO mirrors the AddressInput schema from the contract.
// Fields not in the schema are intentionally absent so DisallowUnknownFields
// rejects them (additionalProperties:false, G-3).
//
// Server-controlled fields that must NEVER appear here:
//   - country    (fixed CA by the server)
//   - timezone   (derived from the PostGIS point)
//   - id, created_at, updated_at, deleted_at  (server-assigned)
type addressInputDTO struct {
	Label         *string `json:"label"`
	Line1         string  `json:"line1"`
	Line2         *string `json:"line2"`
	Unit          *string `json:"unit"`
	Buzzer        *string `json:"buzzer"`
	City          string  `json:"city"`
	Province      string  `json:"province"`
	PostalCode    string  `json:"postal_code"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	DeliveryNotes *string `json:"delivery_notes"`
	IsDefault     *bool   `json:"is_default"`
}

// addressUpdateInputDTO mirrors the AddressUpdateInput schema from the contract.
// All fields optional (PATCH semantics). Same server-controlled field exclusions
// as addressInputDTO.
type addressUpdateInputDTO struct {
	Label         *string  `json:"label"`
	Line1         *string  `json:"line1"`
	Line2         *string  `json:"line2"`
	Unit          *string  `json:"unit"`
	Buzzer        *string  `json:"buzzer"`
	City          *string  `json:"city"`
	Province      *string  `json:"province"`
	PostalCode    *string  `json:"postal_code"`
	Latitude      *float64 `json:"latitude"`
	Longitude     *float64 `json:"longitude"`
	DeliveryNotes *string  `json:"delivery_notes"`
	IsDefault     *bool    `json:"is_default"`
}

// addressDTO is the wire-shape returned in every Address response.
type addressDTO struct {
	ID            string  `json:"id"`
	Label         *string `json:"label"`
	Line1         string  `json:"line1"`
	Line2         *string `json:"line2"`
	Unit          *string `json:"unit"`
	Buzzer        *string `json:"buzzer"`
	City          string  `json:"city"`
	Province      string  `json:"province"`
	PostalCode    string  `json:"postal_code"`
	Country       string  `json:"country"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	Timezone      string  `json:"timezone"`
	DeliveryNotes *string `json:"delivery_notes"`
	IsDefault     bool    `json:"is_default"`
}
