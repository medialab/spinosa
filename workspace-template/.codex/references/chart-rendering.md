# Chart Rendering Reference

Canonical reference for Unicode chart types used by `spinosa-writer` and `spinosa-serendippo`. Every quantitative chart should come from `spinosa_figure`. Output uses only Unicode characters in markdown fenced code blocks — no HTML, no SVG, no images.

## Common Settings

```
full_width     = 52 characters
narrow_width   = 28 characters
bar_filled     = █  (dense)
bar_three_qtr  = ▓  (three-quarters)
bar_half       = ▒  (half)
bar_empty      = ░  (empty / background)

top_border     = ┌─ Title ─ padded or truncated ────────────────────┐
bottom_border  = └──────────────────────────────────────────────────┘
side_border    = │
plot_left      = ┤  (y-axis tick into plot area)
plot_bottom    = └──┴──┴──┴──┴──┴──┴──┴──┴──   (x-axis)
```

- Title inside top border: truncated or center-padded to fit `full_width - 4`.
- Labels left-aligned; values right-aligned inside the border.
- When total is 0 or unknown: show all-empty bar with `?` annotation.

## Chart Selection Matrix

| Task                          | Question                          | First choice           | Alternative              |
|-------------------------------|-----------------------------------|------------------------|--------------------------|
| Compare categories            | Which is larger or smaller?       | Horizontal Bar         | Dot Plot                 |
| Rank                          | What is the order?                | Sorted Bar             | —                        |
| Trend over time               | How did it change?                | Multi-Line / Sparkline | —                        |
| Connected trend               | How did it change with lines?     | Line Chart             | Sparkline                |
| Distribution                  | What is the spread?               | Histogram              | Box Plot, Density        |
| Relationship                  | Are these related?                | Scatter (braille)      | Heatmap Row              |
| Part-to-whole                 | What is the share?                | Stacked Bar            | —                        |
| Before / after                | What changed?                     | Slope Chart            | Diverging Bar            |
| Single metric                 | How are we doing?                 | Gauge                  | Progress Bar             |
| Deviation                     | Above or below target?            | Diverging Bar          | —                        |
| Composition                   | How is this broken down?          | Stacked Bar            | Grouped Bar              |
| Exact values                  | What are the numbers?             | Table + Dot Plot       | —                        |
| Multi-var health              | What is the status?               | Status Matrix          | Heatmap Row              |
| Continuous density            | What is the shape?                | Density (braille)      | Histogram                |
| Matrix pattern detection      | How does this look across 2D?     | Full Matrix Heatmap    | Scatter (braille)        |
| Overlapping profiles          | How do these compare vertically?  | Ridge Plot             | Density (braille)        |
| Compact category comparison   | Which is larger (vertical)?       | Vertical Bar           | Horizontal Bar           |
| Distributions by group        | How do these compare per bin?     | Categorical Histogram  | Grouped Bar              |

## Design Principles

These rules apply to every chart produced by any agent in the pipeline.

### Task first
State the one-sentence question the chart answers before choosing a chart type. Match the chart family to the task, not to aesthetic preference.

### One chart, one relationship
If the data answers two different questions, produce two charts.

### Honest baselines
Bars and filled areas encoding magnitude MUST start at zero. No cropped baselines. Dual axes require written justification.

### Position and length for precision
When readers compare magnitudes, default to aligned position on a common scale. Avoid angle, area, and volume for precise quantitative judgments.

### Semantic channel matching
Ordered data gets ordered channels (position, length, sequential shade). Nominal data gets unordered channels (different character types, shapes).

### Accessible by design
Every chart carries a text description after the code block. No information conveyed by shade or character-type differences alone — use position and labels as redundancy.

### Disclose sources and transformations
Footer includes source, units, date, and a note on normalization, smoothing, or exclusions applied.

### Chart budget
No chart when a sentence is enough. Normally one figure per section. Two figures maximum per section.

### Validate the rendered output
Read the final rendered chart against source data. Check bar lengths, braille dot counts, sparkline min/max, label clipping, zero baseline.

## Chart Type Specifications

