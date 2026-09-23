Prospect Signals V1 Product Specification

Build specification for the signal detection and LinkedIn outreach module inside the Prospects dashboard

| **Document** | **Details** |
| --- | --- |
| Owner | Coris Leachman |
| Version | 1.0 |
| Date | 17 September 2026 |
| Status | V1 build specification |
| Primary product | https://corisleachman.github.io/prospects/ |
| Initial user | Coris and an authorised junior researcher |
| Future users | Agency clients using separately configured workspaces |

# Purpose

This specification defines the first buildable version of the prospect signal product. The product will find recent evidence about known prospects across public sources, connect that evidence to the correct person and company, and prepare a short LinkedIn message for human review. It will also support campaign-specific audiences, signal rules and tone of voice, while keeping the existing Prospects database and researcher workflow intact.

V1 will prove that the system can produce a useful daily review queue without manufacturing weak signals or automating the final send. The same data structure must later support client workspaces without requiring a separate codebase for every client.

# Contents

1 Product definition and V1 outcome

2 Users and operating model

3 Product areas and navigation

4 Campaign specification

5 Signal engine specification

6 Message generation specification

7 Review and outreach workflow

8 Researcher workflow

9 Data model and technical architecture

10 Security and client readiness

11 Functional requirements

12 Quality measures and acceptance criteria

13 V1 exclusions and later phases

14 Build sequence and decisions

## Specification conventions

| **Term** | **Meaning** |
| --- | --- |
| Must | Required for V1 acceptance |
| Should | Important but may move if it blocks the core release |
| Could | Useful later enhancement, outside the V1 acceptance gate |
| Candidate signal | Evidence that has passed machine checks but still requires human judgement |
| Verified signal | A candidate whose person, company, event and source have been checked |

# 1 Product definition and V1 outcome

The product is a configurable research and outreach assistant inside the existing Prospects dashboard. It monitors a selected prospect universe, finds recent public evidence from sources beyond LinkedIn, and uses LinkedIn as the main route into a conversation.

**V1 outcome **Each morning, Coris can open one queue containing up to 20 to 30 new candidate signals across active campaigns. Every card explains what happened, why the prospect was matched, where the evidence came from and what a suitable LinkedIn opener could be.

**Quality rule **A short queue is acceptable when the engine cannot find enough credible evidence. It must never weaken the threshold, repeat old events or invent relevance merely to reach the daily target.

## Product principles

Evidence before messaging. Every draft must be traceable to a dated source.

Human control. The system prepares and organises outreach but does not send LinkedIn messages automatically in V1.

One queue. Automated searches and junior researcher submissions follow the same verification and review process.

Configure rather than rebuild. Campaign and client differences are stored as data, not hard-coded into separate applications.

Useful signals over generic activity. Routine posting, vague positivity and old announcements are rejected.

Natural messages. Drafts should be brief and recognisably human, with no fabricated familiarity or forced pitch.

## V1 success measures

| **Measure** | **V1 target** |
| --- | --- |
| Daily candidate volume | Target 20 to 30 across all active campaigns, subject to evidence quality |
| Evidence traceability | 100 percent of visible signals have a source URL and evidence date |
| Duplicate control | No repeat of the same underlying event within the configured cooldown |
| Identity accuracy | At least 90 percent of reviewed cards match the correct company and person during the pilot |
| Message usefulness | At least 60 percent of reviewed drafts are copied or need only a light edit during the pilot |
| Research efficiency | A reviewer can judge a normal card without opening more than one external source |

# 2 Users and operating model

V1 supports the following roles. Permissions are applied within a workspace so a future client cannot see another client's prospects, signals or campaign rules.

| **Role** | **Core permissions** |
| --- | --- |
| Workspace owner | Manage campaigns, users, signal rules, voice profiles, provider settings, budgets and all review actions |
| Reviewer | Review signals, edit and copy messages, open LinkedIn, dismiss items and record outreach outcomes |
| Researcher | Work through assigned prospects, verify identity and ICP fit, submit sources and flag uncertain evidence |
| Client administrator | Future client role with workspace configuration and reporting access, using the same underlying product |

## Daily operating rhythm

1.  Scheduled campaign runs collect and process new evidence before the working day.

