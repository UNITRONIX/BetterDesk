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
	"math/big"
	"testing"
	"time"
)

func TestCookieCodecRoundTrip(t *testing.T) {
	c, err := NewCookieCodec("test-secret-key-for-mesh-cookies")
	if err != nil {
		t.Fatal(err)
	}
	data := &RelayCookieData{
		RUserID:   "user/admin",
		NodeID:    "node@test",
		Rights:    0xFFFFFFFF,
		ExpireMin: 60,
	}
	cookie, err := c.Encode(data, 60)
	if err != nil {
		t.Fatal(err)
	}
	out, err := c.Decode(cookie, 60)
	if err != nil {
		t.Fatal(err)
	}
	if out.RUserID != data.RUserID || out.NodeID != data.NodeID {
		t.Fatalf("mismatch: %+v", out)
	}
}

func TestAgentCredentialsServerID(t *testing.T) {
	cred, err := LoadOrCreateAgentCredentials("")
	if err != nil {
		t.Fatal(err)
	}
	if len(cred.ServerID) != 96 { // hex sha384
		t.Fatalf("server id len %d", len(cred.ServerID))
	}
	if len(cred.ServerIDBin) != sha384Size {
		t.Fatalf("server id bin len %d", len(cred.ServerIDBin))
	}
}

func TestSignServerAuthIncludesAgentNonce(t *testing.T) {
	cred, err := LoadOrCreateAgentCredentials("")
	if err != nil {
		t.Fatal(err)
	}
	webHash := bytes.Repeat([]byte{0x11}, sha384Size)
	agentNonce := bytes.Repeat([]byte{0x22}, sha384Size)
	serverNonce := bytes.Repeat([]byte{0x33}, sha384Size)

	signature, err := cred.SignServerAuth(webHash, agentNonce, serverNonce)
	if err != nil {
		t.Fatal(err)
	}
	transcript := append(append(append([]byte{}, webHash...), agentNonce...), serverNonce...)
	sum := sha512.Sum384(transcript)
	if err := rsa.VerifyPKCS1v15(&cred.PrivateKey.PublicKey, crypto.SHA384, sum[:], signature); err != nil {
		t.Fatalf("signature does not cover MeshAgent transcript: %v", err)
	}

	legacyTranscript := append(append([]byte{}, webHash...), serverNonce...)
	legacySum := sha512.Sum384(legacyTranscript)
	if err := rsa.VerifyPKCS1v15(&cred.PrivateKey.PublicKey, crypto.SHA384, legacySum[:], signature); err == nil {
		t.Fatal("signature must not validate the legacy transcript without agent nonce")
	}
}

func TestWebCertHashPEMAndDERMatch(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	hDER := WebCertHash(der)
	hPEM := WebCertHash(pemBytes)
	if len(hDER) != sha384Size || len(hPEM) != sha384Size {
		t.Fatalf("hash lengths der=%d pem=%d", len(hDER), len(hPEM))
	}
	if !bytes.Equal(hDER, hPEM) {
		t.Fatal("PEM and DER web cert hashes must match")
	}
	// Raw PEM bytes must NOT be hashed as opaque (legacy bug)
	if bytes.Equal(hPEM, sha384Raw(pemBytes)) {
		t.Fatal("WebCertHash must not hash raw PEM bytes")
	}
}

func TestParseWebCertHashes(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(7),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	hashes := ParseWebCertHashes(der)
	if hashes == nil || len(hashes.Certificate) != sha384Size || len(hashes.PublicKey) != sha384Size {
		t.Fatalf("invalid certificate pins: %+v", hashes)
	}
	certHash := sha384Raw(der)
	if !bytes.Equal(hashes.Certificate, certHash) {
		t.Fatal("certificate pin must hash the complete leaf DER")
	}
	if !bytes.Equal(hashes.PublicKey, WebCertHash(der)) {
		t.Fatal("public key pin must preserve WebCertHash behavior")
	}
}

func TestWebCertHashFullchainUsesLeaf(t *testing.T) {
	leafKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := x509.Certificate{
		SerialNumber:          big.NewInt(2),
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, &caTmpl, &caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	leafTmpl := x509.Certificate{
		SerialNumber: big.NewInt(3),
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, &leafTmpl, &caTmpl, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	fullchain := append(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}),
		pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})...)
	hFull := WebCertHash(fullchain)
	hLeaf := WebCertHash(leafDER)
	hCA := WebCertHash(caDER)
	if !bytes.Equal(hFull, hLeaf) {
		t.Fatal("fullchain must hash leaf (first CERTIFICATE)")
	}
	if bytes.Equal(hFull, hCA) {
		t.Fatal("fullchain must not hash CA")
	}
	pins := ParseWebCertHashes(fullchain)
	if pins == nil || !bytes.Equal(pins.Certificate, sha384Raw(leafDER)) {
		t.Fatal("fullchain certificate pin must hash the leaf DER")
	}
}