### 1. Horizontal Bar Chart

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Compare precise values across categories using length         |
| **Task**     | Compare categories, exact lookup                              |
| **Chars**    | `▓` filled, `░` empty                                         |
| **Zero**     | Baseline at column 0 — visible by the left border             |

**Formula:**
```
max_bar = full_width - 18
filled  = round((value / max_value) * max_bar)
empty   = max_bar - filled
```

**Rendering:**
```
┌─ Revenue by Product (Q2 2026) ─────────────────────────────────────┐
│ Product A ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  $12.4M                │
│ Product B ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  $10.2M                │
│ Product C ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  $7.8M                 │
│ Product D ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  $7.1M                 │
│ Product E ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  $6.0M                 │
│ Product F ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░  $4.5M                 │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when categories > 20 (switch to Dot Plot).

**Validate:** longest bar equals max_value proportion. All values >= 0. Zero line visible at left edge.

---

### 2. Sorted Bar Chart

Same formula as Horizontal Bar; data sorted descending by value.

**Rendering:**
```
┌─ Top 10 Countries by Population (2025) ────────────────────────────┐
│ India      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  1,450M       │
│ China      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  1,420M       │
│ USA        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░   345M        │
│ Indonesia  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░   280M        │
│ Pakistan   ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░   240M        │
│ Nigeria    ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   225M        │
│ Brazil     ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   215M        │
│ Bangladesh ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   170M        │
│ Russia     ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   145M        │
│ Mexico     ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   130M        │
└────────────────────────────────────────────────────────────────────┘
```

**Validate:** order matches data sort. Longest bar is first item.

---

### 3. Grouped Bar Chart

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Compare values across two dimensions (category + series)       |
| **Task**     | Multi-series category comparison                              |
| **Chars**    | `█▓▒░` (one per series)                                       |

**Formula:**
```
max_bar     = full_width - 20
series_n    = number of series
group_width = round(max_bar / series_n)
For each series in category:
  filled = round((series_value / max_value) * group_width)
```

**Rendering:**
```
┌─ Revenue by Quarter and Product ───────────────────────────────────┐
│ Q1   Product A  ██████████████████████████████  85                 │
│      Product B  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░  60                 │
│ Q2   Product A  ████████████████████████████████████████  110     │
│      Product B  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  82            │
│ Q3   Product A  ██████████████████████████████████████████  125   │
│      Product B  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  90          │
│ Q4   Product A  ████████████████████████████████████████  115     │
│      Product B  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  86             │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when series > 4. When categories > 10.

**Validate:** each series uses distinct character. Series legend in description.

---

### 4. Sparkline

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Compact single-series trend                                    |
| **Task**     | Trend over time (compact)                                      |
| **Chars**    | `▁▂▃▄▅▆▇█` (8 vertical eighths)                                |

**Formula:**
```
normalized = round((value - min) / (max - min) * 7)
char       = "▁▂▃▄▅▆▇█"[normalized]
```

**Rendering:**
```
┌─ Daily Active Users (June 2026) ───────────────────────────────────┐
│ Total  ▂▃▃▄▅▆▇██▇▆▅▄▃▂▃▄▅▆▇██▇▆▅▄▄▃▂▂  1.2K → 2.1K              │
└────────────────────────────────────────────────────────────────────┘
```

**Validate:** first and last character match start / end data. Min maps to `▁`, max maps to `█`.

---

### 5. Multi-Line Chart

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Compare multiple trends across the same time axis             |
| **Task**     | Multi-series trend                                            |
| **Chars**    | `▁▂▃▄▅▆▇█` per series + endpoint labels                        |

**Formula:**
```
For each series:
  normalize independently (share x-axis, scale y per series)
  sparkline = sparkline_formula(series_values)
  label     = "series_name  sparkline  start→end"
```

