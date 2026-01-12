# pi-notify

A simple [Pi](https://github.com/badlogic/pi-mono) extension that sends a native desktop notification when the agent finishes and is waiting for input.

Uses **OSC 777** escape sequence - no external dependencies.

## Supported Terminals

- Ghostty ✓
- iTerm2 ✓
- rxvt-unicode ✓
- Any terminal supporting OSC 777

## Install

Copy to Pi extensions:

```bash
cp index.ts ~/.pi/agent/extensions/pi-notify.ts
```

Or symlink for easy updates:

```bash
ln -s /path/to/pi-notify/index.ts ~/.pi/agent/extensions/pi-notify.ts
```

Add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "~/.pi/agent/extensions/pi-notify.ts"
  ]
}
```

Restart Pi.

## How it works

When Pi's agent finishes (`agent_end` event), the extension writes an OSC 777 escape sequence to stdout:

```
ESC ] 777 ; notify ; Pi ; Ready for input BEL
```

The terminal interprets this and shows a native notification. Clicking the notification focuses the terminal window/tab.

## License

MIT
