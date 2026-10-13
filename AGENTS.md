# Agent Entry Point
Follow this repository rule before doing any task.

<!-- codex-conductor:start -->
## Conductor Guardrail
Always run `conductor:status` first.

- Command alias: `conductor_status`
- Direct command: `python3 scripts/conductor_tools.py status --auto-setup`
- Behavior: if Conductor is missing, status runs setup and creates the baseline.

## Cross-Repo Vendored Content

`docs/research/ascii/semantic_maps/` is a **symlink** to `asciicker-Y9-2/docs/research/ascii/semantic_maps/`.
Y9-2 is the upstream provider of the semantic map JSON files and anchor data (this subproject vendors a copy). The project's single canonical final-authority record remains `docs/FAILURE_LOG.md`.
Pipeline-v3 vendors them so the validator (`scripts/validate_semantic_maps.py`) can run locally.

- Do NOT create or edit semantic map files in pipeline-v3 directly — edit in Y9-2.
- The symlink uses a relative path (`../../../../asciicker-Y9-2/...`) assuming both repos are siblings.
- If the symlink is broken, re-create: `ln -sfn ../../../../asciicker-Y9-2/docs/research/ascii/semantic_maps docs/research/ascii/semantic_maps`
<!-- codex-conductor:end -->
