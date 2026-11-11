package exitpolicy

import (
	"errors"
	"net/netip"
	"regexp"
	"strings"
	"time"
)

// Policy is user configuration. Its anchor survives checks and restarts;
// observations must never silently replace a configured address or region.
type Policy struct {
	Mode        string `json:"mode"`
	Scope       string `json:"scope"`
	IP          string `json:"ip,omitempty"`
	CountryCode string `json:"country_code,omitempty"`
	Region      string `json:"region,omitempty"`
	City        string `json:"city,omitempty"`
}

type Location struct {
	IP, CountryCode, Region, City string
	Country, RegionCode, Timezone string
	CheckedAt                     time.Time
}

type State string

const (
	Passed  State = "passed"
	Failed  State = "failed"
	Unknown State = "unknown"
)

func (p Policy) Normalized() Policy {
	if p.Mode == "" {
		p.Mode = "dynamic"
	}
	if p.Scope == "" {
		p.Scope = "country"
	}
	p.IP = strings.TrimSpace(p.IP)
	p.CountryCode = strings.ToUpper(strings.TrimSpace(p.CountryCode))
	p.Region = strings.Join(strings.Fields(p.Region), " ")
	p.City = strings.Join(strings.Fields(p.City), " ")
	return p
}

func (p Policy) Validate() error {
	p = p.Normalized()
	if p.Mode != "static" && p.Mode != "dynamic" {
		return errors.New("Choose a static or dynamic IP.")
	}
	if p.Scope != "any" && p.Scope != "country" && p.Scope != "region" && p.Scope != "city" {
		return errors.New("Choose the allowed range for the dynamic IP.")
	}
	if p.IP != "" {
		ip, err := netip.ParseAddr(p.IP)
		if err != nil || !ip.Is4() || !ip.IsGlobalUnicast() || ip.IsPrivate() {
			return errors.New("A fixed exit needs a public IPv4 address.")
		}
	}
	if p.CountryCode != "" && !regexp.MustCompile(`^[A-Z]{2}$`).MatchString(p.CountryCode) {
		return errors.New("The country or region code must be two letters, for example US.")
	}
	if len(p.Region) > 120 || len(p.City) > 120 {
		return errors.New("The region name is too long.")
	}
	return nil
}

func (p Policy) NeedsBinding() bool {
	p = p.Normalized()
	if p.Mode == "static" {
		return p.IP == ""
	}
	return p.Scope != "any" && (p.CountryCode == "" || (p.Scope == "region" || p.Scope == "city") && p.Region == "" || p.Scope == "city" && p.City == "")
}

// BindMissing is used only for a previously unconfigured anchor. It leaves
// existing values intact, including when the new observation violates them.
func (p Policy) BindMissing(location Location) Policy {
	p = p.Normalized()
	if state, _ := CheckExitCountry(location.IP, &location); state != Passed {
		return p
	}
	if p.Mode == "static" && p.IP == "" {
		p.IP = location.IP
	}
	if p.Mode == "dynamic" && p.Scope != "any" {
		if p.CountryCode == "" {
			p.CountryCode = location.CountryCode
		}
		if (p.Scope == "region" || p.Scope == "city") && strings.EqualFold(p.CountryCode, location.CountryCode) {
			if p.Region == "" {
				p.Region = location.Region
			}
			if p.Scope == "city" && p.City == "" {
				p.City = location.City
			}
		}
	}
	return p.Normalized()
}

func (p Policy) Evaluate(ip string, location *Location) (State, string) {
	p = p.Normalized()
	if err := p.Validate(); err != nil {
		return Unknown, err.Error()
	}
	if state, message := CheckExitCountry(ip, location); state != Passed {
		return state, message
	}
	if p.NeedsBinding() {
		if p.Mode == "dynamic" && p.CountryCode == "" {
			return Unknown, "The allowed country or region for the dynamic IP is not bound yet. Internet access stays off. Confirm the exit region in the network and proxy settings"
		}
		return Unknown, "No exit rule is bound yet. Confirm the detected IP or region in Settings"
	}
	if p.Mode == "static" {
		if p.IP != ip {
			return Failed, "The check exit has drifted from the bound static IP"
		}
		return Passed, "The check exit matches the bound static IP"
	}
	if p.Scope == "any" {
		return Passed, "The dynamic IP may change outside mainland China, and traffic must still go through the specified proxy"
	}
	if !strings.EqualFold(p.CountryCode, location.CountryCode) {
		return Failed, "The check exit is outside the allowed countries or regions"
	}
	if p.Scope == "country" {
		return Passed, "The check exit is in an allowed country or region"
	}
	if location.Region == "" {
		return Unknown, "The current location has no state or province, so the allowed range cannot be confirmed"
	}
	if !strings.EqualFold(p.Region, strings.Join(strings.Fields(location.Region), " ")) {
		return Failed, "The check exit is outside the allowed states or provinces"
	}
	if p.Scope == "region" {
		return Passed, "The check exit is in an allowed state or province"
	}
	if location.City == "" {
		return Unknown, "The current location has no state, province or city, so the city range cannot be confirmed"
	}
	if !strings.EqualFold(p.City, strings.Join(strings.Fields(location.City), " ")) {
		return Failed, "The check exit is outside the allowed city range"
	}
	return Passed, "The check exit is in an allowed city and its state or province"
}