2.  The engine allocates the tenant target across active campaigns using campaign weights and quality thresholds.

3.  Automated evidence and researcher submissions enter the same candidate pipeline.

4.  Coris reviews the signal cards, adjusts any draft message and decides whether to act.

5.  The system records edits, dismissals, sends and replies so campaign rules can improve.

6.  When the queue is exhausted, Find more signals scans the next eligible prospect batch and source depth without repeating prior work.

## Prospect selection within a campaign

| **Prospect group** | **Treatment** |
| --- | --- |
| Active watchlist | Checked on every scheduled run because the relationship or opportunity has high current value |
| Rotating pool | Checked according to scan age, priority and campaign quota so the same small group is not searched repeatedly |
| New ICP discoveries | Optional campaign setting. Up to three candidate prospects per daily run enter a separate verification queue before signals are used |
| Suppressed prospects | Excluded because of opt-out, poor fit, recent contact, archive status or a campaign-specific rule |

# 3 Product areas and navigation

## Navigation changes

The existing Signals control becomes the entry point to a full Signals area. The current Apify LinkedIn-post scan remains available as a source-specific quick scan, but scheduled campaign runs become the normal route.

| **Area** | **V1 purpose** | **Primary actions** |
| --- | --- | --- |
| Today's signals | Daily review board across active campaigns | Filter, inspect, edit, copy, save, dismiss, mark sent and mark replied |
| Campaigns | Create and manage audiences, searches and response rules | Create, duplicate, pause, edit, test and run |
| Research queue | Guide manual prospect and evidence research | Verify, submit evidence, remove, request review and mark ready |
| Signal library | Maintain reusable definitions of observable events | Enable, edit, test and map to a message strategy |
| Voice and messages | Store approved examples and constraints | Add examples, define rules and preview drafts |
| Runs and coverage | Show what searched successfully and what did not | Inspect progress, failures, costs, duplicates and eligible coverage |

## Today's signals layout

The default view uses a spacious two-column card layout on desktop and one column on smaller screens. The card must show enough context for a fast decision without hiding the source behind a separate detail page.

| **Card section** | **Required content** |
| --- | --- |
| Prospect | Name, role, company, location, company size and campaign |
| Signal | Signal type, event date, freshness and priority |
| What happened | One concise factual statement supported by the source |
| Why this person | How the company evidence relates to this prospect and why they are the appropriate contact |
| Evidence | Source name, URL, publication date, captured excerpt and source type |
| Assessment | Identity confidence, signal score and any warning requiring judgement |
| Draft | Editable LinkedIn opener and option to generate one alternative |
| History | Previous contact, previous signals, last action and cooldown warning |
| Actions | Copy, open LinkedIn, save, dismiss, wrong match, mark sent and mark replied |

# 4 Campaign specification

A campaign is the main configuration unit. It joins an audience to a set of observable signals, approved sources, message strategies and operating limits.

## Campaign creation flow

1.  Basics. Name the campaign, state its purpose, assign an owner and choose active or draft status.

2.  Audience. Select a saved prospect list or build filters using the existing prospect fields.

3.  Signals and sources. Enable the relevant signal definitions and choose where the system may look.

4.  Voice and messaging. Select an approved voice profile and define the response strategy for each signal.

5.  Operation. Set freshness, campaign weighting, cooldown, schedule and spending limits.

6.  Test. Preview the eligible prospect count, sample search queries and example drafts before activation.

## Campaign fields

| **Group** | **Field** | **Status** | **Definition** |
| --- | --- | --- | --- |
| Identity | name | Required | Short campaign name shown on cards and filters |
| Identity | objective | Required | Plain-English reason for running the campaign |
| Identity | status | Required | Draft, active, paused or archived |
| Audience | saved list | Optional | Named prospect segment from the existing database |
| Audience | company filters | Optional | Industry, company type, size, revenue, city and country |
| Audience | contact filters | Optional | Title, seniority, location, status, warmth and data completeness |
| Audience | watchlist | Optional | Prospects checked on every run |
| Audience | discovery allowance | Required | Off by default or up to three new ICP-fit candidates per day |
| Signals | enabled rules | Required | One or more definitions from the signal library |
| Sources | enabled collectors | Required | Allowed source families and campaign-specific domains |
| Sources | excluded domains | Optional | Sources the campaign must ignore |
| Timing | freshness window | Required | Maximum age of evidence, with a default of 14 days |
| Timing | cooldown | Required | Minimum gap before another outreach recommendation for the same person |
| Volume | campaign weight | Required | Share of the workspace daily target assigned to this campaign |
| Volume | run schedule | Required | Daily or selected weekdays in workspace time |
| Messaging | voice profile | Required | Approved examples and style constraints |
| Messaging | signal strategy map | Required | Action and CTA rules for each signal type |
| Control | cost ceiling | Required | Maximum automated source and model cost per day |

