# Review output experiment

Issue #95 tracks a comparison of legacy and opt-in output. The experiment uses a fixed synthetic review and mocked OpenAI and Anthropic responses. Run the matrix with `REBUT_PRINT_OUTPUT_MATRIX=1 npm test -- tests/review-output.test.ts -t 'compares one fixture' --silent=false`.

## Staged selection

In the experiment, passing one or more `--criterion-id ID` options to `rebut collect` selects output v2. `--output-schema 2` makes that choice explicit. Collecting without criterion IDs defaults to the legacy output. `--output-schema 1` also selects legacy output and requires omitting the criterion flags. Submit extended bundles to a backend that supports them.

The intended default for newly collected bundles is v2 once live provider validation, older Worker compatibility, and scripts that expect legacy output have been addressed. The default-v2 design needs to allow reviews with no criterion IDs and return empty coverage for them. The output selection in an existing bundle remains pinned to its hash and request ID.

## Mock comparison

The table in the draft PR separates posted request bytes, mock response envelope bytes for a completed review, returned review bytes, and estimated reservations. The truncation case injects a 9,000-token demand independent of the fixture size. Its response status is fixed by the fixture. Both providers use the same mock rates of $0.50 per million input tokens and $2.50 per million output tokens. Reservation accounting uses request bytes plus 4,096 as a conservative input-token estimate. Actual token consumption and provider schema acceptance require a live experiment. Deployed token limits are tracked in #81.

## Validation boundary

The extended handler validates shape, supplied criterion IDs, and whether each cited line range exists in the supplied material. An `assessed` row needs a direct citation or a linked finding with a grounded location. The handler keeps the model's valid references and citations, including repetitions within a single row or finding. It rejects duplicate criterion rows and fills missing rows with `unassessed`.

A reproduction suggestion is model-generated text. The parser accepts validly shaped text even if it claims a command was run. A finding linked to a compound criterion can concern just one part, even when the model returns `assessed`. The caller verifies execution claims and decides whether the evidence supports the whole criterion. The fixtures exercise both cases.
