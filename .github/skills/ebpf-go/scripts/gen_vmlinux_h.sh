#!/usr/bin/env bash
set -euo pipefail

# Generate a CO-RE vmlinux.h from the running kernel's BTF.
# Linux only.

out="${1:-bpf/vmlinux.h}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "error: this script must run on Linux" >&2
  exit 1
fi

if ! command -v bpftool >/dev/null 2>&1; then
  echo "error: bpftool not found" >&2
  exit 1
fi

btf="/sys/kernel/btf/vmlinux"
if [[ ! -e "$btf" ]]; then
  echo "error: $btf not found (kernel BTF not available)" >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"

tmp="${out}.tmp"

bpftool btf dump file "$btf" format c > "$tmp"

# Simple sanity check.
if ! grep -q "typedef" "$tmp"; then
  echo "error: generated header does not look right: $tmp" >&2
  exit 1
fi

mv "$tmp" "$out"

echo "wrote: $out"
