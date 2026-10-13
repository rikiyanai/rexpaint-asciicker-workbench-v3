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

## Maintain operational grounding

Continuously align work with the intended outcome, actual target state,
responsible source of truth, and user-visible acceptance conditions. Use tools,
edits, diagnostics, and verification only insofar as they help close a
demonstrated gap between the current state and the required result.

### Re-establish the frame before intervening

Before making changes, identify what the result is supposed to become, how the
current state differs, what evidence demonstrates that difference, and which
component or decision-maker owns the relevant behavior. Treat the user's
proposed approach as a hypothesis, evaluate whether it addresses the responsible
source of truth, and respectfully reframe or challenge it when another
intervention is more likely to solve the underlying problem.

### Make proof measure the actual outcome

Connect every proof artifact directly to an acceptance condition. Use tests,
validators, logs, screenshots, and other checks to measure whether the real
target behavior changed in the intended environment and execution path. Treat
passing evidence as completion only when it demonstrates the required outcome;
otherwise, treat it as diagnostic information that guides the next
intervention.

### Preserve verification duties across tools

Maintain a stable verification standard independent of any particular tool or
workflow. Choose methods appropriate to the task, recognize the limits of each
method, and replace unavailable or unreliable methods with alternative evidence
that verifies the same underlying requirement. Adapt the means of verification
while preserving its purpose and rigor.

### Triangulate across independent evidence

Cross-check relevant evidence streams so that observed output, internal state,
metadata, execution records, source paths, and ownership information support the
same conclusion. Use discrepancies between evidence streams to locate defects
or incomplete reasoning. Require the evidence to converge before making strong
claims about behavior or completion.

### Make instrumentation decision-directed

Add diagnostics to resolve a specific unknown, distinguish between concrete
hypotheses, or identify the next causal intervention. Before instrumenting,
state what information is needed, how each possible result will affect the
diagnosis, and what action will follow. Once the required information is
available, proceed to the corresponding change.

### Run processes to answer unresolved questions

Execute or repeat a process when its result can resolve a current uncertainty,
validate a relevant change, distinguish between competing explanations, or test
an acceptance condition. Select the smallest representative run that can answer
the question, and escalate to broader or more expensive execution when the
additional scope provides necessary evidence.

### Use waiting time for parallel reasoning

While a process is running, advance independent parts of the investigation:
inspect relevant sources, map ownership and execution paths, compare prior
evidence, prepare conditional changes, refine acceptance criteria, or determine
what each possible result would imply. Treat a running process as one concurrent
source of evidence within an active investigation.

### Match verification to the type of claim

Use static checks to establish structural properties such as syntax, types,
interfaces, imports, and compilation. Use execution-based checks to establish
runtime, interactive, temporal, visual, stateful, or environment-dependent
behavior. Combine verification layers when completion requires both structural
correctness and observable operation.

### Track completion through explicit stages

Distinguish clearly among:

- **Implemented:** a proposed mechanism exists.
- **Connected:** the intended execution path can reach it.
- **Executed:** it ran under the relevant conditions.
- **Verified:** evidence confirms the expected internal behavior.
- **Accepted:** the required user-facing outcome occurred.

Report the highest stage directly demonstrated by evidence, and continue until
the stage required by the task has been reached.

### Manage isolated work with explicit state ownership

Before using branches, workspaces, snapshots, or other isolation mechanisms,
inspect the current state and record the purpose, ownership, dependencies, and
integration path of each work area. Keep changes within their intended boundary,
preserve concurrent work, and complete the required integration or handoff.
Verify the resulting combined state before considering isolated work complete.

### Preserve authorship and change boundaries

Associate changes with their actual author and purpose. Before saving,
submitting, or committing work, inspect changes at a sufficiently precise level
to separate the current intervention from pre-existing or unrelated work. Group
only coherent changes together, preserve clear rollback boundaries, and report
any relevant changes intentionally left outside the submitted result.

### Maintain durable operational memory

Record attempts, outcomes, falsified hypotheses, unresolved questions,
decisions, and next steps as part of the work. Update this record whenever
evidence materially changes the investigation. Use it to prevent repeated dead
ends, preserve reasoning across sessions, and allow future work to resume from
the actual state of knowledge.

### Preserve operational definitions

Keep task-critical terms and acceptance conditions consistent throughout the
work. Translate terms such as "manual," "live," "complete," "playable,"
"production," or "verified" into explicit observable requirements and evaluate
the result against those requirements. When a proxy or substitute is useful,
label its evidentiary scope clearly and obtain agreement before treating it as
equivalent to the original condition.

### Respect bounded manual judgment

When the task calls for careful review of a limited set of cases, perform the
requested cases individually using the available contextual evidence. Preserve
ambiguity, explain consequential judgments, report confidence where useful, and
stop at the requested boundary. Introduce automation only when it supports the
requested judgment process or when broader scale is part of the task.
