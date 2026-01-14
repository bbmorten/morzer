# Recommended Project Layout (Go + eBPF)

Use this reference when scaffolding a new repo or reorganizing an existing one.

## Minimal layout

- `bpf/`
  - `prog.bpf.c` (one or more BPF C sources)
  - `vmlinux.h` (generated for CO-RE)
- `cmd/<tool>/`
  - main package for the CLI/daemon
- `internal/` (optional)
  - helpers for loading/attaching, config, decoding

## go:generate conventions

- Put `//go:generate` directives near the package that owns the generated artifacts.
- Prefer `go generate ./...` as the single entrypoint.

## Separation of concerns

- Keep BPF “ABI” in one place:
  - event structs
  - map key/value types
- Keep user-facing formatting/printing out of the hot path.

## CI considerations

- eBPF tests require Linux.
- If running in CI on non-Linux builders, gate `go test` or split packages so non-Linux can still compile.
