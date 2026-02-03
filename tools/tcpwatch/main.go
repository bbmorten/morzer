package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"time"

	gnet "github.com/shirou/gopsutil/v4/net"
	gproc "github.com/shirou/gopsutil/v4/process"

	"github.com/bulent/morzer/tools/tcpwatch/internal/render"
)

type options struct {
	interval   time.Duration
	once       bool
	noClear    bool
	jsonOut    bool
	jsonLines  bool
	stateAllow map[string]struct{}
	pidFilter  int32
	portFilter int
	procFilter string
	listen     bool
	header     bool
}

type jsonSnapshot struct {
	Updated time.Time    `json:"updated"`
	Title   string       `json:"title,omitempty"`
	Rows    []render.Row `json:"rows"`
}

type procCacheEntry struct {
	name  string
	until time.Time
}

type procResolver struct {
	ttl   time.Duration
	cache map[int32]procCacheEntry
}

func newProcResolver(ttl time.Duration) *procResolver {
	return &procResolver{
		ttl:   ttl,
		cache: make(map[int32]procCacheEntry),
	}
}

func (r *procResolver) Name(ctx context.Context, pid int32) string {
	if pid <= 0 {
		return ""
	}

	if ent, ok := r.cache[pid]; ok && time.Now().Before(ent.until) {
		return ent.name
	}

	name := ""
	if p, err := gproc.NewProcess(pid); err == nil {
		if n, err := p.NameWithContext(ctx); err == nil {
			name = strings.TrimSpace(n)
		}
	}

	if name == "" {
		if n, err := psComm(ctx, pid); err == nil {
			name = n
		}
	}

	name = strings.TrimSpace(name)
	r.cache[pid] = procCacheEntry{name: name, until: time.Now().Add(r.ttl)}
	return name
}

