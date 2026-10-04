package realtime

import (
	"reflect"
	"strings"

	"github.com/shaiknoorullah/hg-mono/services/hg/internal/contract"
)

// schemaBundle returns the RealtimeSchemaBundle getRealtimeSchema serves
// (contracts/websocket.md section 2: "Schemas are served at GET
// /v1/realtime/schema, keyed {type}@v{version}"). Each value is a JSON Schema
// (draft 2020-12 style: a nullable field is a type array with "null") for one
// event's payload, generated from the contract payload type in wire.go:
// every field is required, no other field is allowed, and an enum field lists
// the values of the openapi.yaml enum it names.
//
// The schema describes what every role may receive. A role whose serializer
// withholds a field sends null there, so every withheld field is nullable in
// the contract payload type.
func schemaBundle() realtimeSchemaBundle {
	events := make(map[string]map[string]any, len(catalogue))
	for _, s := range catalogue {
		events[s.typ+"@v1"] = schemaFor(s.wire)
	}
	return realtimeSchemaBundle{Protocol: Protocol, Events: events}
}

type realtimeSchemaBundle struct {
	Protocol int                       `json:"protocol"`
	Events   map[string]map[string]any `json:"events"`
}

// SchemaFor returns the JSON Schema of one event type's payload, or nil when the
// type is not in the catalogue.
func SchemaFor(eventType string) map[string]any {
	s, ok := byType[eventType]
	if !ok {
		return nil
	}
	return schemaFor(s.wire)
}

var (
	timestampType = reflect.TypeFor[Timestamp]()
	withheldType  = reflect.TypeFor[Withheld]()
)

// schemaFor builds the schema of a Go type. Pointers are nullable; structs are
// closed objects whose every field is required.
func schemaFor(t reflect.Type) map[string]any {
	if t.Kind() == reflect.Pointer {
		inner := schemaFor(t.Elem())
		return nullable(inner)
	}
	switch {
	case t == timestampType:
		return map[string]any{"type": "string", "format": "date-time"}
	case t == withheldType:
		return map[string]any{"type": "null"}
	}
	if values, ok := enumValues[t]; ok {
		enum := make([]any, len(values))
		for i, v := range values {
			enum[i] = v
		}
		return map[string]any{"type": "string", "enum": enum}
	}
	switch t.Kind() {
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int32, reflect.Int64:
		return map[string]any{"type": "integer"}
	case reflect.Float32, reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.Slice:
		return map[string]any{"type": "array", "items": schemaFor(t.Elem())}
	case reflect.Struct:
		props := map[string]any{}
		required := []any{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			name, ok := jsonName(f)
			if !ok {
				continue
			}
			props[name] = schemaFor(f.Type)
			required = append(required, name)
		}
		return map[string]any{
			"type":                 "object",
			"properties":           props,
			"required":             required,
			"additionalProperties": false,
		}
	}
	panic("realtime: no schema for Go type " + t.String())
}

// nullable admits null as well as the inner schema.
func nullable(inner map[string]any) map[string]any {
	out := make(map[string]any, len(inner))
	for k, v := range inner {
		out[k] = v
	}
	out["type"] = []any{inner["type"], "null"}
	if enum, ok := inner["enum"].([]any); ok {
		out["enum"] = append(append([]any{}, enum...), nil)
	}
	return out
}

// jsonName is the wire name of a struct field, or false when it is not encoded.
func jsonName(f reflect.StructField) (string, bool) {
	if !f.IsExported() {
		return "", false
	}
	tag := f.Tag.Get("json")
	if tag == "-" {
		return "", false
	}
	name, _, _ := strings.Cut(tag, ",")
	if name == "" {
		name = f.Name
	}
	return name, true
}

// enumDef is one closed string set and its Go type.
type enumDef struct {
	t      reflect.Type
	values []string
}

func enumOf[E ~string](vals ...E) enumDef {
	out := make([]string, len(vals))
	for i, v := range vals {
		out[i] = string(v)
	}
	return enumDef{t: reflect.TypeFor[E](), values: out}
}

