# tcpwatch

Live TCP connection viewer for macOS.

macOS does **not** support Linux-style eBPF, so this tool uses macOS system APIs (via `sysctl`) through `gopsutil`.

## Build

From the repo root:

```bash
cd tools/tcpwatch

go mod tidy

go build -o tcpwatch
```

## Run

```bash
./tcpwatch
```

Useful flags:

```bash
./tcpwatch -interval 500ms
./tcpwatch -once
./tcpwatch -state ESTABLISHED
./tcpwatch -pid 1234
./tcpwatch -proc chrome
./tcpwatch -port 443
./tcpwatch -json -once
```

## eBPF alternative (Linux)

If you specifically want **eBPF**, run the tool inside a Linux VM/container (e.g. Lima/Colima) and build a Linux version using `github.com/cilium/ebpf` + kprobes/tracepoints.
