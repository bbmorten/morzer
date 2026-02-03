//go:build darwin

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// afINET6 is the address family constant for IPv6 on Darwin.
const afINET6 = 30

// platformSignals returns the OS signals to handle for graceful shutdown.
func platformSignals() []os.Signal {
	return []os.Signal{os.Interrupt, syscall.SIGTERM}
}

// platformName returns a user-friendly name for the current platform.
func platformName() string {
	return "macOS"
}

// platformNote returns a note about platform-specific implementation details.
func platformNote() string {
	return "Note: macOS does not support Linux eBPF; this tool uses system APIs (sysctl) via gopsutil."
}

// psComm attempts to retrieve the process name for a given PID using the ps command.
// This is used as a fallback when gopsutil cannot retrieve the process name.
func psComm(ctx context.Context, pid int32) (string, error) {
	cmd := exec.CommandContext(ctx, "ps", "-p", fmt.Sprint(pid), "-o", "comm=")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}
	name := strings.TrimSpace(string(out))
	if name == "" {
		return "", fmt.Errorf("ps returned empty comm")
	}
	return filepath.Base(name), nil
}
