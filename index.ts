/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Uses OSC 777 escape sequence supported by Ghostty, iTerm2, and other modern terminals.
 *
 * Click the notification to focus the terminal tab/window.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Send a desktop notification via OSC 777 escape sequence.
 * Supported by: Ghostty, iTerm2, rxvt-unicode, and others.
 */
function notify(title: string, body: string): void {
  // OSC 777 format: ESC ] 777 ; notify ; title ; body BEL
  process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    notify("Pi", "Ready for input");
  });
}
