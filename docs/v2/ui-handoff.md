# Signals UI handoff: build the screens to match the prototype

For Codex, from Coris. This document sits alongside the Stage 2 build brief (`codex-stage2-build-brief.md`) and does not replace it. The brief says **what** each phase does. This document says **how each screen should look and behave**.

**Reference prototype:** `docs/v2/prototype.html` in the main checkout. Open it in a browser. It is the same file as https://claude.ai/artifact/S6Lstut8F7jhZEzUPRHf6a. The switch at the top right flips between the super admin view and the client view, and every control in it is clickable. All the data in it is made up.

## Ground rules

1. **Keep the app's current look.** That means the paper background, navy and coral, DM Sans and DM Mono, and the existing `frame.tsx` shell. The prototype uses the same palette, so what to copy from it is the layout, the controls and the copy, not the CSS.
2. **Structured inputs, never free text, for anything the system filters on.** Coris raised this specifically. Industries, locations and job titles are chips. Revenue and headcount are from–to dropdowns. Keywords are chips with a syntax preview. A textarea is only for prose the AI reads: "Who", "Relevant moment", "Conversation to open" and the example messages.
3. **Enter adds and comma splits.** Every chip input adds on Enter, splits pasted text on commas or new lines, ignores duplicates, and removes a chip on ×.
4. **Everything you can add, you can also edit and delete,** in place. Signal rules, extra sources, named companies and people all work this way.
5. **Autosave stays.** Keep the "Saved" pattern already built. The prototype's "Save and continue" just moves to the next step.
6. **Mobile at 390px with no sideways scroll.** Tables scroll inside their own box. The side nav turns into a horizontal strip.
7. **Do the catch-up items (section A) before you start Phase 5.** They are small and touch screens Phase 5 builds on.

---

## A. Catch-up: screens already built that differ from the prototype

### A1. Client setup becomes a 7-step stepper (Phase 2 screen)
- **Now:** one long page with "01 Client details / 02 ICP profiles" and a note that further setup follows in later phases.
- **Prototype:** a left step list with the seven steps (Client details, ICP profiles, Signals, Sources, Voice and copy, Who gets what, Test and go live). Done steps show ✓, the current step is highlighted, and every step can be clicked. Under 900px wide the step list becomes a horizontal strip.
- Show steps 3 to 7 now as disabled entries labelled "Coming in Phase N", so the structure exists from the start.
- **Team** moves out of the client details page and into step 6, "Who gets what" (see B4).

### A2. ICP profile form (Phase 2)
- **Profile switcher:** tabs, each with a mono code and a name (e.g. `01B Established growth brands`), plus "+ Add" at the end. Keep the plan limit message, shown inline beside "+ Add".
- **Profile code:** add a short `code` field (01A, 01B, 02...). It is shown everywhere a card or rule names a profile.
- **Type:** three chips (Cold outbound, Introducer, Partner) instead of a select.
- **Priority job titles:** chips. Add on Enter.
- **Industries:** chips, chosen from the data provider's industry list with typeahead. Each one must map to a real filter value at the provider that Phase 4 uses (blitzapi). Free text that doesn't map is not accepted. Show the hint "Picked from the data provider's industry list, so each one is a real search filter."
- **Locations:** chips with typeahead covering countries, US states and metro areas. They map to provider location values the same way. Leaving it empty means anywhere.
- **Revenue:** two dropdowns, from and to, using these steps: Any, $1m, $5m, $10m, $20m, $50m, $100m, $250m, $500m, $1bn, $5bn, $10bn+. The values are stored in USD. Remove the free-number boxes and the currency box. Show a warning if "to" is below "from".
- **Headcount:** two dropdowns using these steps: Any, 1, 10, 50, 100, 250, 500, 1,000, 5,000, 10,000+. "Any to Any" ignores headcount.
- **Company types:** drop this field unless Phase 4 discovery actually filters on it. If it does, make it chips like industries.
- **Named companies:** "Also watch these companies or brands". This is a chip input that takes real names or websites, one at a time or pasted with commas. The hint reads "A parent group pulls in its brands. Optional." Replace the "Add named company" button with this input.
- **Relevant moment and Conversation to open:** keep as textareas, side by side on desktop. Hints: "Used to score how relevant each signal is." and "Guides the tone and ask of the openers."
- Fix the placeholder text "A draft saved when this tab closes", which is showing inside "Conversation to open".
- **Watch-list size and "When no person is found":** keep both, below the textareas.
- **Match preview panel at the bottom of the profile (links Phase 4 into setup):** a coral-tinted box with a "Find matches" button.
  - After a search it shows "N companies and about M people match 01B", three sample companies, and "Watching the top N, refreshed weekly. Estimated $X a month in data costs."
  - It links to the full "Find matches" page for approval.
  - Keep the existing estimate-then-approve gate. This box can show the estimate step.