**Rendering:**
```
┌─ Active Users by Platform (Monthly) ───────────────────────────────┐
│ Total  ▁▂▃▅▆██▇▅▃▂▃▅▆▇██▇▆▅▄▃▂▁  start: 1.2M  end: 2.1M          │
│ Mobile ▁▁▂▃▅▆▇█▇▆▅▆▇███▇▆▅▄▃▂▁  start: 0.8M  end: 1.5M          │
│ Web    ▂▃▃▄▅▅▆▇▇▆▅▄▃▂▂▃▄▅▆▇▇▆▅▄  start: 0.4M  end: 0.6M          │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when series > 6.

**Validate:** each sparkline independently normalized. Endpoint labels match data.

---

### 6. Scatter (Braille)

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show relationship between two quantitative variables           |
| **Task**     | Relationship, correlation, clustering                         |
| **Chars**    | Braille U+2800...U+28FF — each cell holds 2×3 dot grid         |

**Braille dot encoding:**

Each braille character represents a 2-column × 3-row grid within one monospace cell:

```
sub_row 0:  left=dot1(bit0)  right=dot4(bit3)
sub_row 1:  left=dot2(bit1)  right=dot5(bit4)
sub_row 2:  left=dot3(bit2)  right=dot6(bit5)

bit_map = [ [0, 3], [1, 4], [2, 5] ]
```

**Algorithm:**

```
Given: W braille columns, H braille rows, list of (x, y) points

1. Normalize x and y to [0, 1].
2. Initialize a 2D array cell[H][W] = 0.
3. For each (x, y):
   braille_col = min(floor(x_norm * W), W - 1)
   sub_col     = min(floor(((x_norm * W) - braille_col) * 2), 1)
   braille_row = min(floor((1 - y_norm) * H), H - 1)
   sub_row     = min(floor(((1 - y_norm) * H - braille_row) * 3), 2)
   bit         = bit_map[sub_row][sub_col]
   cell[braille_row][braille_col] |= (1 << bit)
4. Render row r: "│ Y_label ┤ " + chr(0x2800 + cell[r][c]) for c in 0..W-1
5. Render x-axis with ticks and labels
6. Enclose in box border with title
```

**Plot geometry:** The braille grid W × H gives an effective resolution of (W × 2) × (H × 3) dots. For a square plot, choose W / H ≈ 1.5 to compensate for terminal aspect ratio.

**Rendering:**
```
┌─ Income vs Education Level (simulated, n=320) ──────────────────────┐
│                                                                    │
│  80K ┤      ⡀⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿               │
│      ┤     ⡀⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿             │
│      ┤    ⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿             │
│      ┤   ⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾           │
│  60K ┤  ⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾         │
│      ┤ ⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼       │
│      ┤⠂⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼     │
│      ┤⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸   │
│  40K ┤⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰ │
│      ┤⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠│
│      ┤⠒⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀
│      ┤⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀
│  20K ┤⠓⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀⣀
│      ┤⠓⠓⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀⣀⣄
│      ┤⠓⠓⠓⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀⣀⣄⣄
│      ┤⠛⠓⠓⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀⣀⣄⣄⣈
│    0 ┤⠛⠛⠓⠓⠓⠒⠒⠒⠂⠂⠁⠁⡀⡠⢄⣀⣀⣤⣤⣤⣦⣶⣶⣶⣷⣷⣿⣿⣿⠿⠿⠾⠾⠼⠼⠸⠰⠠⢀⣀⣀⣄⣄⣈⣐
│      └───────────────────────────────────────────────────────────────────────────────
│             10K         20K         30K         40K         50K         60K
└────────────────────────────────────────────────────────────────────────────────────
```

**Validate:** check axis ranges against data min/max. Approximate count of braille dots matches point count. No axis labels collide.

---

### 7. Histogram

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show distribution of one quantitative variable                |
| **Task**     | Distribution                                                  |
| **Chars**    | `▓` filled, `░` empty                                         |

**Formula:**
```
bins = 8 to 12 (auto-select based on data count)
For each bin:
  bar_width = full_width - 14
  filled    = round((bin_count / max_bin_count) * bar_width)
```

**Rendering:**
```
┌─ Salary Distribution (n=1,200) ─────────────────────────────────────┐
│  0-20K    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░  220                          │
│ 20-40K    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  380                        │
│ 40-60K    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  310                        │
│ 60-80K    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  230                        │
│ 80-100K   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░  200                        │
│ 100-120K  ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  180                        │
│ 120-140K  ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░  160                        │
│ 140K+     ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░  140                        │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when data < 20 values (use dot plot).

**Validate:** total bar proportions match bin counts. Bin labels are non-overlapping.

