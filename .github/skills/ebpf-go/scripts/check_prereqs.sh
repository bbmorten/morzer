#!/usr/bin/env bash
set -euo pipefail

# Quick environment probe for Go + eBPF development.
# Intended to run on Linux. On non-Linux, it will provide partial information.

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "missing: $1" >&2
    return 1
  fi
}

echo "== basic =="
uname -a || true

missing=0

echo "\n== toolchain =="
need_cmd go || missing=1
need_cmd clang || missing=1

# Optional but commonly useful.
command -v llvm-strip >/dev/null 2>&1 || echo "note: llvm-strip not found (often OK)"
command -v bpftool >/dev/null 2>&1 || echo "note: bpftool not found (needed for feature probe / vmlinux.h generation)"

if [[ "$(uname -s)" == "Linux" ]]; then
  echo "\n== linux specifics =="
  if [[ -e /sys/kernel/btf/vmlinux ]]; then
    echo "BTF: /sys/kernel/btf/vmlinux present"
  else
    echo "BTF: /sys/kernel/btf/vmlinux missing (CO-RE may be harder)" >&2
  fi

  if command -v bpftool >/dev/null 2>&1; then
    echo "\n== bpftool feature probe (summary) =="
    bpftool feature probe | sed -n '1,120p' || true
  fi
else
  echo "\n== note =="
  echo "eBPF requires Linux. Use a Linux VM/container for real testing." >&2
fi

if [[ "$missing" -ne 0 ]]; then
  echo "\nOne or more required tools are missing." >&2
  exit 1
fi

echo "\nOK"
