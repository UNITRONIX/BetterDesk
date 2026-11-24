package meshcentral

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha512"
	"crypto/x509"
	"encoding/asn1"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"
)

// AgentCredentials holds the MeshCentral agent-server RSA certificate used
// for binary handshake (separate from public web TLS).
type AgentCredentials struct {
	PrivateKey  *rsa.PrivateKey
	CertDER     []byte // ASN.1 DER certificate for AuthVerify response
	ServerID    string // hex SHA-384 of cert public key (for .msh ServerID=)
	ServerIDBin []byte // 48-byte binary hash
}

// LoadOrCreateAgentCredentials loads RSA-3072 agent-server credentials or generates new ones.
func LoadOrCreateAgentCredentials(certFile string) (*AgentCredentials, error) {
	if certFile != "" {
		if cred, err := loadAgentCredentials(certFile); err == nil {
			return cred, nil
		}
	}
	key, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return nil, fmt.Errorf("mesh: generate rsa key: %w", err)
	}
	return credentialsFromKey(key, certFile)
}

func loadAgentCredentials(path string) (*AgentCredentials, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("mesh: invalid pem")
	}
	key, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		k, err2 := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err2 != nil {
			return nil, fmt.Errorf("mesh: parse key: %w", err)
		}
		rk, ok := k.(*rsa.PrivateKey)
		if !ok {
			return nil, errors.New("mesh: not rsa private key")
		}
		key = rk
	}
	return credentialsFromKey(key, path)
}

func credentialsFromKey(key *rsa.PrivateKey, savePath string) (*AgentCredentials, error) {
	serial, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		return nil, err
	}
	tmpl := x509.Certificate{
		SerialNumber:          serial,
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		BasicConstraintsValid: true,
	}
	certDER, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		return nil, fmt.Errorf("mesh: create cert: %w", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		return nil, err
	}
	hash := sha512.Sum384(pubDER)
	serverIDHex := strings.ToUpper(fmt.Sprintf("%x", hash))
	cred := &AgentCredentials{
		PrivateKey:  key,
		CertDER:     certDER,
		ServerID:    serverIDHex,
		ServerIDBin: hash[:],
	}
	if savePath != "" {
		if err := saveAgentKey(savePath, key); err != nil {
			return nil, err
		}
	}
	return cred, nil
}

func saveAgentKey(path string, key *rsa.PrivateKey) error {
	dir := filepath.Dir(path)
	if dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return err
		}
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{
		Type:  "RSA PRIVATE KEY",
		Bytes: x509.MarshalPKCS1PrivateKey(key),
	})
	return os.WriteFile(path, pemBytes, 0600)
}

// WebCertHashes contains the two certificate pins used by MeshAgent versions.
// Both values are derived from the same leaf certificate.
type WebCertHashes struct {
	Certificate []byte // SHA-384 of certificate DER
	PublicKey   []byte // SHA-384 of SubjectPublicKeyInfo DER
}

// ParseWebCertHashes parses a PEM or DER certificate and returns both supported
// MeshAgent web-certificate pins for the first certificate in a PEM chain.
func ParseWebCertHashes(certBytes []byte) *WebCertHashes {
	if len(certBytes) == 0 {
		return nil
	}
	der := certBytes
	rest := certBytes
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type == "CERTIFICATE" && len(block.Bytes) > 0 {
			der = block.Bytes
			break
		}
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	pubDER, err := x509.MarshalPKIXPublicKey(cert.PublicKey)
	if err != nil {
		return nil
	}
	certHash := sha512.Sum384(cert.Raw)
	pubHash := sha512.Sum384(pubDER)
	return &WebCertHashes{
		Certificate: certHash[:],
		PublicKey:   pubHash[:],
	}
}

// WebCertHash returns SHA-384 (48 bytes) of a TLS certificate's SPKI public key.
// Accepts PEM (first CERTIFICATE block, e.g. fullchain.pem) or raw DER.
// Returns nil if the input is empty or cannot be parsed as an X.509 certificate.
func WebCertHash(certBytes []byte) []byte {
	hashes := ParseWebCertHashes(certBytes)
	if hashes == nil {
		return nil
	}
	return hashes.PublicKey
}

