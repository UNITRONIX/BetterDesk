# BetterDesk — Compliance Notes

> **Last Updated:** 2026-04-01
> **Disclaimer:** This document provides guidance for compliance considerations. It is not legal advice. Consult your compliance officer or legal counsel for authoritative guidance.

## GDPR (General Data Protection Regulation)

### Data Collected

| Data Category | Examples | Legal Basis | Retention |
|---------------|----------|-------------|-----------|
| Device identifiers | Device ID, hostname, platform, OS version | Legitimate interest (fleet management) | Until device deleted |
| Connection metadata | IP address, NAT type, connection timestamps | Legitimate interest (network operation) | 90 days (configurable) |
| User accounts | Username, email, password hash, role | Contract performance | Until account deleted |
| Audit logs | Login attempts, remote sessions, admin actions | Legitimate interest (security) | 180 days (configurable) |
| System metrics | CPU, memory, disk usage | Legitimate interest (monitoring) | 30 days (configurable) |

### Data Subject Rights

| Right | Implementation |
|-------|---------------|
| Right to access | Export device/user data via API (`GET /api/peers/{id}`, `GET /api/org/{id}/users/{uid}`) |
| Right to erasure | Delete device (`DELETE /api/peers/{id}`), delete user (`DELETE /api/org/{id}/users/{uid}`) |
| Right to rectification | Update device notes/tags (`PATCH /api/peers/{id}`), update user (`PUT /api/org/{id}/users/{uid}`) |
| Right to data portability | Export via API (JSON format) |
| Right to object | Organization admin can disable data collection features |

### Recommendations
- Deploy with TLS enabled for all connections
- Enable audit logging for accountability
- Configure metric retention periods per your data retention policy
- Use session recording only with informed consent (banner/notification)
- Document your processing activities if you are a data controller

## SOX (Sarbanes-Oxley)

### Relevant Controls

| Control Area | BetterDesk Feature |
|-------------|-------------------|
| Access controls | Role-based access (owner/admin/operator/user), TOTP 2FA |
| Audit trail | Comprehensive audit logging (login, sessions, config changes) |
| Segregation of duties | Operator vs admin role separation |
| Change management | Git-based version control, CI/CD pipeline |

## HIPAA (Health Insurance Portability and Accountability Act)

### Technical Safeguards

| Requirement | BetterDesk Implementation |
|-------------|--------------------------|
| Access control | Role-based authentication, per-organization isolation |
| Audit controls | Audit log with timestamps, user IDs, actions |
| Integrity controls | NaCl authenticated encryption, TLS transport |
| Transmission security | TLS on all network connections (configurable) |
| Encryption at rest | PostgreSQL encryption (deploy-time configuration) |

### Recommendations for HIPAA Deployments
- Use PostgreSQL with TLS and disk encryption
- Enable all TLS flags (`--tls-signal`, `--tls-relay`)
- Require TOTP 2FA for all operator/admin accounts
- Set panel `SESSION_IDLE_TIMEOUT` to 15 minutes or less (default is 30 minutes) and keep absolute `SESSION_MAX_AGE` bounded
- Enable session recording for audit purposes
- Regular access reviews via organization user management
