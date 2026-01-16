#!/usr/bin/env python3
"""
Packet Analysis using MCP tools and Claude.

This script implements the workflow described in .github/prompts/packet-analysis.md:
1. Capture Metadata (analyze_capinfos)
2. Protocol-Specific Analysis (DNS, DHCP, ICMP)
3. Deep Packet Inspection (via tshark if available)
4. Performance Assessment

Usage:
    python test/test_packet_analysis.py <pcap_file>
    python test/test_packet_analysis.py captures/http-download-bad.pcapng
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    import anthropic
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
except ImportError as e:
    print(f"Error: Missing package - {e}")
    print("Run: pip install anthropic mcp")
    sys.exit(1)


def load_env():
    """Load environment variables from .env file."""
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key, value)


def load_mcp_config():
    """Load MCP server configuration from .mcp.json."""
    config_path = Path(__file__).parent.parent / ".mcp.json"
    if not config_path.exists():
        print(f"Error: {config_path} not found")
        sys.exit(1)

    with open(config_path) as f:
        return json.load(f)


def get_tshark_analysis(pcap_file: str) -> dict:
    """Run tshark analysis for deep packet inspection."""
    results = {}

    # Check if tshark is available
    tshark_path = "/Applications/Wireshark.app/Contents/MacOS/tshark"
    if not Path(tshark_path).exists():
        tshark_path = "tshark"

    try:
        # TCP conversation statistics
        result = subprocess.run(
            [tshark_path, "-r", pcap_file, "-q", "-z", "conv,tcp"],
            capture_output=True, text=True, timeout=30
        )
        results["tcp_conversations"] = result.stdout

        # Expert info
        result = subprocess.run(
            [tshark_path, "-r", pcap_file, "-q", "-z", "expert,note"],
            capture_output=True, text=True, timeout=30
        )
        results["expert_info"] = result.stdout

        # IO statistics with retransmissions
        result = subprocess.run(
            [tshark_path, "-r", pcap_file, "-q", "-z",
             "io,stat,0,COUNT(tcp.analysis.retransmission)tcp.analysis.retransmission,"
             "COUNT(tcp.analysis.duplicate_ack)tcp.analysis.duplicate_ack,"
             "COUNT(tcp.analysis.lost_segment)tcp.analysis.lost_segment,"
             "COUNT(tcp.analysis.zero_window)tcp.analysis.zero_window"],
            capture_output=True, text=True, timeout=30
        )
        results["tcp_stats"] = result.stdout

        # RTT statistics
        result = subprocess.run(
            [tshark_path, "-r", pcap_file, "-Y", "tcp.analysis.ack_rtt",
             "-T", "fields", "-e", "tcp.analysis.ack_rtt"],
            capture_output=True, text=True, timeout=30
        )
        if result.stdout.strip():
            rtts = [float(x) for x in result.stdout.strip().split("\n") if x]
            if rtts:
                results["rtt_stats"] = {
                    "samples": len(rtts),
                    "min_ms": min(rtts) * 1000,
                    "max_ms": max(rtts) * 1000,
                    "avg_ms": (sum(rtts) / len(rtts)) * 1000,
                }

    except FileNotFoundError:
        results["error"] = "tshark not found"
    except subprocess.TimeoutExpired:
        results["error"] = "tshark timeout"
    except Exception as e:
        results["error"] = str(e)

    return results


async def analyze_pcap(pcap_file: str):
    """Perform comprehensive packet analysis."""
    load_env()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    pcap_path = Path(pcap_file)
    if not pcap_path.is_absolute():
        pcap_path = Path(__file__).parent.parent / pcap_file

    if not pcap_path.exists():
        print(f"Error: File not found: {pcap_path}")
        sys.exit(1)

    print(f"Analyzing: {pcap_path.name}")
    print("=" * 70)

    # Load MCP config
    mcp_config = load_mcp_config()
    mcpcap_config = mcp_config["mcpServers"]["mcpcap"]

    # Create server parameters
    server_params = StdioServerParameters(
        command=mcpcap_config["command"],
        args=mcpcap_config.get("args", []),
    )

    # Connect to MCP server
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # Step 1: Capture Metadata
            print("\n## Step 1: Capture Metadata\n")
            capinfos_result = await session.call_tool(
                "analyze_capinfos",
                arguments={"pcap_file": str(pcap_path)},
            )
            capinfos_text = capinfos_result.content[0].text
            capinfos_data = json.loads(capinfos_text)

            print(f"| Property | Value |")
            print(f"|----------|-------|")
            print(f"| File | {capinfos_data.get('filename', 'N/A')} |")
            print(f"| Size | {capinfos_data.get('file_size_bytes', 0):,} bytes |")
            print(f"| Packets | {capinfos_data.get('packet_count', 0):,} |")
            print(f"| Duration | {capinfos_data.get('capture_duration_seconds', 0):.2f} seconds |")
            print(f"| Data Rate | {capinfos_data.get('data_rate_bits', 0):.2f} bps |")
            print(f"| Avg Packet Size | {capinfos_data.get('average_packet_size_bytes', 0):.2f} bytes |")

            # Step 2: Protocol-Specific Analysis
            print("\n## Step 2: Protocol-Specific Analysis\n")

            # DNS
            dns_result = await session.call_tool(
                "analyze_dns_packets",
                arguments={"pcap_file": str(pcap_path)},
            )
            dns_data = json.loads(dns_result.content[0].text)
            print(f"- **DNS packets**: {dns_data.get('dns_packets_found', 0)}")

            # DHCP
            dhcp_result = await session.call_tool(
                "analyze_dhcp_packets",
                arguments={"pcap_file": str(pcap_path)},
            )
            dhcp_data = json.loads(dhcp_result.content[0].text)
            print(f"- **DHCP packets**: {dhcp_data.get('dhcp_packets_found', 0)}")

            # ICMP
            icmp_result = await session.call_tool(
                "analyze_icmp_packets",
                arguments={"pcap_file": str(pcap_path)},
            )
            icmp_data = json.loads(icmp_result.content[0].text)
            print(f"- **ICMP packets**: {icmp_data.get('icmp_packets_found', 0)}")

            # Step 3 & 4: Deep Packet Inspection & Performance (via tshark)
            print("\n## Step 3: Deep Packet Inspection (via tshark)\n")
            tshark_results = get_tshark_analysis(str(pcap_path))

            if "error" in tshark_results:
                print(f"Warning: {tshark_results['error']}")
            else:
                if "tcp_conversations" in tshark_results:
                    print("### TCP Conversations\n")
                    print("```")
                    print(tshark_results["tcp_conversations"][:1500])
                    print("```")

                if "tcp_stats" in tshark_results:
                    print("\n### TCP Statistics\n")
                    print("```")
                    print(tshark_results["tcp_stats"])
                    print("```")

                if "rtt_stats" in tshark_results:
                    rtt = tshark_results["rtt_stats"]
                    print("\n### RTT Statistics\n")
                    print(f"| Metric | Value |")
                    print(f"|--------|-------|")
                    print(f"| Samples | {rtt['samples']} |")
                    print(f"| Min RTT | {rtt['min_ms']:.3f} ms |")
                    print(f"| Max RTT | {rtt['max_ms']:.3f} ms |")
                    print(f"| Avg RTT | {rtt['avg_ms']:.3f} ms |")

            # Step 5: Send all data to Claude for analysis
            print("\n## Step 4: Claude Analysis\n")

            analysis_prompt = f"""Analyze this packet capture based on the following data.
Provide a structured analysis with findings and recommendations.

## Capture Metadata
{json.dumps(capinfos_data, indent=2)}

## Protocol Analysis
- DNS: {json.dumps(dns_data, indent=2)}
- DHCP: {json.dumps(dhcp_data, indent=2)}
- ICMP: {json.dumps(icmp_data, indent=2)}

## TCP Analysis (from tshark)
{json.dumps(tshark_results, indent=2)}

Please provide:
1. **Summary**: What kind of traffic is this?
2. **Performance Assessment**: Is there packet loss, high latency, or other issues?
3. **Key Findings**: What stands out in this capture?
4. **Recommendations**: What should be investigated further?

Format your response in markdown.
"""

            client = anthropic.Anthropic(api_key=api_key)
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2000,
                messages=[{"role": "user", "content": analysis_prompt}],
            )

            print(response.content[0].text)

            print("\n" + "=" * 70)
            print("Analysis complete!")


def main():
    if len(sys.argv) < 2:
        # Default to sample file
        pcap_file = "captures/http-download-bad.pcapng"
        print(f"No file specified, using: {pcap_file}\n")
    else:
        pcap_file = sys.argv[1]

    asyncio.run(analyze_pcap(pcap_file))


if __name__ == "__main__":
    main()