## Initial Coris campaign

| **Setting** | **V1 starting value** |
| --- | --- |
| Audience | UK independent creative, digital and social agencies |
| People | Founders, owners, managing directors and chief executives |
| Company size | Usually 11 to 50 employees |
| Commercial floor | Approximately GBP 1 million annual revenue where reliable data exists |
| Geography | UK, with London prioritised but not required |
| Daily workspace target | 25 candidate signals, acceptable range 20 to 30 |
| Message channel | LinkedIn private message or connection note prepared for manual use |
| Discovery | Enabled for up to three new ICP-fit agencies per day, held for verification |

# 5 Signal engine specification

The engine treats a source item, a signal and an outreach recommendation as separate records. This prevents one weak model judgement from turning an unverified article into a message.

## Collection sources

| **Source family** | **V1 behaviour** |
| --- | --- |
| Web search | Run narrow, date-bounded queries for company names, people, domains and enabled signal terms |
| Monitored pages | Revisit known news, careers, team, services, case-study and client pages and detect meaningful changes |
| Industry and local sources | Check configured publications, awards sites, event pages, newsletters and public announcements |
| Public social | Check configured public Instagram, Facebook, TikTok and YouTube profiles where an approved collector is available |
| LinkedIn activity | Reuse the current Apify process for recent posts and comments as one evidence source |
| Manual research | Accept a URL and note from the junior researcher, then run the same match, dedupe and scoring steps |

## Search construction

Searches are produced from the campaign configuration and each prospect's known identity data. The system should use company variants, person name, domain, social handles, location and signal-specific terms. Generic searches that omit a prospect or company identifier are used only for the optional new-prospect discovery route.

| **Input** | **Examples of use** |
| --- | --- |
| Company identity | Legal name, trading name, abbreviations, previous name and website domain |
| Person identity | Full name, known title and company |
| Signal terms | Won, appointed, hiring, launched, rebrand, expansion, partnership, acquired, speaking |
| Source restrictions | Configured domains, social profiles, source types and exclusions |
| Time window | Published or changed within the campaign freshness period |
| Geography | Used to qualify prospects and disambiguate companies, rather than reject a national publication |

## Evidence processing

1.  Capture the original URL, source name, title, content excerpt, publication date and collection time.

2.  Identify company and person names, domains, locations and known social handles.

3.  Match the evidence to an existing company and then choose the most appropriate campaign contact.

4.  Reject weak, ambiguous or unsupported matches before message generation.

5.  Create an event fingerprint so several articles or posts about the same event become one signal.

6.  Classify the event against the campaign's enabled signal definitions.

7.  Score the candidate and route it to the correct review state.

## Signal definitions

| **Signal category** | **Observable evidence** |
| --- | --- |
| Growth ambition | Expansion plans, public growth targets, investment or new market entry |
| Team expansion | Senior commercial, marketing or new-business hires and relevant vacancies |
| Offer development | New service, product, capability, IP, partnership or sector focus |
| Positioning change | Rebrand, proposition change, new website or major narrative shift |
| System pressure | Public signs of fragmented process, CRM difficulty, resource strain or delivery pressure |
| Pipeline quality | Business-development hiring, pitch activity, lead concerns or inconsistent prospecting |
| Commercial targets | Revenue ambition, client concentration, investment expectation or growth commitment |
| Ownership change | Acquisition, management buyout, founder transition, merger or succession |
| Marketing consistency | New content programme, research release, event series or renewed market activity |
| Explicit frustration | A decision-maker directly describes a relevant commercial or operational problem |
| Recognition | Award, shortlist, ranking or other credible recognition worth acknowledging |
| Client movement | Public client win, loss, retained relationship or major case-study release |

