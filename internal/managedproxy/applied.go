package managedproxy

import "errors"

// Applied is the single source of truth for the private endpoint used by Cage.
func Applied(profile, endpoint, revision string) (Store, error) {
	p, err := Load(profile)
	if err != nil {
		return p, err
	}
	if _, ok := p.Find(p.Selected); !ok {
		return p, errors.New("No proxy node has been selected yet. Add a source and select a node in Network and proxy.")
	}
	if revision == "" || p.Revision == "" || revision != p.Revision || endpoint != p.Endpoint() {
		return p, errors.New("The proxy node has not been applied or its configuration is inconsistent. Apply the node again; internet access stays off.")
	}
	if _, err := p.Route(); err != nil {
		return p, err
	}
	return p, nil
}
