# Program Types and Attach Points (Go + cilium/ebpf)

Use this reference when choosing a hook or when you’re stuck on attach-time issues.

## Quick mapping: goal → likely hook

- Observe syscalls / kernel codepaths → **tracepoints** or **kprobes**
- Observe user-space functions → **uprobes** (needs symbols)
- Per-packet fast path → **XDP**
- Traffic shaping / ingress/egress filtering → **TC (clsact)**
- Enforce per-cgroup policy → **cgroup** hooks

## Common program types

### Tracepoints

- Pros: stable event names, lower risk than kprobes.
- Cons: limited to existing tracepoints.
- Attach: `link.Tracepoint(...)` patterns.

### Kprobes / Kretprobes

- Pros: attach to many kernel symbols.
- Cons: symbol availability changes across kernels; verifier constraints; may need BTF-enabled kprobes on newer kernels.
- Attach: `link.Kprobe(...)`, `link.Kretprobe(...)`.

### Uprobes / Uretprobes

- Pros: instrument user processes.
- Cons: need correct binary path + symbol/offset; ASLR; container path mapping.
- Attach: `link.Uprobe(...)`, `link.Uretprobe(...)`.

### XDP

- Pros: fastest packet hook.
- Cons: requires NIC/driver support; program size/complexity constraints.
- Attach: `link.AttachXDP(...)`.

#### XDP attach (Go)

Minimal attach:

```go
package main

import (
  "net"

  "github.com/cilium/ebpf"
  "github.com/cilium/ebpf/link"
)

func attachXDP(ifaceName string, prog *ebpf.Program) (link.Link, error) {
  iface, err := net.InterfaceByName(ifaceName)
  if err != nil {
    return nil, err
  }

  return link.AttachXDP(link.XDPOptions{
    Program:   prog,
    Interface: iface.Index,
    // Common choices:
    // - link.XDPDriverMode  (best perf, requires driver support)
    // - link.XDPGenericMode (fallback, works more often)
    Flags: link.XDPDriverMode,
  })
}
```

Driver-mode with a generic fallback:

```go
func attachXDPWithFallback(ifaceName string, prog *ebpf.Program) (link.Link, error) {
  iface, err := net.InterfaceByName(ifaceName)
  if err != nil {
    return nil, err
  }

  try := func(flags link.XDPAttachFlags) (link.Link, error) {
    return link.AttachXDP(link.XDPOptions{Program: prog, Interface: iface.Index, Flags: flags})
  }

  lnk, err := try(link.XDPDriverMode)
  if err == nil {
    return lnk, nil
  }
  return try(link.XDPGenericMode)
}
```

Notes:

- If attach fails with “already exists” / “resource busy”, there may already be an XDP program attached to the interface.
- If load succeeds but attach fails, confirm the program type is XDP and that your interface index is correct.
- Always `defer lnk.Close()` (or close on shutdown) to detach.

### TC (clsact)

- Pros: powerful ingress/egress hook with richer context.
- Cons: setup required (qdisc); operational complexity.
- Attach: TC attach APIs from cilium/ebpf/link (varies by version);
  - Ensure clsact is present on the interface.

### TCX (newer TC attach)

Some kernels support “TCX” attach points which avoid the classic `clsact` qdisc plumbing.

- Attach: `link.AttachTCX(link.TCXOptions{...})`
- Attach types: `ebpf.AttachTCXIngress` and `ebpf.AttachTCXEgress`

#### TCX attach (Go)

```go
package main

import (
  "net"

  "github.com/cilium/ebpf"
  "github.com/cilium/ebpf/link"
)

func attachTCXIngress(ifaceName string, prog *ebpf.Program) (link.Link, error) {
  iface, err := net.InterfaceByName(ifaceName)
  if err != nil {
    return nil, err
  }

  return link.AttachTCX(link.TCXOptions{
    Interface: iface.Index,
    Program:   prog,
    Attach:    ebpf.AttachTCXIngress,
  })
}
```

Notes:

- If you see `operation not supported` / `not supported`, your kernel may not support TCX; fall back to classic TC.
- Use `ebpf.AttachTCXEgress` for egress.
- As with all attaches, keep the returned `link.Link` alive and close it during shutdown.

## Practical attach guidance

- Always manage lifecycle:
  - Ensure every `link.Link` is closed on shutdown.
  - Use contexts/signals to stop event loops cleanly.
- Prefer stable hooks first:
  - tracepoints > kprobes when possible.
- When hooking user-space:
  - confirm you’re attaching to the exact binary that runs (path inside container/namespace matters).

## Attach lifecycle gotchas

- Don’t lose references: dropping the last reference to a `link.Link` may close it and detach.
- Prefer a single “owner” goroutine that holds link/map/program references and shuts them down in reverse order (events → links → programs/maps).
- On errors during setup, close anything you already attached before returning.

## Permissions/capabilities (high level)

Exact requirements vary by kernel and system policy, but common blockers include:

- Lacking permissions to load BPF programs or create maps.
- Lacking permissions to attach to perf/tracing subsystems.

When you see `permission denied` / `operation not permitted`, jump to:
- `references/troubleshooting.md`
