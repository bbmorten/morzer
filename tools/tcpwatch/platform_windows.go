//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// afINET6 is the address family constant for IPv6 on Windows.
const afINET6 = 23

// platformSignals returns the OS signals to handle for graceful shutdown.
// Windows does not support SIGTERM, so we only handle Interrupt (Ctrl+C).
func platformSignals() []os.Signal {
	return []os.Signal{os.Interrupt}
}

// platformName returns a user-friendly name for the current platform.
func platformName() string {
	return "Windows"
}

// platformNote returns a note about platform-specific implementation details.
func platformNote() string {
	return "Note: This tool uses Windows APIs via gopsutil for TCP connection monitoring."
}

// psComm attempts to retrieve the process name for a given PID using tasklist.
// This is used as a fallback when gopsutil cannot retrieve the process name.
func psComm(ctx context.Context, pid int32) (string, error) {
	cmd := exec.CommandContext(ctx, "tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/FO", "CSV", "/NH")
	out, err := cmd.Output()
	if err != nil {
		return "", err
	}

	// tasklist CSV output format: "ImageName","PID","SessionName","SessionNum","MemUsage"
	line := strings.TrimSpace(string(out))
	if line == "" || strings.Contains(line, "No tasks are running") {
		return "", fmt.Errorf("process not found")
	}

	// Parse CSV: split by comma and extract first field (image name)
	parts := strings.Split(line, ",")
	if len(parts) < 1 {
		return "", fmt.Errorf("unexpected tasklist output format")
	}

	// Remove surrounding quotes from image name
	name := strings.Trim(parts[0], "\"")
	if name == "" {
		return "", fmt.Errorf("tasklist returned empty image name")
	}

	return name, nil
}