## Candidate scoring

The signal score is separate from identity confidence. A high-quality event attached to the wrong agency must still be rejected.

| **Factor** | **Points** | **Question** |
| --- | --- | --- |
| Event specificity | 0 to 2 | Did something clear and current actually happen |
| Evidence strength | 0 to 2 | Is the event supported by a direct or credible source |
| Commercial relevance | 0 to 2 | Does it connect to new-business foundations, strategy, growth systems or AI enablement |
| Timing | 0 to 2 | Is the evidence recent enough for a natural approach |
| Contact value | 0 to 2 | Does it create a genuine reason to speak to this person |

| **Score** | **Treatment** |
| --- | --- |
| 8 to 10 | Priority candidate shown near the top of the review queue |
| 7 | Normal candidate shown in the review queue |
| 5 to 6 | Held in Needs review for researcher or owner judgement |
| 0 to 4 | Rejected automatically and retained only in the run log |

## Identity confidence

| **Level** | **Rule** |
| --- | --- |
| High | Company domain or official social account matches, with corroborating company or person name |
| Medium | Company and location match but no domain-level identifier is present |
| Low | Name-only or ambiguous match. The item cannot reach Ready without human verification |

## Duplicate and freshness rules

Canonicalise URLs and remove tracking parameters before comparison.

Create an event fingerprint from company, event type, named entities and event date.

Merge several sources about one event and retain the strongest source as primary evidence.

Do not resurface a dismissed event unless a materially new development occurs.

Do not treat a recently reposted old announcement as a new event.

Warn when the prospect has been contacted within the campaign cooldown, even if the new event is valid.

# 6 Message generation specification

The message engine generates a draft only after the evidence, entity match and signal score pass the campaign threshold. It uses the event, relationship state, response strategy, voice profile and permitted commercial bridge.

## Message strategy mapping

| **Signal** | **Default strategy** | **Message rule** |
| --- | --- | --- |
| Award or shortlist | Acknowledge | Brief congratulation. No sales bridge by default |
| Client win | Acknowledge and ask | Congratulate, then ask a light question only when the relationship supports it |
| Business-development hire | Relevant observation | Reference the role and a practical new-business point without applying for the role |
| Rebrand or positioning | Curious response | Mention the specific change and ask what prompted it |
| New offer | Commercial curiosity | Ask what demand or client need led to the offer |
| Growth target | Relevant bridge | Recognise the ambition and connect it to a relevant growth-system perspective |
| System pressure | Helpful response | Offer a concise observation or resource. Avoid exploiting personal frustration |
| Explicit frustration | Sensitive judgement | Usually comment or empathise first. A private commercial message requires human approval |
| Warm relationship | Natural reactivation | Use the event as a genuine reason to restart the conversation |

## Voice profile fields

| **Field** | **V1 treatment** |
| --- | --- |
| Approved examples | A minimum set of real messages written or approved by the workspace owner |
| Length | Campaign-configurable, with a default maximum of 280 characters for the first draft |
| Greeting | Preferred opening style and whether names are normally used |
| Abbreviations | Examples that are acceptable in this voice |
| Emoji | Allowed set and maximum frequency, including an option for none |
| Punctuation | Typical use of full stops, exclamation marks and informal smileys |
| Humour | Whether light humour is allowed and examples of acceptable use |
| CTA | Preferred question styles and situations where no CTA should be used |
| Banned language | AI-sounding, overblown, salesy or brand-inappropriate phrases |
| Personal context | Owner-approved facts that may be used. The engine cannot create new personal facts |

## Draft validation

Every factual claim in the draft must be supported by the stored evidence.

The draft must use the correct person and company names.

The wording must comply with the campaign length and voice rules.

The draft must not claim personal experience or a relationship absent from the approved context bank.

The system must reject fake familiarity, generic flattery and irrelevant offer references.

A second draft may change the phrasing or response strategy, but it cannot change the underlying fact.

## Learning from review

V1 stores the original draft, the final edited version and the review action. Approved edits become retrieval examples for later drafts within that workspace and voice profile. V1 does not fine-tune a custom model.

