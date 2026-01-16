#!/usr/bin/env python3
"""Test script to verify Anthropic API key is working."""

import os
import sys

try:
    import anthropic
except ImportError:
    print("Error: anthropic package not installed.")
    print("Run: pip install anthropic")
    sys.exit(1)


def test_api_key():
    """Test the Anthropic API key by making a simple request."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")

    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set.")
        print("\nSet it with:")
        print("  export ANTHROPIC_API_KEY='your-api-key-here'")
        sys.exit(1)

    print(f"API Key found: {api_key[:10]}...{api_key[-4:]}")
    print("\nTesting API connection...")

    try:
        client = anthropic.Anthropic(api_key=api_key)

        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=100,
            messages=[
                {"role": "user", "content": "Say 'API key is working!' and nothing else."}
            ]
        )

        response_text = message.content[0].text
        print(f"\nResponse from Claude: {response_text}")
        print(f"\nModel used: {message.model}")
        print(f"Input tokens: {message.usage.input_tokens}")
        print(f"Output tokens: {message.usage.output_tokens}")
        print("\nAPI key is valid and working!")
        return True

    except anthropic.AuthenticationError:
        print("\nError: Invalid API key. Please check your ANTHROPIC_API_KEY.")
        return False
    except anthropic.RateLimitError:
        print("\nError: Rate limit exceeded. Your API key is valid but you've hit the rate limit.")
        return True  # Key is valid, just rate limited
    except anthropic.APIError as e:
        print(f"\nAPI Error: {e}")
        return False
    except Exception as e:
        print(f"\nUnexpected error: {e}")
        return False


if __name__ == "__main__":
    success = test_api_key()
    sys.exit(0 if success else 1)
