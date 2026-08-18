# Policies

Standalone TypeScript policy checker for project repositories.

## Requirements

- Bun 1.3+

## Install

```sh
bun install
```

## Run against a repository

The checker receives the repository to inspect as its first argument. If omitted,
it inspects the current directory.

```sh
bun run check -- /path/to/project
# or, from the project being checked:
bun run --cwd /path/to/policies check -- .
```

The bundled catalog is used by default. To customize the rules for a project,
copy `policies/catalog` into the project root and edit its manifest and policy
sets; a project-local catalog takes precedence over the bundled catalog.

## Development

```sh
bun run check-types
bun test
```

Rules are implemented in `src/`, while JSON policy catalogs live in
`policies/catalog/`. The legacy TypeScript configuration remains available
through the exported API for consumers that need programmatic checks.