func TestWebCertHashInvalidReturnsNil(t *testing.T) {
	if WebCertHash(nil) != nil {
		t.Fatal("nil input")
	}
	if WebCertHash([]byte{}) != nil {
		t.Fatal("empty input")
	}
	if WebCertHash([]byte("not-a-cert")) != nil {
		t.Fatal("garbage must return nil (no opaque hash fallback)")
	}
	onlyKey := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: []byte{1, 2, 3}})
	if WebCertHash(onlyKey) != nil {
		t.Fatal("PEM without CERTIFICATE must return nil")
	}
}

func sha384Raw(b []byte) []byte {
	h := sha512.Sum384(b)
	return h[:]
}

func buildDetachedPKCS7(t *testing.T, key *rsa.PrivateKey, certDER, message []byte) []byte {
	t.Helper()
	cert, err := x509.ParseCertificate(certDER)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha512.Sum384(message)
	rawSignature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA384, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	issuerAndSerial, err := asn1.Marshal(struct {
		Issuer       asn1.RawValue
		SerialNumber *big.Int
	}{
		Issuer:       asn1.RawValue{FullBytes: cert.RawIssuer},
		SerialNumber: cert.SerialNumber,
	})
	if err != nil {
		t.Fatal(err)
	}
	signer := cmsSignerInfo{
		Version:          1,
		SignerIdentifier: asn1.RawValue{FullBytes: issuerAndSerial},
		DigestAlgorithm:  cmsAlgorithmIdentifier{Algorithm: oidSHA384},
		SignatureAlgorithm: cmsAlgorithmIdentifier{
			Algorithm: oidRSAEncryption,
		},
		EncryptedDigest: rawSignature,
	}
	signedData, err := asn1.Marshal(cmsSignedData{
		Version:          1,
		DigestAlgorithms: []cmsAlgorithmIdentifier{{Algorithm: oidSHA384}},
		EncapContentInfo: cmsEncapsulatedContentInfo{ContentType: oidCMSData},
		SignerInfos:      []cmsSignerInfo{signer},
	})
	if err != nil {
		t.Fatal(err)
	}
	contentInfo, err := asn1.Marshal(cmsContentInfo{
		ContentType: oidCMSSignedData,
		Content: asn1.RawValue{
			Class:      2,
			Tag:        0,
			IsCompound: true,
			Bytes:      signedData,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return contentInfo
}

func TestVerifyAgentSignaturePKCS7(t *testing.T) {
	key, certDER, _ := generateAgentKeyAndCert(t)
	webHash := bytes.Repeat([]byte{0x11}, sha384Size)
	serverNonce := bytes.Repeat([]byte{0x22}, sha384Size)
	agentNonce := bytes.Repeat([]byte{0x33}, sha384Size)
	message := append(append(append([]byte{}, webHash...), serverNonce...), agentNonce...)
	signature := buildDetachedPKCS7(t, key, certDER, message)

	if _, err := VerifyAgentSignature(certDER, signature, webHash, serverNonce, agentNonce); err != nil {
		t.Fatalf("valid PKCS#7 signature rejected: %v", err)
	}
	signature[len(signature)-1] ^= 1
	if _, err := VerifyAgentSignature(certDER, signature, webHash, serverNonce, agentNonce); err == nil {
		t.Fatal("tampered PKCS#7 signature accepted")
	}
}

func TestBuildCoreModulePacket(t *testing.T) {
	core := []byte("console.log('test');")
	payload := append([]byte{0, 0, 0, 0}, core...)
	hash := sha384Raw(payload)
	pkt := BuildCoreModulePacket(hash, payload)
	if readU16(pkt, 0) != cmdCoreModule {
		t.Fatalf("cmd %d", readU16(pkt, 0))
	}
	if len(pkt) != 4+sha384Size+len(payload) {
		t.Fatalf("packet length %d", len(pkt))
	}
	if !bytes.Equal(pkt[4:4+sha384Size], hash) {
		t.Fatal("core hash mismatch")
	}
	if !bytes.Equal(pkt[4+sha384Size:], payload) {
		t.Fatal("core payload mismatch")
	}
}

func TestMeshPeerIDSanitize(t *testing.T) {
	id := meshPeerID("abc@def$ghi")
	if id == "" || len(id) < 6 {
		t.Fatalf("bad id %s", id)
	}
}