# 7 Review and outreach workflow

Today's signals is a decision queue rather than a news feed. The default sort combines score, freshness, campaign weight, relationship warmth and whether the item needs an urgent response.

## Filters

Campaign and signal category.

Priority and identity confidence.

New, saved, dismissed, sent or replied state.

Automated, LinkedIn or researcher source.

Known prospects or new ICP discoveries.

Needs review or ready to act.

## Card actions and state changes

| **Action** | **Result** |
| --- | --- |
| Edit | Updates the working draft while preserving the generated version |
| Generate alternative | Creates one new version using the same verified evidence and strategy |
| Copy | Copies the current draft and records a copy event |
| Open LinkedIn | Opens the stored profile URL in a new tab |
| Save | Moves the card to Saved without changing outreach status |
| Dismiss | Removes the card from the active queue and requires a reason |
| Wrong match | Rejects the entity match and adds it to the matching feedback set |
| Mark sent | Records date, channel and final message, then starts the campaign cooldown |
| Mark replied | Records a reply outcome and removes the item from follow-up prompts |

## Dismissal reasons

Weak or generic event.

Wrong person or company.

Old or repeated information.

No natural reason to contact.

Prospect is not a fit.

Already contacted or already knew.

Source is unreliable.

## Find more signals

1.  The button becomes available when the active queue has no unseen cards or the user deliberately requests more.

2.  The user chooses one campaign or all eligible active campaigns.

3.  The interface shows the next search scope and estimated provider cost before starting.

4.  The run excludes processed URLs, prior event fingerprints, prospects in cooldown and batches already scanned within the source interval.

5.  The engine searches the next eligible rotating prospects and then approved secondary sources.

6.  The same score and confidence thresholds apply. The engine cannot relax them to fill the queue.

7.  The result states how many new candidates were added and how many items were rejected as duplicates, stale, weak or ambiguous.

## Empty and failure states

| **Situation** | **Required message or behaviour** |
| --- | --- |
| No credible signals | No strong new signals were found. The system shows the coverage completed and next eligible scan time |
| Source blocked | The run continues with other sources and records the blocked source in Runs and coverage |
| Provider limit reached | The campaign pauses further paid collection and explains which limit was reached |
| Partial run | Completed results are retained. Failed source tasks can be retried without duplicating completed work |
| Draft failure | The verified signal remains visible without a message and can be redrafted |

# 8 Researcher workflow

The junior researcher works from a guided queue inside the same dashboard. Their task is to verify identity, ICP fit and evidence. The researcher does not need to decide the final outreach message.

## Prospect research states

| **State** | **Meaning** |
| --- | --- |
| Unverified | The prospect has not yet been checked by the researcher |
| Verified | Identity and basic ICP fit have been confirmed |
| Researching | The researcher is checking LinkedIn and wider public activity |
| Research complete | Required fields and source checks have been completed |
| Ready for Coris | The record and any signals are ready for owner review |
| Needs review | Identity, fit or evidence remains uncertain |
| Remove | The record is clearly outside the ICP, duplicated or unsuitable |

## Research checklist

Confirm the person, title, company and LinkedIn profile.

Confirm company website, agency type, location and approximate size.

Check recent LinkedIn activity and wider public activity.

Look for relevant mutual relationships or previous contact context.

Submit direct URLs, evidence dates and short factual notes.

Classify each finding as Strong, Maybe or Nothing.

Use Needs review when the company or event match is uncertain.

## Manual evidence submission

| **Field** | **Requirement** |
| --- | --- |
| Prospect or company | Selected from the database or added to the New prospects queue |
| Source URL | Required |
| Source date | Required when visible, otherwise explicitly marked unknown |
| Evidence summary | Short factual description with no inferred sales angle |
| Suggested category | Optional because the engine will also classify it |
| Researcher confidence | Strong, Maybe or Nothing |
| Notes | Optional disambiguation or relationship context |

## Researcher quality feedback

When Coris dismisses a researcher-submitted card, the dismissal reason is visible to the researcher. The reporting view compares submissions, verified signals and outreach actions without reducing research quality to raw volume alone.

# 9 Data model and technical architecture

