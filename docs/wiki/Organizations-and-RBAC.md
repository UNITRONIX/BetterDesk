# Organizations and RBAC

BetterDesk supports **multi-tenant organizations** with org-scoped devices and users, combined with a **6–7 role server hierarchy** and **28 granular permissions**.

---

## Server roles

| Role | Scope | Summary |
|------|-------|---------|
| **super_admin** | Global | Full access; manages other super admins |
| **admin** | Global | Legacy alias for `super_admin` |
| **server_admin** | Infrastructure | Server config, keys, metrics — read-only user list |
| **global_admin** | All orgs | User/org/device management — no server settings |
| **operator** | Assigned | Connect, edit devices, chat, CDAP commands |
| **viewer** | Assigned | Read-only dashboards |
| **pro** | API only | Client API (21121) — no panel login |

```
super_admin / admin
├── server_admin     (parallel — infrastructure)
├── global_admin     (parallel — cross-org users/devices)
└── operator / viewer / pro
```

`server_admin` and `global_admin` are **parallel** branches with different permission sets — not strict parent/child.

---

## Organization model

Organizations isolate devices and members for MSPs, departments, or customers.

| Concept | Description |
|---------|-------------|
| **Organization** | Named tenant with slug and settings |
| **Org member** | User linked to an org with an org role |
| **Org-scoped device** | Peer assigned to one org — visible only to that org's users |
| **Org JWT** | Login embeds `org_id` in token for data filtering |

### Org roles

| Org role | Can assign |
|----------|------------|
| **owner** | `admin`, `operator`, `user` (not another owner) |
| **admin** | `operator`, `user` |
| **operator** / **user** | Cannot assign roles |

---

## Granular permissions (28)

Permissions replace simple role gates. Examples:

| Category | Permissions |
|----------|-------------|
| Device | `device.view`, `device.connect`, `device.edit`, `device.delete`, `device.ban`, `device.change_id` |
| User | `user.view`, `user.create`, `user.edit`, `user.delete` |
| Server | `server.config`, `server.keys` |
| Organization | `org.create`, `org.edit`, `org.delete`, `org.manage_users`, `org.manage_devices` |
| CDAP | `cdap.view`, `cdap.command`, `cdap.terminal`, `cdap.files` |
| Other | `audit.view`, `chat.access`, `enrollment.manage`, … |

Default mappings per role are built in; overrides live in the `role_permissions` table.
Overrides set on the **Permissions** page apply to the Go API and to the web console
(routes, sidebar, WebSocket relays). The console refreshes them every 30 seconds and
immediately after a change made through it.

---

## Custom roles

Besides the built-in roles you can create your own on **Permissions → Create role**:

| Field | Notes |
|-------|-------|
| Name | 2–32 lowercase letters, digits or `_`, starting with a letter. Built-in names, `device`, `owner` and `user` are reserved |
| Description | Optional, up to 200 characters |
| Start from | Copy the current effective permissions of an existing role, or start with none |

- A custom role has **no default permissions**: every permission it holds is a row in
  `role_permissions`, toggled on the Permissions page like any other role.
- Only `super_admin` / `admin` can assign a custom role to a user.
- A custom role still assigned to users cannot be deleted (409); reassign the users first.
- Custom role definitions live in the `custom_roles` table.

| Endpoint | Permission | Purpose |
|----------|-----------|---------|
| `GET /api/roles` | `user.view` | Built-in and custom roles (`is_custom`, `description`, `user_count`) |
| `POST /api/roles` | `server.config` | Create (`name`, `description`, `copy_from`, `permissions`) |
| `PATCH /api/roles/{role}` | `server.config` | Update description |
| `DELETE /api/roles/{role}` | `server.config` | Delete an unused custom role |

---

## Hiding users from a role

User visibility follows the `user.view` permission. Revoke it for a role on the
Permissions page to hide:

- the **Users** page, sidebar entry and `/api/users`;
- other members in organization member lists.

Organization member lists show everyone to roles with `user.view` or
`org.manage_users` and to org **owners**/**admins**. Any other org member sees only
themselves.

---

## Data scoping

| Endpoint | Behavior |
|----------|----------|
| `GET /api/peers` | Org users see only their org's devices |
| `GET /api/peers/{id}` | `peerOrgScopeCheck()` — 403 if wrong org |
| `GET /api/org` | Super/global admins (and console users with an `org.*` permission) see all orgs; others only orgs they belong to |
| Org user list | `user.view` / `org.manage_users` or org owner/admin: all members; others: themselves |

---

## Panel usage

1. **Organizations** — create org, invite members, assign org role
2. **Devices** — assign device to org (edit device → organization)
3. **Users** — server role + optional org membership

Global admins manage all orgs; org admins manage within their org only.

---

## Security protections

- Cannot demote the last super admin
- Cannot assign roles above your authority (`CanAssignRole()`)
- Org users cannot modify users at or above their org level
- Peer endpoints enforce org scope on view/edit/delete/ban/metrics

---

## See also

- [[User Management|User-Management]] — TOTP, Pro users, sessions
- [[API Reference|API-Reference]] — org-scoped API
- [RBAC Phase 52 doc](https://github.com/UNITRONIX/BetterDesk/blob/main/docs/features/RBAC_PHASE52.md)
