package auth

import (
	"net/url"
	"strings"
)

// MaxOIDCPictureLen caps the "picture" claim passed on to the console.
// authentik sends an uploaded picture inline as a base64 data: URL, so the
// cap has to fit a small image (1.5 MB of base64 is about 1.1 MB of image).
// The console applies its own, smaller limit to the decoded bytes.
const MaxOIDCPictureLen = 1536 * 1024

// oidcTokenResponseLimit bounds the token and userinfo responses. It is
// larger than MaxOIDCPictureLen because the ID token and the userinfo
// document may both carry an inline data: URL picture.
const oidcTokenResponseLimit = 4 << 20

// allowedOIDCPictureDataPrefixes lists the inline image types the console
// accepts. SVG is left out on purpose: it can carry script.
var allowedOIDCPictureDataPrefixes = []string{
	"data:image/png;base64,",
	"data:image/jpeg;base64,",
	"data:image/webp;base64,",
	"data:image/gif;base64,",
}

// SanitizeOIDCPicture returns the picture claim when it is an absolute
// http(s) URL or a base64 data: URL of a PNG, JPEG, WebP or GIF image no
// longer than MaxOIDCPictureLen, and "" for anything else. It only checks
// the form; the console fetches or decodes the image and checks its bytes.
func SanitizeOIDCPicture(raw string) string {
	pic := strings.TrimSpace(raw)
	if pic == "" || len(pic) > MaxOIDCPictureLen {
		return ""
	}
	if strings.ContainsAny(pic, "\r\n\t\x00 ") {
		return ""
	}
	lower := strings.ToLower(pic)
	if strings.HasPrefix(lower, "data:") {
		for _, prefix := range allowedOIDCPictureDataPrefixes {
			if strings.HasPrefix(lower, prefix) {
				payload := pic[len(prefix):]
				if payload == "" || !isBase64Payload(payload) {
					return ""
				}
				// Normalise the media type to lower case; the payload is kept as is.
				return prefix + payload
			}
		}
		return ""
	}
	u, err := url.Parse(pic)
	if err != nil || u.Host == "" || u.User != nil {
		return ""
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return ""
	}
	return pic
}

func isBase64Payload(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		case c == '+', c == '/', c == '=', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}
