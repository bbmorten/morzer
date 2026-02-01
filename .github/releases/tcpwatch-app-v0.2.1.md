# tcpwatch-app-v0.2.1

## Features

- **Editable capture filter** — The capture section now shows a BPF capture filter input field (default: `tcp`). Users can specify custom tshark capture filters such as `tcp port 443`, `host 10.0.0.1`, or any valid BPF expression.
- **Capture filter validation** — On blur, the filter is validated by running `tshark -f "<filter>" -c 0`. Invalid filters display an inline error message and disable the Start Capture button until corrected.

## Notes

- The filter field defaults to `tcp`. If a port is set in connection filters and no custom filter is provided, it falls back to `tcp port <port>`.
- Validation requires tshark to be installed and accessible.