// enumValues maps each enum type a payload uses to its members. The contract
// enums list the generated constants from contracts/openapi.yaml, so removing a
// member breaks the build here; catalogue_contract_test.go checks each list
// against openapi.yaml, so adding one fails the tests until it is listed.
var enumValues = func() map[reflect.Type][]string {
	m := map[reflect.Type][]string{}
	for _, e := range []enumDef{
		enumOf(
			contract.OrderStateARRIVED, contract.OrderStateAUTHORIZED, contract.OrderStateCANCELLED,
			contract.OrderStateCOMPLETED, contract.OrderStateCREATED, contract.OrderStateDELIVERED,
			contract.OrderStateDISPUTED, contract.OrderStateFAILED, contract.OrderStatePICKEDUP,
			contract.OrderStatePREPARING, contract.OrderStateREADYFORPICKUP, contract.OrderStateREJECTED,
			contract.OrderStateRESOLVED, contract.OrderStateRESTAURANTPENDING,
		),
		enumOf(
			contract.OrderActorKindADMIN, contract.OrderActorKindCUSTOMER, contract.OrderActorKindRESTAURANT,
			contract.OrderActorKindRIDER, contract.OrderActorKindSUPPORT, contract.OrderActorKindSYSTEM,
		),
		enumOf(
			contract.OrderCancellationReasonCodeCAPTUREFAILED, contract.OrderCancellationReasonCodeCUSTOMERCANCELLED,
			contract.OrderCancellationReasonCodeFRAUDSUSPECTED, contract.OrderCancellationReasonCodeITEMUNAVAILABLE,
			contract.OrderCancellationReasonCodeNORIDERFOUND, contract.OrderCancellationReasonCodePAYMENTEXPIRED,
			contract.OrderCancellationReasonCodePLATFORMERROR, contract.OrderCancellationReasonCodePREPOVERDUE,
			contract.OrderCancellationReasonCodeRESTAURANTCLOSED,
			contract.OrderCancellationReasonCodeRESTAURANTTIMEOUT,
			contract.OrderCancellationReasonCodeSUPPORTCANCELLED,
		),
		enumOf(
			contract.RefundKindFEESONLY, contract.RefundKindFULL, contract.RefundKindGOODWILL,
			contract.RefundKindPARTIALITEMS,
		),
		enumOf(
			contract.RefundReasonCodeCHARGEBACKPREEMPTIVE, contract.RefundReasonCodeCHARGEDINCORRECTLY,
			contract.RefundReasonCodeCUSTOMERCHANGEDMIND, contract.RefundReasonCodeDAMAGEDSPILLED,
			contract.RefundReasonCodeDISPUTERESOLUTION, contract.RefundReasonCodeDUPLICATECHARGE,
			contract.RefundReasonCodeFOODQUALITY, contract.RefundReasonCodeFOODSAFETY,
			contract.RefundReasonCodeGOODWILL, contract.RefundReasonCodeHALALCONCERN,
			contract.RefundReasonCodeHALALINTEGRITY, contract.RefundReasonCodeITEMMISSING,
			contract.RefundReasonCodeLATEDELIVERY, contract.RefundReasonCodeMISSINGITEMS,
			contract.RefundReasonCodeNEVERDELIVERED, contract.RefundReasonCodeNORIDERFOUND,
			contract.RefundReasonCodeORDERNEVERARRIVED, contract.RefundReasonCodeOTHER,
			contract.RefundReasonCodePLATFORMERROR, contract.RefundReasonCodePLATFORMINITIATEDCANCELLATION,
			contract.RefundReasonCodePRICINGERROR, contract.RefundReasonCodeRESTAURANTCANCELLED,
			contract.RefundReasonCodeRESTAURANTREJECTED, contract.RefundReasonCodeWRONGITEM,
			contract.RefundReasonCodeWRONGITEMS,
		),
		enumOf(
			contract.RefundStateAPPROVED, contract.RefundStateAUTHORISED, contract.RefundStateCANCELLED,
			contract.RefundStateDECLINED, contract.RefundStateFAILED, contract.RefundStatePENDINGAPPROVAL,
			contract.RefundStateREQUESTED, contract.RefundStateSETTLED, contract.RefundStateSUBMITTED,
			contract.RefundStateSUCCEEDED,
		),
		enumOf(
			contract.RestaurantRejectReasonCodeADDRESSOUTOFRANGE, contract.RestaurantRejectReasonCodeCLOSINGSOON,
			contract.RestaurantRejectReasonCodeEQUIPMENTFAILURE, contract.RestaurantRejectReasonCodeITEMUNAVAILABLE,
			contract.RestaurantRejectReasonCodeKITCHENATCAPACITY, contract.RestaurantRejectReasonCodeOTHER,
			contract.RestaurantRejectReasonCodeSUSPECTEDFRAUD,
		),
		enumOf(
			contract.RestaurantOpenStateCLOSEDHOLIDAY, contract.RestaurantOpenStateCLOSEDHOURS,
			contract.RestaurantOpenStateCLOSEDOFFLINE, contract.RestaurantOpenStateCLOSEDSUSPENDED,
			contract.RestaurantOpenStateCLOSEDTOGGLE, contract.RestaurantOpenStateOPEN,
			contract.RestaurantOpenStatePAUSED,
		),
		enumOf(
			contract.FulfilmentDELIVERY, contract.FulfilmentPICKUP,
		),
		enumOf(
			contract.DispatchStateASSIGNED, contract.DispatchStateATCUSTOMER, contract.DispatchStateATRESTAURANT,
			contract.DispatchStateCARRYING, contract.DispatchStateCOMPLETED, contract.DispatchStateNORIDERFOUND,
			contract.DispatchStateOFFERED, contract.DispatchStatePENDING, contract.DispatchStateSEARCHING,
			contract.DispatchStateUNASSIGNED,
		),
		enumOf(
			contract.OFFLINE, contract.ONDELIVERY, contract.ONLINEIDLE, contract.ONLINESTALE,
		),
		enumOf(
			contract.BICYCLE, contract.CAR, contract.MOTORCYCLE, contract.ONFOOT, contract.SCOOTER,
		),
		enumOf(
			contract.PayoutStateDRAFT, contract.PayoutStateFAILED, contract.PayoutStateHELD, contract.PayoutStatePAID,
			contract.PayoutStateREADY, contract.PayoutStateTRANSFERRED, contract.PayoutStateTRANSFERRING,
		),
		enumOf(
			contract.KycDocumentStateAPPROVED, contract.KycDocumentStateEXPIRED, contract.KycDocumentStateINREVIEW,
			contract.KycDocumentStateREJECTED, contract.KycDocumentStateSUBMITTED, contract.KycDocumentStateSUPERSEDED,
		),
		// The closed sets the contract spells out inline (events.go).
		enumOf(EtaRouted, EtaCached, EtaFallback),
		enumOf(OfferExpiredTimeout),
		enumOf(OfferWithdrawnCustomerCancelled, OfferWithdrawnPaymentFailed),
		enumOf(DispatchWithdrawnTaken, DispatchWithdrawnExpired, DispatchWithdrawnCancelled),
		enumOf(SecurityNewDeviceLogin, SecurityPasswordChanged, SecuritySessionRevoked),
		enumOf(OnboardingRestaurant, OnboardingRider),
	} {
		m[e.t] = e.values
	}
	return m
}()
