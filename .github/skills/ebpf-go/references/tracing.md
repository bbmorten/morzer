# Observability / Tracing Track

Use this reference when the goal is visibility: latency, errors, syscall patterns, function-level profiling, or request correlation.

## Prefer stable hooks

- Prefer **tracepoints** when they exist for the event you need (more stable than kprobes).
- Use **kprobes/kretprobes** when you need a specific kernel symbol and no tracepoint exists.
- Use **uprobes/uretprobes** for user-space libraries/binaries.

## Common patterns

- **Event stream**: ringbuf → Go decodes fixed-size structs.
- **Sampling** (profiling-ish): keep per-cpu counters/maps and periodically read/aggregate in Go.
- **Correlation**: store in-flight state in a map keyed by (pid, tid) or request id.

## Field access (kernel structs)

- Prefer CO-RE reads (`BPF_CORE_READ*`) over hard-coded offsets.
- Keep reads minimal; copy only what you need into the event struct.

## Performance & safety tips

- Keep event size small; avoid strings unless necessary.
- Rate-limit:
  - sample
  - add filters (pid/cgroup/comm)
  - aggregate in maps instead of emitting every event

## Troubleshooting cues

- “Loads but no events”: confirm hook correctness and add a counter map increment.
- “Verifier complains about pointer”: simplify parsing; use helpers; ensure bounds checks.

For hook/attach details see:
- `references/program-types-and-attach.md`
