package devworld

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestInterpolateKeepsEnds(t *testing.T) {
	pts := interpolate(shortStart, restaurantPoint, 6)
	if len(pts) != 6 {
		t.Fatalf("len %d", len(pts))
	}
	if pts[0] != shortStart || pts[5] != restaurantPoint {
		t.Fatalf("ends %+v %+v", pts[0], pts[5])
	}
	if pts[3].Lat >= pts[0].Lat || pts[3].Lat <= pts[5].Lat {
		t.Fatalf("midpoint not between the ends: %+v", pts[3])
	}
}

func TestStraightPickupNeedsNoNetwork(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("straight pickup called the network")
		return nil, nil
	})}
	for _, kind := range []string{"short", "long", "early-rider"} {
		pts, how := pickupLeg(context.Background(), kind, "", client)
		if how != "straight" {
			t.Fatalf("%s how %s", kind, how)
		}
		if len(pts) < 2 || pts[len(pts)-1] != restaurantPoint {
			t.Fatalf("%s last %+v len %d", kind, pts[len(pts)-1], len(pts))
		}
	}
}

func TestPickupLegUsesDirectionsWhenTokenSet(t *testing.T) {
	const body = `{"routes":[{"geometry":{"coordinates":[[-79.331000,43.684200],[-79.331000,43.682000],[-79.331000,43.681500]]}}]}`
	var sawToken bool
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if strings.Contains(r.URL.RawQuery, "access_token=test-token") {
			sawToken = true
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       ioNop(body),
			Header:     make(http.Header),
		}, nil
	})}
	pts, how := pickupLeg(context.Background(), "short", "test-token", client)
	if !sawToken || how != "mapbox" {
		t.Fatalf("how %s token %v", how, sawToken)
	}
	if pts[len(pts)-1] != restaurantPoint {
		t.Fatalf("last %+v", pts[len(pts)-1])
	}
}

func TestPickupLegFallsBackWhenDirectionsFail(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusUnauthorized,
			Body:       ioNop(`{"message":"no"}`),
			Header:     make(http.Header),
		}, nil
	})}
	pts, how := pickupLeg(context.Background(), "short", "test-token", client)
	if how != "straight" || pts[len(pts)-1] != restaurantPoint {
		t.Fatalf("how %s last %+v", how, pts[len(pts)-1])
	}
}

func TestStepWait(t *testing.T) {
	if stepWait("max") != 0 || stepWait("4x") != 1250*time.Millisecond || stepWait("1x") != 5*time.Second {
		t.Fatalf("pace max %s 4x %s 1x %s", stepWait("max"), stepWait("4x"), stepWait("1x"))
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func ioNop(s string) io.ReadCloser { return io.NopCloser(strings.NewReader(s)) }
