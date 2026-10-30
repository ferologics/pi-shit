# Review guidelines

These override the default review rubric where they conflict.

- Report a finding only when it affects correctness, security, data integrity, or a stated requirement (the task, a spec, AGENTS.md), or when it is a band-aid (see the last item). Label anything else optional and list at most three.
- A sound change gets no findings. Don't list issues to fill the report.
- Check each finding against the code before you report it. Back it with evidence: the input, caller, or state that triggers it (`file:line`), or the quoted requirement it breaks. Without evidence it is a question; label it as one.
- Describe the symptom and where it shows. Don't write replacement code or suggestion blocks, and don't prescribe the fix. If the cause looks like it lives somewhere other than the flagged line, say where.
- Don't ask for tests unless they would catch a defect you can name. Don't flag hardening for inputs the types or callers already exclude.
- Band-aids count as findings: special cases layered on shared code, guards around code the change should have removed, and code that goes around an existing path instead of through it.