---

### 8. Box Plot

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Five-number summary (min, Q1, median, Q3, max)                |
| **Task**     | Distribution, comparison across groups                        |
| **Chars**    | `─│├┤┬┴┼` box drawing + `█` median                            |

**Formula:**
```
scale = map [global_min, global_max] to bar_width chars
For each group:
  q1_pos    = round((Q1 - gmin) / (gmax - gmin) * bar_width)
  med_pos   = round((median - gmin) / (gmax - gmin) * bar_width)
  q3_pos    = round((Q3 - gmin) / (gmax - gmin) * bar_width)
```

**Rendering:**
```
┌─ Salary Distribution by Department ─────────────────────────────────┐
│ Engineering  ├──────────────────────┬───────█────────────┬─────────┤ │
│ Design       ├────────────────┬─────────█─────────────────────┬───┤ │
│ Marketing    ├─────────────────────────┬───█──────────────┬────────┤ │
│ Sales        ├──────────────────┬───────────█─────────────────┬──┤ │
│ Operations   ├──────────────────────┬─────█───────────────────────┤ │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when audience is unfamiliar with quartiles (use Histogram).

**Validate:** median inside Q1-Q3 box. Whiskers extend to min/max.

---

### 9. Slope Chart

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show change between two time periods for multiple items       |
| **Task**     | Before / after, change, delta                                 |
| **Chars**    | `╱` (up), `╲` (down), `─` (flat), `│` (vertical connector)    |

**Formula:**
```
left_col  = 22
right_col = 34
For each row:
  direction = "╱" if increase, "╲" if decrease, "─" if unchanged
```

**Rendering:**
```
┌─ Market Share Change (2024 → 2026) ─────────────────────────────────┐
│ Brand A  24% ╲                                         22%          │
│ Brand B  18% ╱                                         21%          │
│ Brand C  15% ╲                                         14%          │
│ Brand D  12% ╱                                         13%          │
│ Brand E  10% ╲                                          9%          │
│ Brand F   8% ╲                                          7%          │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when items > 15.

**Validate:** slope direction matches sign of change. Values align to columns.

---

### 10. Dot Plot

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Precise comparison across many categories                     |
| **Task**     | Exact lookup, category comparison                             |
| **Chars**    | `●` (filled dot), `│` (reference line), `○` (empty for highlight) |

**Formula:**
```
dot_col    = round((value / max_value) * plot_width)
reference  = "│" markers at intervals
```

**Rendering:**
```
┌─ GDP per Capita (Selected Countries, 2025) ─────────────────────────┐
│ Switzerland                      ●───────│───────│───────│───────│  │
│ Norway                                ●───│───────│───────│───────│  │
│ Ireland                              ●───│───────│───────│───────│  │
│ Singapore                         ●───────│───────│───────│───────│  │
│ United States                  ●──────────│───────│───────│───────│  │
│ Denmark                            ●─────│───────│───────│───────│  │
│ Netherlands                           ●──│───────│───────│───────│  │
│ Germany                                ●─│───────│───────│───────│  │
│ United Kingdom                      ●───│───────│───────│───────│  │
│ Japan                                ●──│───────│───────│───────│  │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when categories < 5 (use Horizontal Bar).

**Validate:** dot positions proportional to values. Reference lines aligned.

---

### 11. Diverging Bar

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show deviation from a midpoint (net change, sentiment, z-score) |
| **Task**     | Deviation, net change, sentiment                               |
| **Chars**    | `▓` left fill, `▒` right fill, `░` empty                       |

**Formula:**
```
bar_half      = round(full_width / 2)
max_magnitude = max(abs(values))
For each value:
  left_fill  = round(max(0, -value) / max_magnitude * bar_half)
  right_fill = round(max(0,  value) / max_magnitude * bar_half)
```

**Rendering:**
```
┌─ Net Promoter Score by Region ─────────────────────────────────────┐
│ North America  ▓▓▓▓▓▓▓░░│░░▒▒▒▒▒▒▒▒▒▒▒▒   +45                    │
│ Europe            ▓▓▓▓▓▓▓▓▓▓│░░░░░░░░░░░░   -12                   │
│ Asia-Pacific       ▓▓▓▓▓▓░░│░░▒▒▒▒▒▒▒▒▒▒   +38                    │
│ Latin America  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│░░░░░░░░░   -28                   │
│ Africa         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓│░░░░░░░░░░░   -25                   │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when no meaningful midpoint exists (use Horizontal Bar).

