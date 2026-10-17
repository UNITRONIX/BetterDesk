package auth

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

type oidcFetchPolicy struct {
	allowedPrivateCIDRs []netip.Prefix
}

// ValidateOIDCAllowedPrivateCIDRs validates the optional private-network
// allowlist used for on-premises OIDC providers. Entries may be IP addresses
// or CIDRs, but must be contained entirely within RFC1918 or IPv6 ULA space.
func ValidateOIDCAllowedPrivateCIDRs(raw string) error {
	_, err := newOIDCFetchPolicy(raw)
	return err
}

func newOIDCFetchPolicy(raw string) (oidcFetchPolicy, error) {
	var policy oidcFetchPolicy
	for _, entry := range strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == '\n' || r == '\r' || r == '\t' || r == ' '
	}) {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			if addr, addrErr := netip.ParseAddr(entry); addrErr == nil {
				prefix = netip.PrefixFrom(addr, addr.BitLen())
			} else {
				return policy, fmt.Errorf("invalid private OIDC network %q", entry)
			}
		}
		prefix = prefix.Masked()
		if !isAllowedPrivatePrefix(prefix) {
			return policy, fmt.Errorf("OIDC private network %q is not entirely RFC1918 or IPv6 ULA space", entry)
		}
		policy.allowedPrivateCIDRs = append(policy.allowedPrivateCIDRs, prefix)
	}
	return policy, nil
}

func isAllowedPrivatePrefix(prefix netip.Prefix) bool {
	if !prefix.IsValid() {
		return false
	}
	addr := prefix.Addr().Unmap()
	if addr.Is4() {
		for _, private := range []netip.Prefix{
			netip.MustParsePrefix("10.0.0.0/8"),
			netip.MustParsePrefix("172.16.0.0/12"),
			netip.MustParsePrefix("192.168.0.0/16"),
		} {
			if prefix.Bits() >= private.Bits() && private.Contains(addr) {
				return true
			}
		}
		return false
	}
	return addr.Is6() &&
		prefix.Bits() >= 7 &&
		netip.MustParsePrefix("fc00::/7").Contains(addr)
}

func (p oidcFetchPolicy) allowsPrivate(addr netip.Addr) bool {
	addr = addr.Unmap()
	for _, prefix := range p.allowedPrivateCIDRs {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}

// validateOIDCFetchURL checks an OIDC HTTP(S) URL before the server fetches
// it. Network destinations are checked separately because hostnames require a
// DNS lookup.
func validateOIDCFetchURL(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, fmt.Errorf("OIDC URL must use http or https")
	}
	if u.User != nil {
		return nil, fmt.Errorf("OIDC URL must not contain credentials")
	}
	host := u.Hostname()
	if host == "" {
		return nil, fmt.Errorf("OIDC URL missing host")
	}
	return u, nil
}

func validateOIDCFetchHost(host string) error {
	return validateOIDCFetchHostWithPolicy(host, oidcFetchPolicy{})
}

func validateOIDCFetchHostWithPolicy(host string, policy oidcFetchPolicy) error {
	if strings.EqualFold(host, "localhost") {
		return fmt.Errorf("OIDC URL host not allowed")
	}
	if ip := net.ParseIP(host); ip != nil {
		return validateOIDCFetchIPWithPolicy(ip, policy)
	}
	return nil
}

func validateOIDCFetchIP(ip net.IP) error {
	return validateOIDCFetchIPWithPolicy(ip, oidcFetchPolicy{})
}

func validateOIDCFetchIPWithPolicy(ip net.IP, policy oidcFetchPolicy) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return fmt.Errorf("OIDC URL host not allowed")
	}
	addr = addr.Unmap()
	if addr.IsLoopback() || addr.IsLinkLocalUnicast() || addr.IsUnspecified() || addr.IsMulticast() {
		return fmt.Errorf("OIDC URL host not allowed")
	}
	if addr.IsPrivate() && !policy.allowsPrivate(addr) {
		return fmt.Errorf("OIDC URL host not allowed")
	}
	return nil
}

func resolveOIDCFetchHost(ctx context.Context, host string) error {
	_, err := lookupOIDCFetchHostAddrs(ctx, host, oidcFetchPolicy{})
	return err
}

func lookupOIDCFetchHostAddrs(ctx context.Context, host string, policy oidcFetchPolicy) ([]net.IP, error) {
	if err := validateOIDCFetchHostWithPolicy(host, policy); err != nil {
		return nil, err
	}
	if ip := net.ParseIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("OIDC URL host lookup failed: %w", err)
	}
	if len(addrs) == 0 {
		return nil, fmt.Errorf("OIDC URL host lookup returned no addresses")
	}
	validated := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		if err := validateOIDCFetchIPWithPolicy(addr.IP, policy); err != nil {
			return nil, err
		}
		validated = append(validated, addr.IP)
	}
	return validated, nil
}