The existing static GitHub Pages frontend and Supabase project remain the base. Search providers and Apify calls run through server-side functions so provider tokens never appear in browser code. Long-running collectors return results asynchronously through run records and callbacks.

## Core records

| **Record** | **Purpose** |
| --- | --- |
| workspaces | Client or Coris workspace and operating defaults |
| workspace_members | User membership, role and status |
| campaigns | Audience, schedule, quota, voice and operational settings |
| campaign_prospects | Campaign membership, watchlist state and scan history |
| signal_definitions | Reusable event definitions, examples and false positives |
| campaign_signal_rules | Campaign-specific enablement, thresholds and response strategy |
| campaign_source_rules | Allowed collectors, domains, profiles and exclusions |
| voice_profiles | Approved examples, style rules, banned language and personal context |
| search_runs | Run type, scope, progress, cost, status and counts |
| source_tasks | Individual collector jobs and provider references |
| evidence_items | Original source, content, dates, captured text and canonical URL |
| entity_matches | Candidate company and person matches with confidence and decision |
| signals | Deduplicated event, classification, score, status and primary evidence |
| signal_sources | Links one signal to all supporting evidence items |
| message_drafts | Generated, edited and final message versions |
| review_actions | Copy, save, dismiss, wrong match and verification events |
| outreach_events | Sent, replied and conversation outcome records |

## Required record rules

Every product record carries a workspace identifier unless it is an explicitly global definition.

Every automated run has a stable idempotency key so retries cannot create duplicate work.

Evidence is immutable after capture. Corrections create a new version or review decision.

Generated messages preserve the prompt inputs, model identifier, source evidence and version history.

Provider-specific raw data may be stored separately for audit and debugging, subject to retention limits.

Existing prospect records remain the authoritative contact record and are referenced rather than copied.

## Server-side flow

1.  A scheduled job selects campaigns due to run and creates one search run per workspace and schedule window.

2.  A server-side orchestrator creates source tasks and starts the relevant providers or page collectors.

3.  Callbacks or polling update source task status and write raw evidence items.

4.  Processing jobs perform entity matching, deduplication, classification and scoring.

5.  Eligible signals trigger message generation and validation.

6.  The frontend reads the resulting queue through workspace-restricted database policies.

## Supabase implementation constraints

Enable Row Level Security on every table exposed through the Data API.

Authorise records through workspace membership rather than authentication alone.

Keep secret and service-role credentials in server-side functions or secret storage only.

Use scheduled database jobs to invoke lightweight orchestration. Keep slow external collection in asynchronous provider jobs rather than a long database transaction.

Grant Data API access explicitly where required because new tables may not be exposed automatically.

Treat webhooks and callbacks as untrusted until signatures or provider references are validated.

# 10 Security and client readiness

V1 is piloted in Coris's workspace, but the schema and access rules must support several client workspaces from the start. Client activation can follow after the pilot without rebuilding the database.

## Workspace isolation

A signed-in user can read or change only records belonging to a workspace where they hold an active membership.

Researchers see only assigned or permitted prospect queues.

Provider tokens and model credentials never reach the browser.

Global signal definitions are read-only to normal users. Workspace overrides remain tenant-specific.

Cross-workspace analytics use aggregated, non-identifying records only and are outside V1 unless explicitly enabled later.

## Client configuration

| **Configurable per workspace** | **Shared across the product** |
| --- | --- |
| Prospects and lists | Application code |
| Campaigns and geographies | Core signal-processing pipeline |
| Enabled signals and source domains | Base signal definition templates |
| Voice examples and message rules | Security controls and audit structure |
| Offers, proof points and permitted CTAs | Provider adapter interfaces |
| Schedule, target volume and spending limit | Release and maintenance process |

## Data handling

V1 collects public professional information and links it to existing prospect records.

The product stores the minimum source text needed to verify and explain a signal.

Workspace owners can archive campaigns and remove prospect-linked signal history according to the agreed retention policy.

Source collection must respect provider terms, technical access controls and campaign source rules.

All manual and automated changes relevant to outreach are recorded with actor and timestamp.

# 11 Functional requirements

