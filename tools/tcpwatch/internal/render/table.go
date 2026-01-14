package render

import (
	"fmt"
	"io"
	"sort"
	"strings"
	"text/tabwriter"
	"time"
)

type Row struct {
	Proto  string
	Local  string
	Remote string
	State  string
	PID    int32
	// Process may be empty if unavailable.
	Process string
}

type Options struct {
	ShowHeader bool
	Now        time.Time
	Title      string
}

func PrintTable(w io.Writer, rows []Row, opts Options) {
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].State != rows[j].State {
			return rows[i].State < rows[j].State
		}
		if rows[i].Local != rows[j].Local {
			return rows[i].Local < rows[j].Local
		}
		if rows[i].Remote != rows[j].Remote {
			return rows[i].Remote < rows[j].Remote
		}
		return rows[i].PID < rows[j].PID
	})

	tw := tabwriter.NewWriter(w, 0, 4, 2, ' ', 0)
	if opts.Title != "" {
		fmt.Fprintln(tw, opts.Title)
	}
	if !opts.Now.IsZero() {
		fmt.Fprintf(tw, "Updated:\t%s\n", opts.Now.Format(time.RFC3339))
	}
	if opts.ShowHeader {
		fmt.Fprintln(tw, "PROTO\tLOCAL\tREMOTE\tSTATE\tPID\tPROCESS")
	}

	for _, r := range rows {
		process := strings.TrimSpace(r.Process)
		if process == "" {
			process = "-"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%d\t%s\n", r.Proto, r.Local, r.Remote, r.State, r.PID, process)
	}
	_ = tw.Flush()
}
