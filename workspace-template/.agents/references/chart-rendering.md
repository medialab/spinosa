# Chart Rendering

Quantitative figures must be produced by `spinosa_figure`. The tool is the
capability boundary; do not hand-render charts in Markdown.

## Supported kinds

| Kind | Use | Required data |
|---|---|---|
| `bar` | Compare named values | `items: [{ label, value }]` |
| `sparkline` | Show a short ordered trend | `values: number[]` |
| `stacked_bar` | Compare totals with segments | `items` plus `segments` |
| `status_matrix` | Show categorical status by row/column | `columns` plus `rows` |

Use the narrowest supported kind that answers the question. Include a caption,
source, and units in the figure request.

## Unsupported requests

Scatter plots, density plots, histograms, ridge plots, heatmaps, box plots,
and other kinds are not available through `spinosa_figure`. Report the data
as prose or a Markdown table, or request an explicit capability addition.
Do not substitute a hand-drawn Unicode approximation.

## Evidence rules

- State the source of every value.
- Do not imply precision that the source does not support.
- Keep zero, constant, and empty series valid; omit a figure when no useful
  quantitative comparison exists.
- Never use a figure to hide missing, truncated, or unverified evidence.
