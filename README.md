# Pi Skills

My custom skills for [Pi](https://github.com/badlogic/pi-mono).

## Skills

| Skill | Description | Source |
|-------|-------------|--------|
| **brave-search** | Web search via Brave Search API | [badlogic/pi-skills](https://github.com/badlogic/pi-skills/tree/main/brave-search) |
| **code-review** | Local PR review for bugs, style, guidelines | Original |
| **code-simplifier** | Simplify/refine code for clarity | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-simplifier) |
| **markdown-converter** | Convert files to Markdown via `uvx markitdown` | [steipete/agent-scripts](https://github.com/steipete/agent-scripts/tree/main/skills/markdown-converter) |

## Install

Symlink skills to Pi:

```bash
ln -sf /path/to/pi-skills/brave-search ~/.pi/agent/skills/
ln -sf /path/to/pi-skills/code-review ~/.pi/agent/skills/
ln -sf /path/to/pi-skills/code-simplifier ~/.pi/agent/skills/
ln -sf /path/to/pi-skills/markdown-converter ~/.pi/agent/skills/
```

For brave-search, also run:
```bash
cd /path/to/pi-skills/brave-search && npm install
```

## Disable per-repo

Add to `.pi/settings.json` in any repo:
```json
{
  "ignoredSkills": ["*"]
}
```

## License

MIT (except where noted from source)
