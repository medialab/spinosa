# Gateway Limits

Free `opencode` gateway (`nemotron-3.5-lightning-free` and other `-free` models) enforces an idle timeout of ~60-90s.

If the model thinks for longer without emitting tokens (large cohort batch, 100k+ context, `Thought: 1m58s`), the gateway returns `504 Upstream idle timeout exceeded` → `Streaming response failed` in the TUI.

Paid gateways (`anthropic/claude-3-5-sonnet`, `openai/gpt-4o`, `opencode` paid) allow 300-600s and stream `reasoning` tokens, so idle never hits zero.

## Mitigation

* Split mapper batches to 1-2 `raw/Markdowns/...` per turn (keep input+cache <100k) or use paid model for large cohorts.
* The retry policy now retries `504`/`upstream idle timeout`/`gateway timeout` with backoff (2s,4s,8s, max 30s) and logs to `~/.spinosa/logs/spinosa.log`.
* `spinosa doctor` warns when free gateway + large context detected.

See `startup-prompt.md:99` batch sizing and `.agents/skills/spinosa-mapper/SKILL.md:5` token cap.
