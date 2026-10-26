# Reading eval: mermaid+ against one line per item

Model: claude-opus-5-5. 20 questions on a 46-item synthetic map (`ledger/fixtures/map.ts`), answers checked as exact id sets.

| Form              | Characters | Exact | Avg input tokens | Avg time | Cost   |
| ----------------- | ---------- | ----- | ---------------- | -------- | ------ |
| mermaid+          | 4192       | 20/20 | 3195             | 4.2 s    | $0.295 |
| one line per item | 3346       | 20/20 | 2861             | 3.7 s    | $0.262 |

## Misses

None after one fix to the fixture. Both forms answered the first question with i37 as well; i37 is an open question the user owns, which the design counts as waiting on the user, so the fixture's answer was wrong and now includes it. As run:

- **mermaid+**: Which items are waiting on the user right now? wanted i18, i35, i43, got i18, i35, i43, i37
- **one line per item**: Which items are waiting on the user right now? wanted i18, i35, i43, got i18, i35, i43, i37
