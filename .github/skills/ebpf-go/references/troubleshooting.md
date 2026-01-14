# Troubleshooting (Verifier, Load, Attach)

Use this reference when compilation succeeds but load/attach/runtime behavior is wrong.

## First triage questions

- What’s the kernel version and distro?
- Is BTF present? (`/sys/kernel/btf/vmlinux`)
- What hook are we attaching to (tracepoint, kprobe, uprobe, XDP, TC)?
- Do we have the required privileges/capabilities?

## Common failure modes

### 1) Verifier rejects the program (`invalid argument` on load)

Typical signs:
- Load returns `EINVAL`.
- Verifier log shows out-of-bounds access, unbounded loop, unknown pointer type.

Actions:
- Enable and capture verifier logs via Go loader options.
- Reduce the program:
  - comment out blocks until it loads
  - replace complex parsing with minimal counters
- Prefer CO-RE helpers (`BPF_CORE_READ`) over manual struct offset guesses.

### 2) Permission errors (`operation not permitted`, `permission denied`)

Typical causes:
- Missing BPF/tracing capabilities.
- Kernel lockdown / LSM policy.
- Unprivileged BPF disabled.

Actions:
- Run a feature probe (`bpftool feature probe` if available).
- Confirm the runtime user has required permissions.
- If inside containers, confirm CAPs are passed and relevant mounts are present.

### 3) Attach succeeds but nothing happens

Actions:
- Add a simple counter map increment in the BPF program.
- Confirm the attach point is correct:
  - correct tracepoint category/name
  - correct symbol exists for kprobe/uprobes
  - correct network interface for XDP/TC
- Confirm your event reader is running and decoding structs correctly.

### 4) CO-RE / relocation errors

Typical signs:
- Errors mentioning BTF, relocations, or missing types.

Actions:
- Ensure `vmlinux.h` matches the *target* kernel (or is generated from its BTF).
- Ensure the kernel exposes BTF (`/sys/kernel/btf/vmlinux`).
- Regenerate bindings and rebuild.

## Useful commands (Linux)

- Kernel and BTF:
  - `uname -r`
  - `ls -l /sys/kernel/btf/vmlinux`
- Feature probe:
  - `bpftool feature probe` (if present)
- Inspect programs:
  - `bpftool prog list`
  - `bpftool map list`

## When to revisit the toolchain

If errors mention missing headers, missing `clang` BPF support, or missing `vmlinux.h`, switch to:
- `references/toolchain-and-core.md`
