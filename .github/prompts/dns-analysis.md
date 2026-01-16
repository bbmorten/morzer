# DNS Traffic Analysis

Note for tcpwatch app integrations: the app will provide you the outputs of the relevant `mcpcap` tools (and optional `tshark` stats) inline. Do not request additional tools; analyze only the provided data.

Analyze DNS traffic (including mDNS and LLMNR) in packet captures (.pcap/.pcapng files) using the mcpcap MCP tools.

## How to Use This Prompt

Reference a capture file using `@` notation:

```
Analyze DNS in @captures/my-capture.pcapng
```

Or provide a full path:

```
Analyze DNS traffic in /path/to/capture.pcap
```

## Analysis Workflow

### Step 1: Capture Overview

Use `mcp__mcpcap__analyze_capinfos` to get:
- Total packet count
- Capture duration and timestamps
- Data rates

### Step 2: DNS Packet Analysis

Use `mcp__mcpcap__analyze_dns_packets` to extract:
- Total DNS packets (queries and responses)
- Query types (A, AAAA, CNAME, MX, TXT, PTR, etc.)
- Domain names queried
- Response codes (NOERROR, NXDOMAIN, SERVFAIL, etc.)
- DNS servers used

### Step 3: DNS-Specific Inspection

Analyze the DNS data for:
- **Query patterns**: What domains are being resolved?
- **Response times**: How long do DNS lookups take?
- **Failures**: NXDOMAIN, SERVFAIL, timeouts
- **DNS servers**: Which resolvers are being used?
- **Record types**: A, AAAA, CNAME, MX, TXT, SRV, PTR
- **TTL values**: Cache behavior implications

### Step 4: Security Assessment

Look for potential issues:
- **DNS tunneling**: Unusually long domain names or high query volume
- **DGA patterns**: Random-looking domain names (malware indicators)
- **Suspicious TLDs**: Uncommon or known-bad top-level domains
- **High NXDOMAIN rate**: May indicate malware or misconfiguration
- **DNS amplification**: Large responses to small queries
- **Zone transfers**: AXFR/IXFR requests (potential reconnaissance)

## Output Format

```markdown
## DNS Analysis: `<filename>`

### Capture Overview
| Property | Value |
|----------|-------|
| Total Packets | N |
| DNS Packets | N |
| Duration | X.XX seconds |
| DNS Query Rate | X queries/sec |

### DNS Statistics
| Metric | Count |
|--------|-------|
| Queries | N |
| Responses | N |
| Successful (NOERROR) | N |
| Failed (NXDOMAIN) | N |
| Server Failures | N |

### Query Types
| Type | Count | Percentage |
|------|-------|------------|
| A | N | X% |
| AAAA | N | X% |
| CNAME | N | X% |
| ... | ... | ... |

### Top Queried Domains
| Domain | Query Count |
|--------|-------------|
| example.com | N |
| ... | ... |

### DNS Servers Used
| Server IP | Query Count |
|-----------|-------------|
| 8.8.8.8 | N |
| ... | ... |

### Response Time Analysis
| Metric | Value |
|--------|-------|
| Min Response Time | X ms |
| Max Response Time | X ms |
| Avg Response Time | X ms |

### Security Findings
- ...

### Recommendations
- ...
```

## Example Queries

- `Analyze DNS in @captures/network-traffic.pcapng` — Full DNS analysis
- `What domains are being queried in @captures/suspect.pcap?` — Domain enumeration
- `Check for DNS failures in @captures/troubleshoot.pcapng` — Error analysis
- `Are there any suspicious DNS patterns in @captures/malware-sample.pcap?` — Security focus
- `What DNS servers are being used in @captures/client.pcapng?` — Resolver identification

## Common DNS Response Codes

| Code | Name | Meaning |
|------|------|---------|
| 0 | NOERROR | Query successful |
| 1 | FORMERR | Format error in query |
| 2 | SERVFAIL | Server failed to process |
| 3 | NXDOMAIN | Domain does not exist |
| 4 | NOTIMP | Not implemented |
| 5 | REFUSED | Query refused by server |

## DNS Record Types Reference

| Type | Description |
|------|-------------|
| A | IPv4 address |
| AAAA | IPv6 address |
| CNAME | Canonical name (alias) |
| MX | Mail exchange server |
| NS | Name server |
| PTR | Pointer (reverse DNS) |
| TXT | Text record |
| SRV | Service location |
| SOA | Start of authority |
| CAA | Certificate authority authorization |
