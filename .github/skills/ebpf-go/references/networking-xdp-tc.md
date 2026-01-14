# Networking Track (XDP / TC)

Use this reference when the goal is packet steering, filtering, shaping, or telemetry on ingress/egress.

## Choose XDP vs TC

- **XDP** (very fast, early ingress): best for drop/pass/redirect, simple parsing, DDoS-style filtering.
- **TC** (ingress/egress with richer context): best for shaping/classification, egress policy, and integrations where a qdisc is acceptable.

Rule of thumb:
- If you need maximum performance and can live with constraints → XDP.
- If you need flexibility (ingress/egress, more helpers/context) → TC.

## Attach considerations

- XDP modes:
  - driver/native (fastest)
  - generic (works broadly, slower)
  - offload (NIC dependent)
- TC requires `clsact` qdisc on the interface.

## Map/event patterns

- Prefer per-cpu counters for packet/byte stats.
- Use LPM trie maps for prefix-based matching.
- For telemetry, aggregate in maps and export periodically; avoid emitting one event per packet.

## Parsing tips

- Keep parsing bounded and defensive:
  - verify `data + sizeof(hdr) <= data_end`
  - minimal header walks
- Be explicit about endianness (network byte order).

## Debugging cues

- “Attach fails”: wrong interface, missing clsact (TC), unsupported XDP mode.
- “Packets drop unexpectedly”: add counters per decision branch; verify header bounds checks.

For general attach APIs and hook mapping see:
- `references/program-types-and-attach.md`
