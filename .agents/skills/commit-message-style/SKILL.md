---
name: commit-message-style
description: Conventional-commit rules for this repo -- use when writing a git commit message.
---

# Commit Message Style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary, imperative mood, no trailing period>
```

Allowed `<type>` values:
- `fix`: bug fix
- `feat`: new feature
- `refactor`: code change that neither fixes a bug nor adds a feature
- `test`: adding or correcting tests
- `docs`: documentation only
- `chore`: build process / tooling / dependency changes

Rules:
- Summary line under 72 characters.
- `<scope>` is the module or area touched (e.g. `auth`, `cli`, `run-loop`) -- omit if the change is repo-wide.
- Body (if needed) explains *why*, not *what* -- the diff already shows what changed.
- For a bug fix, always use `fix(<scope>): <summary>` -- never `feat` or `chore` for a bug fix.
