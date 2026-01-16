# tcpwatch-app v0.1.9

## Highlights

- Captures: right-click a split stream row and open **Expert Information**.
- Expert Information: shows Wireshark-style per-packet expert messages (severity + group keyword aliases).
- Includes a collapsible summary based on `tshark -z expert`.

## Details

- Captures table now supports a context menu (right-click) for per-connection analysis.
- Expert Information results include:
  - Packet number
  - Severity (`chat`, `note`, `warn`, `error`)
  - Group (e.g. `sequence`, `protocol`, `checksum`, `deprecated`, `reassemble`, `malformed`, `undecoded`, etc.)
  - Protocol (derived from frame protocols)
  - Message
- Includes a “Summary (tshark -z expert)” section for a quick overview.

## Notes / Requirements

- Requires Wireshark (provides `tshark`).
- Results depend on dissectors and captured traffic; some streams may show no expert items.

## Upgrade / Compatibility

- No config changes required.
