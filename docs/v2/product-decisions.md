# Product decisions, 17 October 2026

These decisions apply to the Signals product. The sourcing experiment keeps its original rubric and settings.

## Setup and delivery

Ownership expansion isn't supported: add related brands explicitly. Watch-list refresh stays opt-in. City/metro filters are labelled keyword matches rather than exact boundaries.

Client-wide limits default to 10 cards per person per day and a 30-day repeat window. Each person's expandable Limits section can override either value independently. A collapsed summary shows the effective values and marks each custom value. Main table columns stay as in the prototype.

## Sensitive signals

Negative signals (layoffs, restructuring, lost client) use a separate score based only on company fit, person fit and a fresh, confirmed event. Score 7+ is usable. These signals reach Today and morning email only when the client's Layoffs or restructure rule is on; otherwise they remain in the admin log.

Display Sensitive in amber. At most one sensitive card per recipient per day, and it never leads the list or email. To enforce that ordering, a sensitive card with no positive/neutral card ahead of it will stay in the admin log for that delivery. Openers acknowledge the news only: no offer, pitch or ask. Follow the Lumen prototype tone.

## Rewrite

One live claude-sonnet-5-5 call per click, with the Stage 2 settings and client voice, for the open tab only. Keep every version with previous/next arrows and Version N of M. Copy and Mark sent use the visible version, and history records which version was sent.

Allow at most three rewrites per card per tab. Every call uses the budget gate and ledger. When the budget is spent, disable Rewrite with Budget used up for this month. Show a spinner in the copy box while writing. A failed call keeps the current version and shows Couldn't rewrite, try again.
