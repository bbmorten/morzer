# tcpwatch-app-v0.1.13

## Features

- Add a new **DNS** page:
  - Select (or drag & drop) a `.pcap/.pcapng` and tcpwatch extracts DNS-related packets into a new folder as `dns.pcapng`.
  - Extract includes **DNS + mDNS + LLMNR**.
  - Click to open `dns.pcapng` in Wireshark; right-click **Analyze** runs the DNS analysis prompt.

- Captures UX improvements:
  - Show **Packets** and **Size** columns for split stream files.

## Analyze

- DNS Analyze uses the prompt `.github/prompts/dns-analysis.md` (bundled into packaged builds under `Contents/Resources/prompts/dns-analysis.md`).

## Notes

- Packet counts are best-effort and derived from `tshark` output.
