# Go Integration Patterns (cilium/ebpf)

Use this reference for idiomatic Go-side patterns: loading, attaching, map interaction, and event reading.

## Project patterns

- Keep generated bindings in a dedicated package (commonly `bpf/` or `internal/bpf/`).
- Treat generated files as build artifacts:
  - don’t hand-edit
  - regenerate via `go generate ./...`

## Loading patterns

- Raise memlock/rlimits early (common approach is `rlimit.RemoveMemlock()`).
- Prefer explicit `CollectionOptions` so you can enable verifier logs when needed.

## Map patterns

- Counters/hot paths:
  - Prefer **per-cpu** maps to reduce contention.
- Configuration:
  - Use a small hash/array map updated from Go.
- Iteration:
  - Iterate keys carefully; avoid holding up the datapath.
  - For large maps, consider sampling or periodic aggregation.

## Event patterns

### ringbuf (preferred for events)

- Use ringbuf when you need a stream of events from BPF to Go.
- Handle shutdown:
  - close the reader
  - stop goroutines cleanly

### perf event

- Use perf events when ringbuf isn’t available or you need compatibility.
- Expect dropped samples; size buffers accordingly.

## Struct layout and decoding

- Keep event structs simple:
  - fixed-size arrays over variable length
  - explicit padding in C if needed
- Ensure C and Go agree on:
  - endianness
  - alignment and packing
  - integer widths

## Pinning & reuse

- Pin maps/programs only when you have a concrete operational need.
- Document pin paths and cleanup behavior.

## Deployment notes

- Detect and report missing kernel features early:
  - print kernel version
  - probe for BTF presence
  - provide clear next steps

When behavior is surprising or errors arise, switch to:
- `references/troubleshooting.md`
