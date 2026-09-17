# Contributing to BetterDesk

Thank you for your interest in contributing to BetterDesk Console! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project adheres to a code of conduct that all contributors are expected to follow:

- Be respectful and inclusive
- Be patient with newcomers
- Focus on what is best for the community
- Show empathy towards other community members

## Getting Started

1. Fork the repository on GitHub.
2. Clone your fork and fetch the current `dev` branch.
3. Create a focused feature branch from `dev`.
4. Make the smallest change that solves the problem.
5. Run the complete test scope for every affected component.
6. Submit the pull request against `dev`.

`main` is reserved for the maintained `dev` → `main` production release flow
or an explicitly approved stable hotfix.

## How to Contribute

### Types of Contributions

- **Bug Fixes**: Fix issues in existing code
- **New Features**: Add new functionality
- **Documentation**: Improve or add documentation
- **Tests**: Add or improve test coverage
- **UI/UX**: Improve user interface or experience
- **Performance**: Optimize code performance
- **Security**: Fix security vulnerabilities

### Areas Needing Help

- Multi-language support (i18n)
- Authentication system
- Mobile responsiveness improvements
- API documentation
- Test coverage
- Performance optimization

## Development Setup

### Prerequisites

- Git
- Go version required by `betterdesk-server/go.mod`
- Node.js version required by `web-nodejs/package.json`
- Docker when changing images, compose files, or entrypoints

### Local validation

```bash
# Console
cd web-nodejs
npm ci
npm test

# Go server
cd ../betterdesk-server
go test -race -count=1 ./...
go vet ./...
```

Read [BetterDesk Update Flow](../important/betterdesk-update-flow.md) before
changing update, installer, service, or deployment behavior.

## Coding Standards

### JavaScript

- Use ES6+ features
- Use const/let, avoid var
- Prefer arrow functions
- Use async/await for promises
- Maximum line length: 100 characters

Example:
```javascript
async function fetchDevices() {
    try {
        const response = await fetch('/api/devices');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Failed to fetch devices:', error);
    }
}
```

### CSS

- Use meaningful class names (BEM methodology)
- Group related properties
- Use CSS variables for colors
- Mobile-first approach
- Comment complex selectors

Example:
```css
/* Device status badge component */
.status-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
}

.status-badge--active {
    color: var(--success-color);
}
```

## Commit Messages

Follow the Conventional Commits specification:

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

### Examples

```
feat(api): add device grouping endpoint

Implement REST API endpoint for grouping devices by custom tags.
Includes database migration and unit tests.

Closes #123
```

```
fix(ui): correct status badge color on dark theme

The status badge was using incorrect color variable in dark mode,
making it hard to read. Updated to use theme-aware color.

Fixes #456
```

## Pull Request Process

### Before Submitting

1. ✅ Update documentation if needed
2. ✅ Add tests for new features
3. ✅ Run all tests locally
4. ✅ Update CHANGELOG.md
5. ✅ Ensure code follows style guidelines
6. ✅ Rebase on latest `dev` branch
7. ✅ Do not include secrets, private deployment data, or fork-controlled workflows that need repository secrets
8. ✅ Document provenance for external code, generated artifacts, and protocol compatibility work
9. ✅ Update every locale when adding console translation keys

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Screenshots (if applicable)
Add screenshots for UI changes

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] Tests added/updated
- [ ] No new warnings
- [ ] CHANGELOG.md updated
```

### Review Process

1. Automated checks must pass.
2. At least one maintainer approval is required; `CODEOWNERS` adds explicit
   ownership for relay, signal, authentication, database, workflow, Docker,
   and translation paths.
3. Fork workflows must not receive repository secrets.
4. All review comments must be addressed.
5. The maintainer decides whether to merge the submitted patch or implement a
   reviewed alternative while preserving accurate attribution.
6. Routine changes land on `dev`; production release work follows the release
   checklist for `main`.

## Reporting Bugs

### Before Reporting

- Search existing issues
- Check if it's already fixed in main branch
- Verify it's reproducible

### Bug Report Template

```markdown
**Description**
Clear description of the bug

**Steps to Reproduce**
1. Go to '...'
2. Click on '...'
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- OS: [e.g., Ubuntu 22.04]
- RustDesk Version: [e.g., 1.1.9]
- BetterDesk Console Version: [e.g., 1.0.0]
- Browser: [e.g., Chrome 120]

**Logs**
```
Paste relevant logs here
```

**Screenshots**
Add screenshots if applicable
```

## Suggesting Features

### Feature Request Template

```markdown
**Is your feature related to a problem?**
Clear description of the problem

**Describe the solution**
What would you like to see implemented?

**Describe alternatives**
Other solutions you've considered

**Additional context**
Any other information, mockups, examples
```

## Questions?

- Open a GitHub Discussion
- Check existing documentation
- Ask in pull request comments

## License

By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License v3.0 (AGPL-3.0).
For copyright ownership, clean-room work, provenance, and attribution rules,
read [Contributor licensing and provenance](CONTRIBUTOR-LICENSING.md).

---

Thank you for contributing to BetterDesk Console! 🎉
