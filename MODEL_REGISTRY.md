# Model Registry — Growth

Last verified 2026-09-13: Groq (both keys) and Gemini (both keys) confirmed live with real
API calls. `gemini-2.0-flash` is retired server-side (404) — never reintroduce it.

## Governing rule

**Growth never uses OpenAI or Anthropic — not as primary, not as fallback, not as a rescue
tier, under any condition.** This is an explicit product constraint, not a cost optimization
that could be relaxed. Every one of the ~27 AI call sites in this product goes through the
single shim in `lib/ai/claude.ts` (exported as `anthropic` for call-site compatibility — it
never touches the Anthropic API), so this constraint is enforced in one place, structurally,
rather than per call site.

## Chain (all rows, all environments)

| Tier | Primary | FB1 | FB2 |
|---|---|---|---|
| BULK / cheap (`CLAUDE_MODELS.default` / `.cheap`) | Groq `openai/gpt-oss-20b` | Gemini `gemini-flash-lite-latest` | Groq `llama-3.1-8b-instant` |
| WRITING / HIGH_INTENT / premium (`CLAUDE_MODELS.premium`) | Groq `openai/gpt-oss-120b` | Gemini `gemini-3.6-flash` | Groq `llama-3.3-70b-versatile` |

FB2 is always a different *model family* from the primary (Llama, not gpt-oss) — a bad
gpt-oss rollout on Groq is a different failure mode from a Groq outage, and this chain
survives both. FB1 (Gemini) is a different *vendor* from both Groq tiers, so a Groq account
issue (expired key, exhausted quota — the exact failure that silently starved the funnel on
2026-07-09) doesn't take the whole product down with it.

## Circuit breaker

`lib/ai/claude.ts` tracks per-provider health (`groq`, `gemini`, `groq-rescue`) and opens a
cooldown on failure — 15 min for a "hard" error (billing/auth/quota, matched by a regex
against the error message), 5 min for anything else — so a dead provider isn't re-hammered on
every job. One alert (Telegram + email) fires per outage window per provider, not per failed
call — see `providerDownAlert`.

## Env vars this registry depends on

`GROQ_API_KEY` + `GROQ_API_KEY_2` (rotation), `GEMINI_API_KEY` + `GEMINI_API_KEY_2`
(rotation), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `AI_ALERT_EMAIL` (or
`MODEL_ALERT_EMAIL`), `AI_ALERT_FROM`, `RESEND_API_KEY`. `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` may still be present in the environment (e.g. left over from before this
fix) but are never read by the AI chain — nothing in `lib/ai/` references them post-fix.