func main() {
	opts, err := parseFlags(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	procs := newProcResolver(30 * time.Second)

	ctx, stop := signal.NotifyContext(context.Background(), platformSignals()...)
	defer stop()

	if opts.once {
		if err := runOnce(ctx, opts, procs); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	ticker := time.NewTicker(opts.interval)
	defer ticker.Stop()

	for {
		if err := runOnce(ctx, opts, procs); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			fmt.Fprintln(os.Stderr, err)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func runOnce(ctx context.Context, opts options, procs *procResolver) error {
	rows, err := listTCP(ctx, opts, procs)
	if err != nil {
		return err
	}

	if !opts.noClear && !opts.jsonOut && !opts.jsonLines {
		fmt.Print("\033[2J\033[H")
	}

	if opts.jsonLines {
		enc := json.NewEncoder(os.Stdout)
		return enc.Encode(jsonSnapshot{
			Updated: time.Now(),
			Title:   fmt.Sprintf("Live TCP connections (%s)", platformName()),
			Rows:    rows,
		})
	}

	if opts.jsonOut {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(rows)
	}

	render.PrintTable(os.Stdout, rows, render.Options{
		ShowHeader: opts.header,
		Now:        time.Now(),
		Title:      fmt.Sprintf("Live TCP connections (%s)", platformName()),
	})
	return nil
}

func listTCP(ctx context.Context, opts options, procs *procResolver) ([]render.Row, error) {
	// gopsutil uses platform-specific APIs (sysctl on macOS, Windows APIs on Windows).
	conns, err := gnet.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return nil, err
	}

	rows := make([]render.Row, 0, len(conns))
	for _, c := range conns {
		state := normalizeState(c.Status)
		if !opts.listen && state == "LISTEN" {
			continue
		}
		if len(opts.stateAllow) > 0 {
			if _, ok := opts.stateAllow[state]; !ok {
				continue
			}
		}
		if opts.pidFilter >= 0 && c.Pid != opts.pidFilter {
			continue
		}
		if opts.portFilter > 0 {
			if int(c.Laddr.Port) != opts.portFilter && int(c.Raddr.Port) != opts.portFilter {
				continue
			}
		}

		procName := procs.Name(ctx, c.Pid)
		if opts.procFilter != "" {
			if procName == "" {
				continue
			}
			if !strings.Contains(strings.ToLower(procName), strings.ToLower(opts.procFilter)) {
				continue
			}
		}

		rows = append(rows, render.Row{
			Proto:   familyProto(c.Family),
			Local:   formatAddr(c.Laddr),
			Remote:  formatAddr(c.Raddr),
			State:   state,
			PID:     c.Pid,
			Process: procName,
		})
	}

	return rows, nil
}

func familyProto(family uint32) string {
	// Values come from syscall.AF_* constants, but we only need a user-friendly label.
	switch family {
	case 2: // AF_INET
		return "tcp4"
	case afINET6:
		return "tcp6"
	default:
		return "tcp"
	}
}

func formatAddr(a gnet.Addr) string {
	if a.IP == "" && a.Port == 0 {
		return "*:*"
	}
	ip := a.IP
	if ip == "" {
		ip = "*"
	}

	parsed := net.ParseIP(ip)
	if parsed != nil && parsed.To4() == nil {
		return fmt.Sprintf("[%s]:%d", ip, a.Port)
	}
	return fmt.Sprintf("%s:%d", ip, a.Port)
}

func normalizeState(s string) string {
	s = strings.TrimSpace(strings.ToUpper(s))
	if s == "" {
		return "UNKNOWN"
	}
	return s
}

func parseFlags(args []string) (options, error) {
	var opts options

	fs := flag.NewFlagSet("tcpwatch", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)

	fs.DurationVar(&opts.interval, "interval", 1*time.Second, "Refresh interval (e.g. 500ms, 2s)")
	fs.BoolVar(&opts.once, "once", false, "Print once and exit")
	fs.BoolVar(&opts.noClear, "no-clear", false, "Don’t clear the screen between refreshes")
	fs.BoolVar(&opts.jsonOut, "json", false, "Output as JSON")
	fs.BoolVar(&opts.jsonLines, "jsonl", false, "Output as NDJSON stream (one JSON object per refresh)")
	fs.BoolVar(&opts.listen, "listen", true, "Include LISTEN sockets")
	fs.BoolVar(&opts.header, "header", true, "Print table header")

	states := fs.String("state", "", "Comma-separated TCP states to include (e.g. ESTABLISHED,CLOSE_WAIT)")
	pid := fs.String("pid", "", "Only show connections owned by this PID")
	port := fs.Int("port", 0, "Only show connections where local or remote port matches this value")
	proc := fs.String("proc", "", "Only show connections whose process name contains this substring (case-insensitive)")

	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "tcpwatch: live TCP connection viewer for %s\n", platformName())
		fmt.Fprintln(fs.Output(), "")
		fmt.Fprintln(fs.Output(), platformNote())
		fmt.Fprintln(fs.Output(), "")
		fmt.Fprintln(fs.Output(), "Usage:")
		fmt.Fprintln(fs.Output(), "  tcpwatch [flags]")
		fmt.Fprintln(fs.Output(), "")
		fmt.Fprintln(fs.Output(), "Flags:")
		fs.PrintDefaults()
	}

	if err := fs.Parse(args); err != nil {
		return options{}, err
	}

	if opts.jsonOut && opts.jsonLines {
		return options{}, fmt.Errorf("-json and -jsonl are mutually exclusive")
	}

	if opts.interval <= 0 {
		return options{}, fmt.Errorf("-interval must be > 0")
	}

	if *port < 0 || *port > 65535 {
		return options{}, fmt.Errorf("-port must be between 0 and 65535")
	}
	opts.portFilter = *port

	opts.pidFilter = -1
	if strings.TrimSpace(*pid) != "" {
		p64, err := strconv.ParseInt(strings.TrimSpace(*pid), 10, 32)
		if err != nil {
			return options{}, fmt.Errorf("invalid -pid: %w", err)
		}
		opts.pidFilter = int32(p64)
	}

	opts.stateAllow = parseStateAllow(*states)
	opts.procFilter = strings.TrimSpace(*proc)
	return opts, nil
}

func parseStateAllow(csv string) map[string]struct{} {
	csv = strings.TrimSpace(csv)
	if csv == "" {
		return nil
	}

	out := make(map[string]struct{})
	for _, part := range strings.Split(csv, ",") {
		state := normalizeState(part)
		out[state] = struct{}{}
	}
	return out
}
