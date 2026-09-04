# CANS

Canonical Agent-Native Spec. Dense hierarchical outlines ARE the product.

## Install

```bash
bun install -g cans
```

## Quick Start

```bash
mkdir my-project && cd my-project
cans init
cans check
cans status
```

## Commands

```
cans init [--flat|--folders] [--bare] [--force] [--tool <name>]
cans check [--fix] [--strict] [--refs-only] [--no-redundancy] [file] [--json]
cans new adr <title>
cans new task <name>
cans done <name> [--allow-incomplete] [--skip-check] [--json]
cans status [--unclaimed] [--blocked] [--owners] [--json]
cans budget read <concept> [--limit <tokens>] [--json]
cans budget write <concept> [--json]
cans import <format> <path> [--dry-run] [--merge-strategy <s>] [--json]
cans export <format> [--from <path>] [--vault <path>] [--dry-run] [--json]
cans help
```

## Development

```bash
bun install
bun test          # run tests
bun run typecheck # type check
```

## License

MIT
