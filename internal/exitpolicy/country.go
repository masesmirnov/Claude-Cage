package exitpolicy

import (
	_ "embed"
	"fmt"
	"net/netip"
	"strings"
)

// The list applies to observed EXIT addresses, never destination servers or
// proxy entry points. IPv6 business egress is separately denied by EgressGate.
//
//go:embed data/mainland-ipv4.txt
var mainlandIPv4 string

var mainlandPrefixes, mainlandListError = parseMainlandPrefixes(mainlandIPv4)

func parseMainlandPrefixes(data string) ([]netip.Prefix, error) {
	var prefixes []netip.Prefix
	for _, line := range strings.Fields(data) {
		prefix, err := netip.ParsePrefix(line)
		if err != nil || !prefix.Addr().Is4() || prefix.Bits() < 8 || prefix != prefix.Masked() {
			return nil, fmt.Errorf("invalid bundled mainland prefix %q", line)
		}
		prefixes = append(prefixes, prefix)
	}
	if len(prefixes) == 0 {
		return nil, fmt.Errorf("bundled mainland prefix list is empty")
	}
	return prefixes, nil
}

// CheckExitCountry is mandatory independently of the user-selected IP rule.
// A mainland list match is enough to deny; absence from the list cannot prove
// a non-mainland exit and still requires matching country evidence.
func CheckExitCountry(ip string, location *Location) (State, string) {
	address, err := netip.ParseAddr(ip)
	if err != nil || !address.Is4() || !address.IsGlobalUnicast() || address.IsPrivate() {
		return Unknown, "No valid check exit has been obtained yet"
	}
	if mainlandListError != nil {
		return Unknown, "The mainland China exit network range library is unavailable. Internet access stays off"
	}
	for _, prefix := range mainlandPrefixes {
		if prefix.Contains(address) {
			return Failed, "The check exit matches a mainland China IP range. Cage does not allow mainland China exits. Internet access stays off"
		}
	}
	if location == nil || location.IP != address.String() {
		return Unknown, "Could not confirm the exit country or region. Internet access stays off"
	}
	country := strings.ToUpper(strings.TrimSpace(location.CountryCode))
	if len(country) != 2 || country[0] < 'A' || country[0] > 'Z' || country[1] < 'A' || country[1] > 'Z' || country == "ZZ" || country == "XX" {
		return Unknown, "Could not confirm the exit country or region. Internet access stays off"
	}
	if country == "CN" {
		return Failed, "The check exit is in mainland China. Cage does not allow mainland China exits. Internet access stays off"
	}
	return Passed, "The check exit does not match a mainland China range, and the country or region meets the non-mainland exit requirement"
}