// SignServerAuth signs webHash+agentNonce+serverNonce for MeshCommand AuthVerify response.
func (c *AgentCredentials) SignServerAuth(webHash, agentNonce, serverNonce []byte) ([]byte, error) {
	data := make([]byte, 0, len(webHash)+len(agentNonce)+len(serverNonce))
	data = append(data, webHash...)
	data = append(data, agentNonce...)
	data = append(data, serverNonce...)
	sum := sha512.Sum384(data)
	sig, err := rsa.SignPKCS1v15(rand.Reader, c.PrivateKey, crypto.SHA384, sum[:])
	if err != nil {
		return nil, err
	}
	return sig, nil
}

// VerifyAgentSignature verifies agent signature over webHash+serverNonce+agentNonce.
func VerifyAgentSignature(certDER, signature, webHash, serverNonce, agentNonce []byte) (string, error) {
	if len(webHash) != sha384Size || len(serverNonce) != sha384Size || len(agentNonce) != sha384Size {
		return "", errors.New("mesh: invalid nonce/hash length")
	}
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return "", fmt.Errorf("mesh: parse agent cert: %w", err)
	}
	pub, ok := cert.PublicKey.(*rsa.PublicKey)
	if !ok {
		return "", errors.New("mesh: agent cert not rsa")
	}
	data := make([]byte, 0, sha384Size*3)
	data = append(data, webHash...)
	data = append(data, serverNonce...)
	data = append(data, agentNonce...)
	sum := sha512.Sum384(data)
	if len(signature) == pub.Size() {
		if err := rsa.VerifyPKCS1v15(pub, crypto.SHA384, sum[:], signature); err != nil {
			return "", fmt.Errorf("mesh: bad signature: %w", err)
		}
	} else {
		pkcs7Signature, err := extractPKCS7Signature(signature, cert)
		if err != nil {
			return "", fmt.Errorf("mesh: bad PKCS#7 signature: %w", err)
		}
		if err := rsa.VerifyPKCS1v15(pub, crypto.SHA384, sum[:], pkcs7Signature); err != nil {
			return "", fmt.Errorf("mesh: bad signature: %w", err)
		}
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", err
	}
	h := sha512.Sum384(pubDER)
	// MeshCentral nodeid: base64 of hash with + -> @ and / -> $
	nodeID := base64NodeID(h[:])
	return nodeID, nil
}

var (
	oidCMSData       = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 1}
	oidCMSSignedData = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 2}
	oidSHA384        = asn1.ObjectIdentifier{2, 16, 840, 1, 101, 3, 4, 2, 2}
	oidRSAEncryption = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 1, 1}
	oidSHA384WithRSA = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 1, 12}
)

type cmsAlgorithmIdentifier struct {
	Algorithm  asn1.ObjectIdentifier
	Parameters asn1.RawValue `asn1:"optional"`
}

type cmsContentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"explicit,tag:0"`
}

type cmsEncapsulatedContentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"optional,explicit,tag:0"`
}

type cmsSignerInfo struct {
	Version            int
	SignerIdentifier   asn1.RawValue
	DigestAlgorithm    cmsAlgorithmIdentifier
	SignedAttrs        asn1.RawValue `asn1:"optional,tag:0"`
	SignatureAlgorithm cmsAlgorithmIdentifier
	EncryptedDigest    []byte
	UnsignedAttrs      asn1.RawValue `asn1:"optional,tag:1"`
}

type cmsSignedData struct {
	Version          int
	DigestAlgorithms []cmsAlgorithmIdentifier `asn1:"set"`
	EncapContentInfo cmsEncapsulatedContentInfo
	Certificates     asn1.RawValue   `asn1:"optional,tag:0"`
	RevocationInfo   asn1.RawValue   `asn1:"optional,tag:1"`
	SignerInfos      []cmsSignerInfo `asn1:"set"`
}

