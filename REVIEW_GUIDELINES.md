# Review guidelines

Decisions a reviewer would otherwise flag again.

- the-dude may write terminal mode resets (DECSET 1004 off) in `session_shutdown`. With the pty gone Pi skips extension shutdown handlers anyway, and with it alive the write succeeds.
- the-dude reads focus reports from raw stdin on purpose: in fullscreen mode Pi's own input listener consumes them before `ctx.ui.onTerminalInput` listeners run.
- Each interactive session's message socket (`~/.local/state/pi/live/<pid>.sock`, 0600 in a 0700 directory) accepting messages from any process of the same user is an accepted design.
