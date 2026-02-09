# TODO

## Use system temp dir instead of hardcoded `/tmp`

Goal: align temp path behavior with platform defaults (`$TMPDIR` / `os.tmpdir()`), especially on macOS where temp paths live under `/var/folders/.../T`.

### TODO

- [ ] Replace hardcoded `/tmp` paths in `prepare-pr-context.sh`:
  - `WORK_DIR` should use `${TMPDIR:-/tmp}`
  - `--tmp-output` directory should use `${TMPDIR:-/tmp}/context-packer/...`
- [ ] Keep fallback behavior when `TMPDIR` is unset (`/tmp`)
- [ ] Update script help text (`--tmp-output`) to say "system temp dir" instead of `/tmp`
- [ ] Update `SKILL.md` examples/wording to match new temp-dir behavior
- [ ] Ensure deep-review still parses context-pack output paths correctly after this change

### Exit criteria

- [ ] No hardcoded `/tmp` remains in temp-output path creation
- [ ] On macOS, default output lands under `/var/folders/.../T/...`
- [ ] Deep-review can still extract and read the generated `pr-context.txt` path

## Include commit history in PR context output

Goal: improve PR context quality by capturing the commit timeline (intent + progression), not just the final diff.

### TODO

- [ ] Add a commit-history section to `prepare-pr-context.sh` using the same PR commit range as the diff
- [ ] Include per-commit metadata: short SHA, author, date, and subject line
- [ ] Insert this section into generated `pr-context.txt` with a clear heading
- [ ] Update `SKILL.md` so the output format documents the commit-history section

### Exit criteria

- [ ] Generated `pr-context.txt` includes a clearly labeled commit-history section
- [ ] Commit history reflects the same range used for PR diff generation
- [ ] `SKILL.md` reflects the new output section