**Validate:** center line visible. Bar lengths proportional to magnitude.

---

### 12. Heatmap Row

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show patterns across columns in a table row with visual shading |
| **Task**     | Multi-column pattern detection                                 |
| **Chars**    | `█` (high), `▓` (med-high), `▒` (med-low), `░` (low), ` ` (missing) |

**Formula:**
```
For each value in a row:
  shade_level = round((value - min) / (max - min) * 3)
  char        = ["░", "▒", "▓", "█"][shade_level]
```

**Rendering:**
```
┌─ Regional Metric Profile ───────────────────────────────────────────┐
│ Product  Q1   Q2   Q3   Q4   Q5   Q6   Q7   Q8   Trend             │
│ North    ██   ██   ██   ▓▓   ▓▓   ▒▒   ██   ██   ██████▓▒░░      │
│ South    ▒▒   ░░   ▒▒   ██   ▓▓   ▒▒   ░░   ▒▒   ░░▒▒▓▓██▓▒      │
│ East     ██   ██   ██   ██   ██   ██   ▓▓   ██   ██████████▓░     │
│ West     ░░   ▒▒   ░░   ░░   ▒▒   ░░   ▒▒   ░░   ░░░░░░░░░░░░     │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when exact values matter (use a table). When < 3 columns.

**Validate:** shade intensity matches value magnitude. Missing values shown as space.

---

### 13. Stacked Bar

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show composition across a total                               |
| **Task**     | Part-to-whole, composition                                    |
| **Chars**    | `█▓▒░` (segment 1 through 4, darkest to lightest)             |

**Formula:**
```
For each segment:
  seg_len = round((segment_value / total) * bar_width)
bar = chars[0] * seg_1 + chars[1] * seg_2 + chars[2] * seg_3 + chars[3] * seg_4
```

**Rendering:**
```
┌─ Funding Source Breakdown (2025) ──────────────────────────────────┐
│ Total  ████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒░░░░░░░░░░        │
│        Grants:42%          Donations:28%      Earned:18%  Other   │
└────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when > 4 segments per bar.

**Validate:** segments sum to bar_width. Percentage annotations total ~100%.

---

### 14. Progress Bar

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Linear completion tracking                                     |
| **Task**     | Single completion metric                                      |
| **Chars**    | `▓` filled, `░` empty                                         |

**Formula:**
```
filled = round((completed / total) * bar_width)
empty  = bar_width - filled
```

**Rendering:**
```
┌─ Extraction Progress ───────────────────────────────────────────────┐
│ Files    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░  450/925 (48%)             │
│ Batches  ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░  12/30 completed           │
│ Status   in_progress                                                 │
└────────────────────────────────────────────────────────────────────┘
```

**Validate:** value / total matches display percentage.

---

### 15. Gauge

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Single percentage metric                                       |
| **Task**     | Single metric status                                           |
| **Chars**    | `◐◑◒◓◉` (quadrants + full) + `░` (empty background)            |

**Formula:**
```
pct   = value / total
bar   = "◐" * filled_quadrants + "◑" * partial + "░" * empty
```

**Rendering:**
```
┌─ Hygiene Score ─────────────────────────────────────────────────────┐
│ Overall  ◐◐◐◐◐◐◐◐◐◐◐◐◑░░░░░░░░  75%                               │
└────────────────────────────────────────────────────────────────────┘
```

**Validate:** percentage matches data. Level proportional.

---

### 16. Status Matrix

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Multi-dimensional health grid                                 |
| **Task**     | Multi-var status, health check                                |
| **Chars**    | `✓` (pass), `⚠` (warning), `✗` (fail), `○` (pending), `◉` (active) |

**Formula:**
```
✓ = all checks passed
⚠ = minor issues (below threshold but > 0)
✗ = failures or missing
○ = not yet checked
◉ = currently processing
```

