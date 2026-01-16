# Packet Capture Analysis

Analyze network packet captures (.pcap/.pcapng files) using the mcpcap MCP tools.

## How to Use This Prompt

Reference a capture file using `@` notation:

```
Analyze @captures/my-capture.pcapng
```

Or provide a full path:

```
Analyze /path/to/capture.pcap
```

## Analysis Workflow

### Step 1: Capture Metadata

Use `mcp__mcpcap__analyze_capinfos` to get:
- File size and packet count
- Capture duration and timestamps
- Data rates and packet rates
- Average packet sizes

### Step 2: Protocol-Specific Analysis

Run applicable analyzers based on the capture content:

| Tool | Use When |
|------|----------|
| `mcp__mcpcap__analyze_dns_packets` | DNS traffic present |
| `mcp__mcpcap__analyze_dhcp_packets` | DHCP traffic present |
| `mcp__mcpcap__analyze_icmp_packets` | ICMP/ping traffic present |

### Step 3: Deep Packet Inspection

Read the raw file to extract:
- **IP addresses**: Source/destination endpoints
- **Ports**: Service identification (443=HTTPS, 5222=XMPP, etc.)
- **TCP flags**: SYN, ACK, FIN, RST patterns
- **TCP options**: MSS, Window Scale, SACK, Timestamps
- **TLS SNI**: Server names from encrypted connections
- **Payload patterns**: Application protocol indicators

### Step 4: Performance Assessment

Calculate from available data:
- **Throughput**: bytes/duration
- **Packet loss**: retransmissions, duplicate ACKs, SACK blocks
- **RTT estimates**: TCP timestamp deltas
- **Connection state**: successful handshake vs failed attempts

## Output Format

```markdown
## Capture Analysis: `<filename>`

### File Information
| Property | Value |
|----------|-------|
| Size | X bytes |
| Packets | N |
| Duration | X.XX seconds |
| Capture tool | ... |

### Traffic Summary
| Property | Value |
|----------|-------|
| Source IP | ... |
| Destination | ... |
| Protocol | ... |
| Port | ... |

### TCP Analysis
- **Handshake**: Complete/Incomplete/Failed
- **Options**: MSS, Window Scale, SACK, Timestamps
- **Flags observed**: SYN, ACK, PSH, FIN, RST

### Performance Metrics
| Metric | Value | Assessment |
|--------|-------|------------|
| Throughput | X bps | ... |
| Packet loss | X% | ... |
| RTT estimate | Xms | ... |

### Findings
1. ...
2. ...

### Suggested Follow-ups
- ...
```

## Example Queries

- `Analyze @captures/tcp-stream-00001.pcapng` — Full analysis
- `What DNS queries are in @captures/full-capture.pcap?` — DNS-specific
- `Check for packet loss in @captures/slow-connection.pcapng` — Performance focus
- `What servers is this connecting to? @captures/session.pcapng` — Endpoint identification
