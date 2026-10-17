## Summary

<!-- What changed and why? Keep one focused concern per pull request. -->

## Target branch

- [ ] This pull request targets `dev`, unless it is an explicitly approved `dev` → `main` release.

## Security and provenance

- [ ] No credentials, private keys, deployment-specific hostnames, IPs, paths, or private configuration are included.
- [ ] I did not add a workflow that executes fork-controlled code with repository secrets.
- [ ] External code, generated artifacts, protocol compatibility code, and upstream-derived material have documented provenance.
- [ ] Security-sensitive changes explain the trust boundary, authorization behavior, limits, and failure mode.

## Deployment and compatibility

- [ ] The change is deployable through the panel updater, installer scripts, or the documented Docker image path.
- [ ] Database changes are additive and safe on both SQLite and PostgreSQL, or the manual migration step is documented.
- [ ] `.env` changes append missing keys without overwriting operator secrets.
- [ ] Update/restart and rollback behavior was checked when deployment files or the Go server changed.

## Tests

<!-- List exact commands and notable results. Run the complete affected scope. -->

- Commands:
- Results:

## Console translations

- [ ] No user-visible strings changed.
- [ ] All new or changed keys exist in every `web-nodejs/lang/*.json` locale with proper translations.

## Attribution

- [ ] Contributions and design/reporting sources are credited accurately.
- [ ] If code was directly reused, author/licence attribution is preserved.
