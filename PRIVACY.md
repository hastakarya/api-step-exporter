# Privacy Policy — API Step Exporter

_Last updated: 2026-09-15_

## Summary

API Step Exporter runs entirely on your device. It does not have a server,
does not send data anywhere, and does not include analytics, telemetry, or
any third-party service.

## What the extension can access

To do its job — documenting API requests you're testing with a matching
screenshot — the extension can access, while its DevTools panel is open:

- **Network request and response data** for the page you're inspecting
  (method, URL, headers, request body, response body), read from Chrome's
  DevTools Network APIs.
- **A screenshot of the currently inspected browser tab**, taken
  automatically when a Fetch/XHR request finishes, or manually when you
  click "Capture Step" / "Capture All".
- **An image file you choose to upload**, if you use the "replace image"
  button to swap a captured screenshot for your own picture. That file is
  read locally and never leaves your device.

## What happens to that data

- Everything above is held only in the DevTools panel's memory while it's
  open. Closing the panel, closing DevTools, or clicking "Clear List" /
  "Clear Steps" discards it.
- The only thing written to browser storage is your light/dark theme
  preference (`localStorage`) — no captured request, response, or image
  data is ever persisted there.
- Data leaves the extension only when you explicitly trigger it:
  - **Export** (Markdown or HTML) writes a file to your own Downloads
    folder, using the browser's own download mechanism.
  - **Copy buttons** write text or an image to your OS clipboard.
  - Nothing is uploaded, transmitted, or sent to any server — including
    ours, since there is no "ours": the extension has no backend.

## Sensitive data you capture

Because this tool captures real API traffic, whatever your inspected page
sends or receives — which may include authentication tokens, personal
information, or other sensitive fields — can end up in a captured step and
in anything you export or copy. The extension does not read, log, or
transmit that data anywhere by itself; it stays under your control the same
way any other file or clipboard content does. Review an export before
sharing it, and only use this tool against applications you're authorized
to test.

One safeguard already built in: if a captured body looks like binary data
(such as a file upload) rather than text, it's replaced with a placeholder
noting its size, instead of being included as-is.

## Permissions

See the permission justifications in the Chrome Web Store / Firefox Add-ons
listing for why each requested permission is needed.

## Changes to this policy

If this extension's data handling ever changes, this file will be updated
alongside that change, in the same repository.

## Contact

Questions or concerns: open an issue at
[github.com/hastakarya/api-step-exporter](https://github.com/hastakarya/api-step-exporter/issues).