// oidcHostResolver validates OIDC hosts before outbound fetch (overridable in tests).
var oidcHostResolver = resolveOIDCFetchHost

// oidcHostLookup resolves and validates the addresses used by the actual
// connection. Keeping this separate makes the dialer testable without
// weakening the production policy.
var oidcHostLookup = lookupOIDCFetchHostAddrs

func buildOIDCFetchURL(u *url.URL) string {
	safe := &url.URL{
		Scheme:   u.Scheme,
		Host:     u.Host,
		Path:     u.EscapedPath(),
		RawQuery: u.RawQuery,
		Fragment: "",
	}
	return safe.String()
}

func resolveOIDCFetchHostWithPolicy(ctx context.Context, host string, policy oidcFetchPolicy) error {
	if len(policy.allowedPrivateCIDRs) == 0 {
		if err := oidcHostResolver(ctx, host); err != nil {
			return err
		}
	}
	_, err := oidcHostLookup(ctx, host, policy)
	return err
}

func dialValidatedOIDCHost(ctx context.Context, network, address string, policy oidcFetchPolicy) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("invalid OIDC destination %q: %w", address, err)
	}
	addrs, err := oidcHostLookup(ctx, host, policy)
	if err != nil {
		return nil, err
	}

	dialer := &net.Dialer{}
	var lastErr error
	for _, ip := range addrs {
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("OIDC URL host lookup returned no addresses")
	}
	return nil, lastErr
}

func newValidatedOIDCClient(base *http.Client, policy oidcFetchPolicy) *http.Client {
	if base == nil {
		base = http.DefaultClient
	}
	transport, ok := base.Transport.(*http.Transport)
	if !ok || transport == nil {
		transport = http.DefaultTransport.(*http.Transport)
	}
	transport = transport.Clone()
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		return dialValidatedOIDCHost(ctx, network, address, policy)
	}

	client := *base
	client.Transport = transport
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) > 0 {
			previous := via[len(via)-1].URL
			if !strings.EqualFold(previous.Hostname(), req.URL.Hostname()) || previous.Port() != req.URL.Port() {
				return fmt.Errorf("OIDC redirect changes host")
			}
		}
		if _, err := validateOIDCFetchURL(req.URL.String()); err != nil {
			return err
		}
		if err := resolveOIDCFetchHostWithPolicy(req.Context(), req.URL.Hostname(), policy); err != nil {
			return err
		}
		return nil
	}
	return &client
}

func doValidatedOIDCHTTP(ctx context.Context, client *http.Client, method, raw string, body io.Reader, policy oidcFetchPolicy, headers http.Header) (*http.Response, error) {
	validated, err := validateOIDCFetchURL(raw)
	if err != nil {
		return nil, err
	}
	if err := resolveOIDCFetchHostWithPolicy(ctx, validated.Hostname(), policy); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, method, buildOIDCFetchURL(validated), body)
	if err != nil {
		return nil, err
	}
	for key, values := range headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	return newValidatedOIDCClient(client, policy).Do(req)
}

// fetchValidatedHTTPGet performs an HTTP GET only after validateOIDCFetchURL
// succeeds and the destination is resolved through the SSRF policy.
func fetchValidatedHTTPGet(client *http.Client, raw string) (*http.Response, error) {
	return fetchValidatedHTTPGetContext(context.Background(), client, raw)
}

// fetchValidatedHTTPGetContext is like fetchValidatedHTTPGet but honors ctx cancellation.
func fetchValidatedHTTPGetContext(ctx context.Context, client *http.Client, raw string) (*http.Response, error) {
	return doValidatedOIDCHTTP(ctx, client, http.MethodGet, raw, nil, oidcFetchPolicy{}, nil)
}

func fetchValidatedHTTPGetWithPolicy(ctx context.Context, client *http.Client, raw string, policy oidcFetchPolicy) (*http.Response, error) {
	return doValidatedOIDCHTTP(ctx, client, http.MethodGet, raw, nil, policy, nil)
}

func fetchValidatedHTTPGetWithHeaders(ctx context.Context, client *http.Client, raw string, policy oidcFetchPolicy, headers http.Header) (*http.Response, error) {
	return doValidatedOIDCHTTP(ctx, client, http.MethodGet, raw, nil, policy, headers)
}

func fetchValidatedHTTPPostWithPolicy(ctx context.Context, client *http.Client, raw string, body io.Reader, policy oidcFetchPolicy, headers http.Header) (*http.Response, error) {
	return doValidatedOIDCHTTP(ctx, client, http.MethodPost, raw, body, policy, headers)
}