### A3. Find matches page (Phase 4)
- The page does what it should; the polish is all on how it looks and what it says.
  - Replace the large native blue checkboxes with the app's own small checkbox style, or with toggle chips.
  - Show real company detail in the Company table: industry, revenue band, headcount band and city.
  - Group the saved watch list by company, with its people nested underneath, instead of listing every company twice.
  - Put the profile tabs at the top, using the same tab style as A2.
- The cost and estimate text is good. Keep it.

### A4. Clients list (Phase 1 and 3)
- **Now:** a hero heading plus a table with client, status and timezone. "Create a client" and "Invite a team member" forms sit on the same page.
- **Prototype:**
  - Header: "Clients" with "+ New client" at the top right.
  - Four stat tiles: Live clients, Cards yesterday, Used last 7 days, Spend this month vs total budgets. The figures fill in as later phases produce them; until then show "–".
  - Table columns: Client, Status pill, Profiles, Companies watched, Cards yesterday, Used 7 days, Budget left (with a meter bar that turns coral under 15%), Last run. Clicking a row opens the client overview.
- "Create a client" moves behind "+ New client", which opens step 1 of setup. "Invite a team member" moves to setup step 6.

### A5. Client overview page (new, small)
- This is the prototype's "Before: Work" screen, at `clients/[id]`, with setup moving to `clients/[id]/setup`.
  - Header: client name, sub-line (type, number of profiles, number of users, status pill), and two buttons, "View as client" and "Edit setup".
  - Three tiles: Budget this month (used and renewal date), Companies watched, Morning list time.
  - Profiles table: code and name, type, who, titles, watching (companies · people), and sent to (user first names). Clicking a row opens that profile in setup.

### A6. Side nav (super admin)
- Change to: Clients, the name of the selected client, Setup, Runs and costs, Budgets.
- Keep "Today" only in the client role's nav.

---

## B. Remaining phases: the screen each one must produce

### B1. Phase 5, setup step 3: Signals
- A list of rule rows. Each row has:
  - a toggle
  - the name, with a one-line description underneath
  - keyword spans, if the rule has keywords
  - a "Profiles: All / 01A, 01B" line
  - a pill showing Positive (green), Neutral (grey) or Negative (amber)
  - Edit and Delete links
- **Edit** opens the row in place as a form with a coral border. It has:
  - Name.
  - Type, as a select: Positive, Neutral, or "Negative (handled gently)".
  - "What counts", a one-sentence description, with the hint "The AI judge reads this."
  - Keywords as chips. Quotes mean an exact phrase and show in green. A leading minus excludes the word and shows in red with strikethrough. Hint: "Press Enter to add. Commas add several at once."
  - "Applies to", as profile-code chips.
  - Save and Cancel buttons.
- "+ Add signal" opens the same form, empty.
- Seed each new client with the defaults from the prototype: Campaign launch, New marketing leader, Agency review or search, Product launch or expansion, Investment, Client win or scope increase, Award or shortlist, Layoffs or restructure (negative, on), and Lost a major client (negative, off). Each has the profile scope shown in the prototype.

### B2. Phase 5, setup step 4: Sources
- One row per source type: a toggle, the name and description, and a freshness select (24h, 48h, 72h, 7d, 14d). The defaults are in the prototype. Above the rows, the hint "Anything older than the window, or with no visible date, is dropped before AI reads it."
- **Extra sources for this client:**
  - Each one is its own row showing the URL, with a Remove link.
  - Below them is an input for pasting one or more URLs separated by commas or spaces, plus an Add button. Enter also adds.
  - On adding, toast "N sources added and being checked". Then check each one for a feed or news page with visible publish dates, and show the result on its row ("OK" or "no dates found").
- Which sources ship by default is waiting on the sourcing test, so seed them from config, not from code.

### B3. Phase 5, setup step 5: Voice and copy
- "Write openers for" chips: Email and LinkedIn.
- A sign-off field.
- "Real example messages", a textarea for 3 to 10 examples. The hint must say: "These teach tone, length and phrasing. Nothing is copied or picked from this list: every opener is written fresh from its signal, in this style."
- "Never say", as chips.
- LinkedIn length, a select (280 or 200 characters).

### B4. Phase 5, setup step 6: Who gets what
- A table with one row per person:
  - name and email, with "invite sent" if they haven't accepted
  - role, a select (Client admin or Salesperson)
  - profile-code chips that toggle which profiles' cards they receive
  - morning email time, a select (Off, 07:00, 07:30, 08:00, 08:30) in the client's time zone
  - Remove
- "+ Invite person" adds an inline row with name, email and role, and an "Add and invite" button. It sends the real invite, using the existing invite flow, and the row then shows "invite sent".
- Hint: "Each person sees only the cards from the profiles switched on in their row, in the app and in their morning email."