**Rendering:**
```
┌─ Workspace Health Check ────────────────────────────────────────────┐
│ Group        Maps    Links   Fresh   Dict    Index   Valid          │
│ North        ✓       ✓       ✓       ✓       ✓       ✓             │
│ South        ✓       ✓       ⚠       ✓       ⚠       ✓             │
│ East         ✓       ✓       ✓       ✓       ✓       ✓             │
│ West         ✗       ✓       ✗       ○       ○       ✗             │
│ Central      ✓       ⚠       ✓       ✓       ✓       ✓             │
└────────────────────────────────────────────────────────────────────┘
```

**Validate:** each cell status matches data. Legend in description.

---

### 17. Density (Braille)

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show continuous distribution curve                            |
| **Task**     | Distribution shape, modality, skew                             |
| **Chars**    | Braille U+2800...U+28FF — same encoding as Scatter             |

**Algorithm:**

```
1. Compute kernel density or histogram bin counts across x range.
2. Normalize density values to [0, 1].
3. Map to braille grid (same algorithm as Scatter):
   - x-axis: variable range
   - y-axis: density estimate
```

**Rendering:**
```
┌─ Income Distribution by Region (density curve) ──────────────────────┐
│                                                                    │
│      ┤         ⢀⣀⣠⣤⣤⣴⣶⣶⣶⣶⣶⣶⣶⣴⣤⣤⣠⣀⡀                      │
│      ┤       ⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⣀                    │
│      ┤     ⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆                  │
│      ┤    ⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄                │
│      ┤  ⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀              │
│      ┤  ⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦              │
│      ┤ ⣰⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣆             │
│      ┤⣠⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⡀           │
│      └──────────────────────────────────────────────────────────────       │
│              20K         40K         60K         80K        100K          │
└────────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when audience expects exact counts (use Histogram). When data has < 50 values.

**Validate:** curve peaks align with data mode. Smooth fill without gaps.

---

### 18. Full Matrix Heatmap

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show patterns across rows and columns in a 2D matrix          |
| **Task**     | Matrix pattern detection, correlation, comparison across two dimensions |
| **Chars**    | `░` (low), `▒` (med-low), `▓` (med-high), `█` (high), ` ` (missing) |

**Formula:**
```
shade_level = round((value - min) / (max - min) * 3)  clamp to [0,3]
char = ["░", "▒", "▓", "█"][shade_level]
```

**Rendering:**
```
┌─ Exercise × Cohort Performance ────────────────────────────────────────┐
│          C1          C2          C3          C4                         │
│ E01 Start   ████████  ▓▓▓▓▓▓▓▓  ████████  ▓▓▓▓▓▓▓▓                    │
│ E02 Mental  ▓▓▓▓▓▓▓▓  ████████  ▓▓▓▓▓▓▓▓  ████████                    │
│ E03 Metaph  ████████  ████████  ████████  ████████                    │
│ E04 WeSear  ▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓  ████████  ████████                    │
└────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when data has > 30 rows (paginate first). When values are not comparable across cells.

**Validate:** shade intensity matches value. Cell count matches rows × cols. Row/col labels aligned.

---

### 19. Line Chart (Connected)

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show connected trend lines for one or two series over ordered x-axis |
| **Task**     | Connected trend, time series with connected points             |
| **Chars**    | Braille U+2800...U+28FF — interpolated dots between consecutive points |

**Formula:**
```
For each series:
  Normalize x and y to [0,1].
  Interpolate at each integer braille column between consecutive points.
  Map to braille grid using standard braille algorithm.
```

