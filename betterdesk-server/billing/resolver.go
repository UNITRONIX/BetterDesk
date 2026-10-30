package billing

import (
	"fmt"

	"github.com/unitronix/betterdesk-server/db"
)

// ContractResolver resolves the effective billing contract for a device.
type ContractResolver interface {
	GetActiveBillingContract(targetType, targetKey string) (*db.BillingContract, error)
	GetDeviceOrgID(deviceID string) (string, error)
}

// PanelContext supplies device-group membership for resolution.
// Folders are intentionally excluded from commercialization assignment.
type PanelContext interface {
	ListDeviceGroupGUIDsForPeer(peerID string) ([]string, error)
}

// ResolveContractForDevice picks the most specific active contract:
// device (legacy) > device_group > org.
// Folder contracts are ignored (packages attach only to groups).
func ResolveContractForDevice(resolver ContractResolver, panel PanelContext, deviceID string) (*db.BillingContract, error) {
	if resolver == nil || deviceID == "" {
		return nil, nil
	}

	if c, err := resolver.GetActiveBillingContract(db.BillingTargetDevice, deviceID); err != nil {
		return nil, err
	} else if c != nil {
		return c, nil
	}

	if panel != nil {
		if groups, err := panel.ListDeviceGroupGUIDsForPeer(deviceID); err == nil {
			for _, guid := range groups {
				if guid == "" {
					continue
				}
				if c, err := resolver.GetActiveBillingContract(db.BillingTargetDeviceGroup, guid); err != nil {
					return nil, err
				} else if c != nil {
					return c, nil
				}
			}
		}
	}

	orgID, err := resolver.GetDeviceOrgID(deviceID)
	if err != nil {
		return nil, err
	}
	if orgID == "" {
		return nil, nil
	}
	return resolver.GetActiveBillingContract(db.BillingTargetOrg, orgID)
}

// NormalizeContractTarget maps legacy org_id bodies to target_type/target_key.
// Folder targets are rejected — packages may only be assigned to device groups
// (plus legacy org/device for existing data until migrated).
func NormalizeContractTarget(body *db.BillingContract) error {
	if body == nil {
		return fmt.Errorf("contract body required")
	}
	if body.TargetType == "" && body.OrgID != "" {
		body.TargetType = db.BillingTargetOrg
		body.TargetKey = body.OrgID
	}
	if body.TargetType == "" || body.TargetKey == "" {
		return fmt.Errorf("target_type and target_key required")
	}
	switch body.TargetType {
	case db.BillingTargetOrg, db.BillingTargetDeviceGroup, db.BillingTargetDevice:
		return nil
	case db.BillingTargetFolder:
		return fmt.Errorf("folder package assignment is not supported; assign packages to device groups only")
	default:
		return fmt.Errorf("invalid target_type")
	}
}