| **ID** | **Priority** | **Requirement** |
| --- | --- | --- |
| FR01 | Must | Create, edit, duplicate, pause and archive campaigns |
| FR02 | Must | Build a campaign audience from saved lists or existing prospect fields |
| FR03 | Must | Run several active campaigns in one workspace |
| FR04 | Must | Allocate a workspace daily target across campaigns without forcing weak results |
| FR05 | Must | Support active watchlist, rotating pool, suppressed prospects and optional discovery |
| FR06 | Must | Collect evidence from web search, monitored pages, configured publications, LinkedIn and manual research |
| FR07 | Should | Collect configured public social activity where an approved connector is available |
| FR08 | Must | Store original source URL, source date, captured evidence and collection time |
| FR09 | Must | Match evidence to an existing company and contact with a visible confidence level |
| FR10 | Must | Merge duplicate coverage of one underlying event |
| FR11 | Must | Classify candidates against enabled signal definitions |
| FR12 | Must | Apply the 10-point signal score and a separate identity-confidence decision |
| FR13 | Must | Reject stale, unsupported, generic and ambiguous evidence before drafting |
| FR14 | Must | Generate an editable LinkedIn draft using the campaign voice and message strategy |
| FR15 | Must | Prevent invented personal context and unsupported factual claims |
| FR16 | Must | Show all decision context on one signal card |
| FR17 | Must | Copy a draft and open the correct LinkedIn profile |
| FR18 | Must | Save, dismiss, flag wrong match, mark sent and mark replied |
| FR19 | Must | Require and report dismissal reasons |
| FR20 | Must | Trigger Find more signals without repeating completed work |
| FR21 | Must | Show run progress, source failures, rejected counts and provider cost |
| FR22 | Must | Support the researcher states and manual evidence form |
| FR23 | Must | Route automated and manual evidence through the same qualification pipeline |
| FR24 | Must | Restrict every workspace record through Row Level Security |
| FR25 | Must | Keep provider credentials and privileged database access off the client |
| FR26 | Should | Use approved edits as examples for later drafts within the same voice profile |
| FR27 | Should | Export campaign, signal and outcome records for analysis |

## Nonfunctional requirements

| **Area** | **Requirement** |
| --- | --- |
| Usability | A normal signal can be judged and actioned from the card without navigating to another dashboard page |
| Performance | The review board should become interactive within three seconds under the normal V1 data volume |
| Feedback | User actions should acknowledge within one second even when background processing continues |
| Reliability | Run retries are idempotent and partial success does not discard completed evidence |
| Audit | Every signal shows its source and every material state change has an actor and timestamp |
| Accessibility | Core review and campaign actions are keyboard accessible with readable contrast and focus states |
| Time | Schedules and displayed dates use the workspace timezone, initially Europe London |
| Cost | Every automated provider and model call is attributable to a run, campaign and workspace |

# 12 Quality measures and acceptance criteria

The release is accepted through a live pilot against Coris's prospect database. A technically successful search is insufficient if the queue contains forced matches or unusable messages.

| **ID** | **Area** | **Pass condition** |
| --- | --- | --- |
| AC01 | Campaigns | Create and run at least three campaigns with different audiences, signals and message rules |
| AC02 | Daily queue | Produce up to 20 to 30 candidates across active campaigns while allowing a smaller honest result |
| AC03 | Source mix | Show verified examples from at least four source families, including a source outside LinkedIn |
| AC04 | Evidence | Every visible card contains a working source URL, evidence date and factual summary |
| AC05 | Matching | At least 90 percent of a reviewed pilot sample links to the correct company and intended contact |
| AC06 | Deduplication | The same event from several sources appears as one card with supporting sources |
| AC07 | Freshness | Old reposts and evidence outside the campaign window do not appear as new signals |
| AC08 | Messages | No tested draft invents a fact, personal connection or unsupported relationship |
| AC09 | Tone | At least 60 percent of tested drafts are copied or require only a light edit |
| AC10 | Actions | Edit, copy, open LinkedIn, dismiss, mark sent and mark replied persist correctly |
| AC11 | Refill | Find more signals scans a new eligible batch and reports duplicates, rejections and new candidates |
| AC12 | Research | A researcher can move a prospect through the defined states and submit evidence into the main queue |
| AC13 | Isolation | Test users in different workspaces cannot read or change one another's records |
| AC14 | Failure | A failed source task does not remove successful results and can be retried safely |
| AC15 | Cost | The run log reports provider and model usage by campaign and workspace |