**Rendering:**
```
┌─ Revenue Over Time ────────────────────────────────────────────────────┐
│ 200 ┤          ⡠⠤⣀⣀⣀⣀⡠⠤⠤⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⡋⠉⠉⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⠉          │
│ 150 ┤       ⡠⠤⣀⣀⣀⣀⡠⠤⠤⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⡋⠉⠉⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⠉           │
│ 100 ┤    ⡠⠤⣀⣀⣀⣀⡠⠤⠤⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⡋⠉⠉⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⠉            │
│  50 ┤ ⡠⠤⣀⣀⣀⣀⡠⠤⠤⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⡋⠉⠉⠁⠋⠉⠉⡋⠉⠉⡉⠉⠉⠉             │
│     └───────────────────────────────────────────────────────────────────      │
│            0.0          1.0          2.0          3.0                          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when > 2 series (use scatter). When points are not ordered (use scatter).

**Validate:** lines connect consecutive points. Y range covers data min/max. Axis labels aligned.

---

### 20. Ridge Plot (Joy Division)

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show overlapping horizontal series stacked vertically          |
| **Task**     | Overlapping profiles, ridge comparison                        |
| **Chars**    | Braille U+2800...U+28FF — filled silhouette per series        |

**Formula:**
```
For each series s:
  Band starts at row s * (h - overlap_h)
  For each horizontal position p:
    Fraction = values[p] / max(all_values)
    Filled sub-rows = round(fraction * h * 3)
    Set appropriate braille dots for each row.
```

**Rendering:**
```
┌─ Pulsar Profiles ──────────────────────────────────────────────────────┐
│        ⣠⣴⣶⣾⣾⣿⣶⣤⡀         P1                                    │
│     ⣀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣾⣴⣠⡀                              │
│⣠⣤⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣾⣴               │
│  ⡀⣠⣴⣶⣾⣿⣿⣿⣿⣿⣿⣿⣾⣴⣠⡀          P2                      │
│⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣾⣶⣴⣤               │
│        ⡀⣠⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿     P3                        │
│⡀⣀⣀⣀⣠⣤⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿               │
└────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when > 10 series (too many overlaps). When series have different lengths.

**Validate:** each series forms a filled silhouette. Overlaps visible. Labels aligned to rows.

---

### 21. Vertical Bar Chart

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Compare values across categories using upward-growing bars    |
| **Task**     | Category comparison, compact layout when horizontal space is tight |
| **Chars**    | `▁▂▃▄▅▆▇█` (8 vertical eighths, upward-growing)              |

**Formula:**
```
bar_height = round((value / max_value) * height)
For each row r (0=top to height-1=bottom):
  if row_from_bottom < bar_height:
    char = '█' for full rows, partial block for topmost filled row
```

**Rendering:**
```
┌─ Top Categories by Frequency ──────────────────────────────────────────┐
│  94   85   75   66   48                                                │
│ ████ ▂▂▂▂                                                              │
│ ████ ████ ▃▃▃▃                                                         │
│ ████ ████ ████ ▅▅▅▅                                                    │
│ ████ ████ ████ ████ ▁▁▁▁                                               │
│ ████ ████ ████ ████ ████                                               │
│ ████ ████ ████ ████ ████                                               │
│ ████ ████ ████ ████ ████                                               │
│  A    B    C    D    E                                                  │
└────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when > 20 bars (too many for vertical layout). When values have negative numbers.

**Validate:** tallest bar equals max_value. Bar heights proportional. Labels centered under bars.

---

### 22. Categorical Histogram

| Field        | Value                                                         |
|--------------|---------------------------------------------------------------|
| **Purpose**  | Show grouped or stacked bars per bin, one series per shade    |
| **Task**     | Multi-series distribution, grouped comparison                  |
| **Chars**    | `█▓▒░` (one per series, up to 4 series)                       |

**Formula:**
```
For each bin b:
  For each series s:
    filled = round((series_s_b / global_max) * max_bar)
    Stacked: each series bar starts where previous ends
    Grouped: bars side by side within the same row
```

**Rendering:**
```
┌─ Scores by Type per Cohort ───────────────────────────────────────────┐
│ C1  Engagement ████████████████████▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 85       │
│     Reflection ████████████████████▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 62       │
│     Synthesis  ████████████████████▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░ 45       │
│ C2  Engagement ██████████████████████████████▓▓▓▓▓▓▓▓░░░░░░ 72       │
│     Reflection ██████████████████████████████▓▓▓▓▓▓▓▓░░░░░░ 78       │
│     Synthesis  ██████████████████████████████▓▓▓▓▓▓▓▓░░░░░░ 55       │
└────────────────────────────────────────────────────────────────────────┘
```

**Do NOT use:** when > 4 series (too many shades). When bins have unequal widths.

**Validate:** total bar proportions match bin counts. Each series uses distinct shade. Legend included.
