/**
 * Pi Notify Extension
 *
 * Sends a native terminal notification when Pi agent is done and waiting for input.
 * Uses OSC 777 escape sequence for modern terminals, or Windows toast notifications
 * for Windows Terminal in WSL.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function windowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
  ].join("; ");
}

function notify(title: string, body: string): void {
  if (process.env.WT_SESSION) {
    const { execFile } = require("child_process");
    execFile("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
  } else {
    process.stdout.write(`\x1b]777;notify;${title};${body}\x07`);
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    notify("Pi", "Ready for input");
  });
}
