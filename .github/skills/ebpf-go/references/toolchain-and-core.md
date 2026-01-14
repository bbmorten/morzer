# Toolchain, CO-RE, and Build Basics

Use this reference when you need to set up a working eBPF toolchain, explain CO-RE, or diagnose build-time issues (not verifier/runtime).

## Baseline assumptions

- eBPF runs on Linux.
- Prefer a kernel with BTF enabled and available at `/sys/kernel/btf/vmlinux`.
- Prefer `github.com/cilium/ebpf` + `bpf2go` for Go integration.

## Required tools (typical)

- Go toolchain.
- `clang`/LLVM with BPF backend.
- `bpftool` for probing features and generating `vmlinux.h`.

Notes:
- Exact versions vary by distro. When in doubt, use a recent LLVM (e.g., 15+).
- Some environments require `llvm-strip` (or `llvm-objcopy`) for bpf2go flows.

## CO-RE in one paragraph

CO-RE (Compile Once – Run Everywhere) compiles your BPF program against *types* from BTF (via `vmlinux.h`) and relocates field offsets at load time. This avoids hard-coding kernel-struct layouts and makes your program portable across kernel versions.

## Generating vmlinux.h

Preferred approach (requires BTF):

- Source BTF from `/sys/kernel/btf/vmlinux`.
- Generate:
  - `bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h`

If you want this repeatable in a repo, use the provided script:
- `scripts/gen_vmlinux_h.sh` (Linux only)

## bpf2go usage

Typical `go:generate` pattern:

- Place the C file at `bpf/<name>.bpf.c`.
- In a Go file, add a `//go:generate` line that runs `bpf2go`.

Common bpf2go knobs:

- `-target bpfel` (little endian) or `bpfeb`.
- `-cc clang` and `-cflags "-O2 -g -Wall"`.
- `-type <StructName>` to generate Go types for event structs.

Keep C compilation flags stable across CI/dev to avoid subtle layout mismatches.

## C file conventions (recommended)

- Include order:
  - `#include "vmlinux.h"`
  - `#include <bpf/bpf_helpers.h>`
  - `#include <bpf/bpf_core_read.h>` (for CO-RE reads)
- Mark license:
  - `char LICENSE[] SEC("license") = "Dual BSD/GPL";`
- Use `SEC("...")` section names matching your program type.

## Common build-time failures

- Missing BPF headers:
  - Ensure your BPF headers are present (often from `libbpf-dev` or kernel tooling packages).
- `fatal error: 'vmlinux.h' file not found`:
  - Generate it from BTF or ensure it’s on the include path used by `bpf2go`.
- `clang: error: unsupported option '-target bpf'`:
  - LLVM/clang build lacks BPF backend.

## When to move on to verifier debugging

If compilation succeeds but program load fails with `invalid argument`, verifier logs, or attach errors, switch to:
- `references/troubleshooting.md`
