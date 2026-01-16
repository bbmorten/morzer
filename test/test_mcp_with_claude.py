#!/usr/bin/env python3
"""
Test script demonstrating how to use MCP servers with Claude.

This script:
1. Loads MCP server configuration from .mcp.json
2. Starts the MCP server (mcpcap)
3. Connects Claude to the MCP server
4. Lets Claude use the MCP tools to analyze pcap files
"""

import asyncio
import json
import os
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


async def run_with_mcp_tools():
    """Run Claude with MCP tools available."""
    load_env()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    # Load MCP config
    mcp_config = load_mcp_config()
    mcpcap_config = mcp_config["mcpServers"]["mcpcap"]

    print(f"Starting MCP server: {mcpcap_config['command']}")

    # Create server parameters
    server_params = StdioServerParameters(
        command=mcpcap_config["command"],
        args=mcpcap_config.get("args", []),
    )

    # Connect to MCP server
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            # Initialize the session
            await session.initialize()

            # List available tools
            tools_result = await session.list_tools()
            print(f"\nAvailable MCP tools ({len(tools_result.tools)}):")
            for tool in tools_result.tools:
                print(f"  - {tool.name}: {tool.description[:60]}...")

            # Convert MCP tools to Anthropic tool format
            anthropic_tools = []
            for tool in tools_result.tools:
                anthropic_tools.append({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.inputSchema,
                })

            # Create Anthropic client
            client = anthropic.Anthropic(api_key=api_key)

            # Example: Ask Claude to analyze a pcap file
            pcap_file = Path(__file__).parent.parent / "captures" / "http-download-bad.pcapng"

            if not pcap_file.exists():
                print(f"\nWarning: Sample file not found: {pcap_file}")
                print("Using a simple test query instead.\n")
                user_message = "What tools do you have available? List them briefly."
            else:
                user_message = f"Analyze this pcap file and tell me about it: {pcap_file}"

            print(f"\nUser: {user_message}\n")
            print("-" * 60)

            messages = [{"role": "user", "content": user_message}]

            # Agentic loop - keep going until Claude is done
            while True:
                response = client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=4096,
                    tools=anthropic_tools,
                    messages=messages,
                )

                # Process response content
                assistant_content = []
                for block in response.content:
                    if block.type == "text":
                        print(f"Claude: {block.text}")
                        assistant_content.append(block)
                    elif block.type == "tool_use":
                        print(f"\n[Calling tool: {block.name}]")
                        print(f"  Input: {json.dumps(block.input, indent=2)[:200]}...")
                        assistant_content.append(block)

                # Add assistant response to messages
                messages.append({"role": "assistant", "content": assistant_content})

                # Check if we need to handle tool calls
                if response.stop_reason == "tool_use":
                    tool_results = []

                    for block in response.content:
                        if block.type == "tool_use":
                            # Call the MCP tool
                            try:
                                result = await session.call_tool(
                                    block.name,
                                    arguments=block.input,
                                )
                                # Extract text content from result
                                result_text = ""
                                for content in result.content:
                                    if hasattr(content, "text"):
                                        result_text += content.text

                                print(f"  Result: {result_text[:300]}...")

                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": result_text,
                                })
                            except Exception as e:
                                print(f"  Error: {e}")
                                tool_results.append({
                                    "type": "tool_result",
                                    "tool_use_id": block.id,
                                    "content": f"Error: {e}",
                                    "is_error": True,
                                })

                    # Add tool results to messages
                    messages.append({"role": "user", "content": tool_results})

                elif response.stop_reason == "end_turn":
                    # Claude is done
                    break
                else:
                    print(f"\nUnexpected stop reason: {response.stop_reason}")
                    break

            print("\n" + "-" * 60)
            print("Done!")


if __name__ == "__main__":
    asyncio.run(run_with_mcp_tools())
