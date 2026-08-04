# Water Compact Source-Anchor Companion Dataset

This package links the 189 Cambodia, Sierra Leone, and Jamaica reform-action candidates to the exact official PDF files used for review. It supports both text-based citation display and coordinate-based PDF highlighting.

## Release summary

- Candidates: 189
- Source anchors: 272
- Anchor rectangles: 1,572
- Candidate relationships: 65
- Unresolved candidates: 0
- Primary-anchor confidence: 154 High, 33 Medium, 2 Low
- Human review status: all records begin as `Pending human review`

The 272 anchors comprise 189 candidate evidence anchors, 13 extra context anchors for aggregated passages, 45 aspiration anchors, and 25 linked explicit-mechanism anchors.

## Package contents

- `Water_Compact_Source_Anchor_Companion.xlsx`: review-oriented workbook.
- `source_anchor_companion.json`: nested, complete interchange file.
- `documents.csv`: fixed PDF registry, version metadata, URLs, hashes, and page counts.
- `candidates.csv`: the 189 reform-action candidate records and all 24 methodology variables.
- `source_anchors.csv`: verbatim PDF-token quotations, pages, match metadata, and review fields.
- `anchor_rectangles.csv`: one or more rectangles for each anchor, in PDF points and normalized coordinates.
- `item_relationships.csv`: aspiration-to-mechanism, consolidation, and other candidate links.
- `unresolved_anchors.csv`: empty by design in this release but retained as a stable import table.
- `schema_postgres.sql`: normalized PostgreSQL schema plus review-history tables.
- `source_anchor_data_dictionary.md`: field definitions and controlled values.
- `validation_summary.json`: machine-readable integrity checks.
- `qa_overlays/`: visual samples for weak, manually disambiguated, and dense-table matches.
- `documents/`: the exact three official PDFs whose SHA-256 hashes appear in `documents.csv`.

## Recommended import order

1. Run `schema_postgres.sql`.
2. Import `documents.csv`.
3. Import `candidates.csv`.
4. Import `source_anchors.csv`.
5. Import `anchor_rectangles.csv`.
6. Import `item_relationships.csv`.
7. Import `unresolved_anchors.csv`.

The JSON file can instead be loaded in one transaction and inserted in the same order.

## PDF rendering contract

The source references use one-indexed physical PDF pages. Rectangles use a top-left origin. For a rendered page with display width `W` and height `H`:

```js
const left = rectangle.x0_normalized * W;
const top = rectangle.y0_normalized * H;
const width = (rectangle.x1_normalized - rectangle.x0_normalized) * W;
const height = (rectangle.y1_normalized - rectangle.y0_normalized) * H;
```

Render every rectangle associated with the selected anchor. Do not assume an anchor has only one rectangle or that a quotation is a single visual line.

Before displaying highlights, verify that the loaded PDF's SHA-256 equals `documents.sha256`. If it differs, disable geometry highlights and show a document-version warning; text quotations can remain visible but must not be treated as coordinates for the different file.

## Review workflow

1. A reviewer opens a candidate and its primary or exclusion evidence.
2. The app displays the verbatim source text and all highlight rectangles on the matched page.
3. For reform aspirations, show the `Aspiration` anchor beside any `Explicit Mechanism` anchor and the relationship record.
4. The reviewer accepts, corrects, or rejects the anchor before making a final candidate inclusion decision.
5. Store reviewer events in `anchor_reviews` and `candidate_reviews`; do not overwrite the extracted evidence history.

The two Low primary anchors are deliberate review flags: `CAM-035` is an exact but short table phrase, while `JAM-036` is a page-range aggregate supported by three separate context anchors. Neither is unresolved.

## Evidence integrity rules

- Stored quotations are assembled only from tokens extracted from the fixed PDFs.
- Locator hints are used only to find PDF tokens; hint text is never stored unless the PDF matcher finds those tokens.
- `quote_sha256` protects the stored verbatim quotation.
- Text offsets are populated only for a single contiguous visual line. Multi-line/table spans use `page_char_spans_json` plus rectangles.
- Automated confidence estimates anchor-location quality, not whether the candidate is substantively a reform action.