// extractPKCS7Signature extracts the raw RSA signature from the Windows
// CMS/PKCS#7 wrapper used by MeshAgent. The message is verified separately
// against the handshake transcript, matching MeshCentral's behavior.
func extractPKCS7Signature(signature []byte, cert *x509.Certificate) ([]byte, error) {
	var contentInfo cmsContentInfo
	rest, err := asn1.Unmarshal(signature, &contentInfo)
	if err != nil || len(rest) != 0 {
		return nil, errors.New("invalid ContentInfo")
	}
	if !contentInfo.ContentType.Equal(oidCMSSignedData) {
		return nil, errors.New("unexpected content type")
	}

	var signedData cmsSignedData
	rest, err = asn1.Unmarshal(contentInfo.Content.Bytes, &signedData)
	if err != nil || len(rest) != 0 {
		return nil, errors.New("invalid SignedData")
	}
	if !signedData.EncapContentInfo.ContentType.Equal(oidCMSData) {
		return nil, errors.New("unexpected encapsulated content type")
	}
	if len(signedData.SignerInfos) != 1 {
		return nil, errors.New("expected one signer")
	}
	signer := signedData.SignerInfos[0]
	if len(signer.SignedAttrs.FullBytes) != 0 {
		return nil, errors.New("signed attributes are not supported")
	}
	if !signer.DigestAlgorithm.Algorithm.Equal(oidSHA384) {
		return nil, errors.New("unexpected digest algorithm")
	}
	if !signer.SignatureAlgorithm.Algorithm.Equal(oidRSAEncryption) &&
		!signer.SignatureAlgorithm.Algorithm.Equal(oidSHA384WithRSA) {
		return nil, errors.New("unexpected signature algorithm")
	}
	if !cmsSignerMatchesCertificate(signer.SignerIdentifier, cert) {
		return nil, errors.New("signer certificate mismatch")
	}
	if len(signer.EncryptedDigest) == 0 {
		return nil, errors.New("empty encrypted digest")
	}
	return signer.EncryptedDigest, nil
}

func cmsSignerMatchesCertificate(identifier asn1.RawValue, cert *x509.Certificate) bool {
	if identifier.Class == 0 && identifier.Tag == 16 {
		var issuerAndSerial struct {
			Issuer       asn1.RawValue
			SerialNumber *big.Int
		}
		rest, err := asn1.Unmarshal(identifier.FullBytes, &issuerAndSerial)
		if err != nil || len(rest) != 0 || issuerAndSerial.SerialNumber == nil {
			return false
		}
		return bytes.Equal(issuerAndSerial.Issuer.FullBytes, cert.RawIssuer) &&
			issuerAndSerial.SerialNumber.Cmp(cert.SerialNumber) == 0
	}
	if identifier.Class == 2 && identifier.Tag == 0 {
		return bytes.Equal(identifier.Bytes, cert.SubjectKeyId)
	}
	return false
}

func base64NodeID(hash []byte) string {
	s := encodeBase64(hash)
	s = strings.ReplaceAll(s, "+", "@")
	s = strings.ReplaceAll(s, "/", "$")
	return s
}

func encodeBase64(b []byte) string {
	const enc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	out := make([]byte, 0, (len(b)+2)/3*4)
	for i := 0; i < len(b); i += 3 {
		var n uint32
		rem := len(b) - i
		if rem >= 3 {
			n = uint32(b[i])<<16 | uint32(b[i+1])<<8 | uint32(b[i+2])
			out = append(out, enc[n>>18&63], enc[n>>12&63], enc[n>>6&63], enc[n&63])
		} else if rem == 2 {
			n = uint32(b[i])<<16 | uint32(b[i+1])<<8
			out = append(out, enc[n>>18&63], enc[n>>12&63], enc[n>>6&63], '=')
		} else {
			n = uint32(b[i]) << 16
			out = append(out, enc[n>>18&63], enc[n>>12&63], '=', '=')
		}
	}
	return string(out)
}

// NodeIDFromCertDER derives MeshCentral nodeid from agent certificate DER.
func NodeIDFromCertDER(certDER []byte) (string, error) {
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		return "", err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(cert.PublicKey)
	if err != nil {
		return "", err
	}
	h := sha512.Sum384(pubDER)
	return base64NodeID(h[:]), nil
}
