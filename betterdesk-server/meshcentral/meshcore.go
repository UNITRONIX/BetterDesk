package meshcentral

import (
	"crypto/sha512"
	"embed"
	"fmt"
	"os"
	"path/filepath"
)

//go:embed assets/bettercore.js
var embeddedAssets embed.FS

// CoreAssets holds BetterCore (AGPL) pushed to MeshAgent after handshake.
type CoreAssets struct {
	CoreModule        []byte // raw JavaScript served by /bettercore.js
	CoreModulePayload []byte // four-byte module prefix followed by JavaScript
	CoreModuleHash    []byte // SHA-384 of CoreModulePayload
	Version           string
}

// LoadCoreAssets reads meshcore from disk override or embedded bundle.
func LoadCoreAssets(version string, assetsDir string) (*CoreAssets, error) {
	corePath := filepath.Join(assetsDir, "bettercore.js")
	core, err := readAsset(corePath, "assets/bettercore.js")
	if err != nil {
		return nil, fmt.Errorf("meshcore: %w", err)
	}
	payload := make([]byte, 4+len(core))
	copy(payload[4:], core)
	h := sha512.Sum384(payload)
	return &CoreAssets{
		CoreModule:        core,
		CoreModulePayload: payload,
		CoreModuleHash:    h[:],
		Version:           version,
	}, nil
}

func readAsset(path, embedName string) ([]byte, error) {
	if path != "" {
		if data, err := os.ReadFile(path); err == nil && len(data) > 0 {
			return data, nil
		}
	}
	return embeddedAssets.ReadFile(embedName)
}

// BuildCoreModulePacket returns a MeshCommand_CoreModule packet.
func BuildCoreModulePacket(hash, payload []byte) []byte {
	if len(hash) != sha384Size || len(payload) < 4 {
		return nil
	}
	pkt := make([]byte, 4+len(hash)+len(payload))
	binaryPutU16(pkt, 0, cmdCoreModule)
	binaryPutU16(pkt, 2, 0)
	copy(pkt[4:4+len(hash)], hash)
	copy(pkt[4+len(hash):], payload)
	return pkt
}

// BuildCoreOkPacket returns cmd 16 (core approved).
func BuildCoreOkPacket() []byte {
	p := make([]byte, 2)
	binaryPutU16(p, 0, cmdCoreOk)
	return p
}

// BuildCoreModuleHashRequest requests agent core hash (cmd 11).
func BuildCoreModuleHashRequest() []byte {
	p := make([]byte, 4)
	binaryPutU16(p, 0, cmdCoreModuleHash)
	binaryPutU16(p, 2, 0)
	return p
}

func binaryPutU16(b []byte, off int, v uint16) {
	b[off] = byte(v >> 8)
	b[off+1] = byte(v)
}