## Pilot review sample

At least 100 candidate signals reviewed over a minimum two-week period.

A mix of watchlist prospects, rotating prospects and optional new discoveries.

Dismissal reasons reviewed weekly to identify weak signal definitions or matching errors.

Message edits compared with original drafts to identify recurring tone problems.

Reply outcomes recorded when available, but replies are not required for technical V1 acceptance.

# 13 V1 exclusions and later phases

The following items remain outside the first release so the pilot can focus on signal accuracy, review speed and message fit.

| **Excluded from V1** | **Reason or later route** |
| --- | --- |
| Automated LinkedIn sending | V1 keeps final action under human control. The existing browser plugin may later insert approved copy |
| Full CRM replacement | Prospects remains a focused new-business workspace and may continue to integrate with other CRM systems |
| Automated email sequences | The first release prepares LinkedIn messages and records outcomes |
| Unlimited open-web crawling | V1 uses bounded searches, approved source lists and known prospect identities |
| Autonomous changes to ICP or campaign strategy | The owner approves targeting and signal rules |
| Model fine-tuning | V1 uses approved examples and retrieval from prior edits |
| Separate client deployments | Clients use isolated workspaces in one maintained product unless a future contract requires otherwise |
| Conversation keyword feed | Public comment opportunities use a separate scoring method and can be added after the prospect-signal workflow is proven |
| Revenue attribution | V1 records outreach and replies. Opportunity and revenue attribution can follow through CRM integration |

## Likely next phases

Chrome extension support for inserting an approved message into LinkedIn.

Comment-first workflows and a separate conversation-opportunity queue.

Client onboarding templates for ICP, signal selection, voice capture and proof points.

CRM sync for opportunity and revenue outcomes.

Team approval workflows and client reporting.

Additional structured sources and source-specific connectors.

# 14 Build sequence and decisions

Development should follow the order below. Each work package leaves a usable, testable piece of the product and reduces the chance of building message automation on weak evidence.

| **Work package** | **Scope** | **Exit condition** |
| --- | --- | --- |
| 1 Workspace and data foundation | Workspace records, memberships, campaign records, RLS and audit fields | Two test workspaces are isolated and existing prospects remain accessible |
| 2 Campaign builder | Audience filters, signal selection, sources, schedule, volume and voice assignment | A campaign can be saved, tested, activated and paused |
| 3 Unified evidence intake | Manual submission, current LinkedIn scan and first external web collector | All three produce the same evidence record |
| 4 Matching and qualification | Entity matching, event fingerprints, dedupe, freshness and scoring | A test set is classified with reviewable reasons |
| 5 Message drafting | Voice profiles, strategy mapping, validation and edit history | Verified signals produce editable, source-supported drafts |
| 6 Review board and refill | Cards, filters, actions, run log and Find more signals | Coris can complete the full daily workflow |
| 7 Researcher workflow | Assignments, states, checklists and feedback | The junior researcher can submit evidence without a separate spreadsheet |
| 8 Pilot and calibration | Two-week live test, source tuning, dismissal analysis and acceptance review | V1 acceptance criteria are measured and issues prioritised |

## Decisions required before implementation

| **Decision** | **Recommended V1 position** |
| --- | --- |
| Primary web-search provider | Select after a short comparison using the same 50-prospect test set. Keep the adapter provider-neutral |
| Public social collectors | Enable only the sources that can return stable public URLs, dates and account identities |
| Voice examples | Start with at least 30 real or approved Coris LinkedIn messages, covering congratulation, curiosity, warm reactivation and a soft commercial bridge |
| Pilot campaigns | Begin with one main UK agency campaign, then add two narrower variants once the source and scoring quality is stable |
| Retention | Agree how long raw captured content and rejected evidence are kept before client onboarding |
| Client release gate | Activate external client access only after the Coris pilot meets matching, evidence and message criteria |

## Build starting point

The first implementation task is the workspace, campaign and evidence schema plus a review of the current Signals modal and researcher work already underway. That work should preserve the current Apify scan, then route its results through the new evidence and signal records rather than replacing it.

Prospect Signals V1 Product Specification