### B5. Phase 7, setup step 7: Test and go live
- **Intro line:** "Runs once over the last 48 hours with the current setup. Nothing is sent to the client until you go live."
- **Run test button:** navy. It runs the full pipeline once within the budget gate, showing a spinner and "Collecting from N sources across N profiles…" while it works.
- **Results:**
  - Four tiles: Items collected, Fresh and not duplicate, Usable cards (score 7 or more), and Test cost.
  - A "Dropped because" table with counts for: Older than the window or no date, Duplicate of another report, Didn't match a profile, and Matched but scored below 7.
  - Then a "Review the N sample cards" button, which opens the cards exactly as they will appear in Today, and a coral "Go live" button.
- **After going live:** the button turns into a pill reading "Live · first list tomorrow 07:30". The status pill updates everywhere: on the clients list, the overview, and the setup header.

### B6. Phase 3 and 6: Runs and costs, and Budgets
- **Runs and costs:** one table covering this morning's collection for all clients.
  - Columns: Client, Source, Items, Fresh, Usable, Cost, Per usable card, Status.
  - Status is a green "Done" pill, or an amber "Failed · retry" pill with a retry action.
- **Budgets:** one table, one row per client.
  - Columns: Client, Period, Budget, Used, a meter bar (coral above 85%), Left, Renews, Per usable card.
  - Each row has a "Renew or top up" button.
  - Note under the table: "When a budget runs out, collection pauses and the client's list says 'Paused until your budget renews'."
  - The existing Phase 3 budget screen can stay as the per-client detail page that a row opens.

### B7. Phase 8: Today (client view)
- **Header:** "Today", with the sub-line "Thursday 15 October · N people worth reaching out to". The nav shows the number of open cards.
- **Layout:** a 220px filter column on the left (it stacks above the cards on mobile), with the card list on the right.
- **Filters:**
  - Profile chips: All, 01A, 01B...
  - Type chips: All, Positive, Sensitive.
  - A "This week: N marked sent" tile.
- **Each card shows:**
  - An avatar with initials, then "**Name** · Title", with company · meta line underneath (industry, size, city).
  - Pills on the right: the profile code (navy, mono, with the profile's name on hover), and the signal type. Negative signals show as "Sensitive" in amber.
  - "What happened": one sentence at 15px.
  - The source line: source name · how old it is, an "Open source" link (coral), and "Also in X" when another source reported the same event.
  - A box on a paper background: "**Why this person:** …" tying the event to the profile's relevant moment.
  - Opener tabs for LinkedIn and Email. The LinkedIn tab shows a live character count on the right. The text sits in a copy box.
  - Actions:
    - **Copy:** coral button. It copies the opener and toasts "Copied". If the clipboard is blocked, it selects the text instead.
    - **Open LinkedIn:** opens the person's profile.
    - **Rewrite:** cycles to the alternative version of the opener.
    - **Mark sent:** hides the card, moves it to history, and toasts "They won't reappear for 30 days".
    - **Not relevant:** opens an inline "Why isn't it relevant?" row with reason chips (Wrong person, Wrong company, Old news, Weak reason, Already in touch) and Cancel. The chosen reason is saved as feedback and the card is hidden.
- **Negative cards:** the opener must only acknowledge the news. The prototype's Lumen card shows the expected tone.
- **Empty states:**
  - Keep the current "A good reason is worth waiting for." copy for a day with no cards.
  - When every card has been handled, show "You're all caught up. Next list tomorrow at 07:30. The system never pads the list with weak or old signals."

### B8. Phase 8: Sent and history
- A table with columns Person (with company underneath), Signal, Outcome, and an action.
  - Sent rows show a green "Sent" pill and a "Mark replied" button.
  - Dismissed rows show "Not relevant · reason" and a "Restore" button.
- **Empty state:** "Nothing yet. Mark a card sent or not relevant on Today and it will show here."
- Add a "Download CSV" button. This is from the brief, not the prototype.

### B9. Phase 9: Morning email
- The preview is the prototype's "Morning email" view.
  - From: "Signals for Before: Work". Subject: "N reasons to reach out today".
  - The greeting reads: "Morning Jordan, N people in your profiles did something worth noticing since yesterday."
  - One row per card: **Name**, company, the one-line event underneath, and the signal pill on the right.
  - A coral "Open today's list" button that links to Today.
- It includes only the profiles switched on for that person in step 6.
- Use a single column, at most 600px wide, with inline styles that render correctly in Gmail and Outlook.

---

## C. How to check each screen

For each phase, add a screenshot of the new screen next to the matching prototype view in the phase's `docs/signals-phase-N/` folder: one desktop at 1280px and one mobile at 390px. In the phase README, list any place where it differs from the prototype and say why.
