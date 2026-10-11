---
name: research-lead
description: Research a company as a prospective Polyculture Research client and record it in Headwaters. Use when asked to assess, research, brief or add a company as a lead, or to refresh the briefing on an existing lead. Needs web search and the Headwaters connector.
---

# Research a lead for Headwaters

The result of this skill is one lead in Headwaters with three things on it: a written briefing, structured company fields filled from that briefing, and the best people to contact.

## Who Polyculture Research is looking for

<!-- Devon: this section is a first guess from how the product was described. Rewrite it in your own words; everything below depends on it. -->

Polyculture Research does data and analytics work for mission-led companies. A promising lead tends to look like this:

- A company with a real mission: B Corp, organic, co-operative, climate or community focused.
- Big enough to have data problems, small enough not to have a data team that already solves them.
- Signs of a data need: a migration under way (for example off Segment), new reporting obligations (for example the updated B Corp standards or carbon accounting), analytics job postings, or a stack that has outgrown spreadsheets.

Rate fit honestly. A weak fit recorded as weak is more useful than an optimistic one.

## Steps

1. **Check Headwaters first.** Call `get_pipeline` with the company name as `query`. If the lead exists, you are updating it, not creating it. Note the stage names while you are there; they are configurable.

2. **Research the company.** Use web search and read primary sources where you can: the company's own site, careers page, impact or B Corp report, engineering blog, and the B Lab directory or other certifier listings. Look for:
   - What they sell, to whom, and how they make money.
   - Size: headcount, revenue, funding, locations.
   - Certifications and memberships, verified against the certifier where possible.
   - Data stack and data maturity. Job postings, engineering posts, and third-party scripts on their site are the best evidence. Say what is confirmed and what is inferred.
   - Recent events that create a need: launches, migrations, new leadership, new standards they have to report against.
   - People: who owns data, analytics, operations or impact. For a small company this is often a founder, COO or head of operations.

3. **Write the briefing** in Markdown, using the template below. Keep it to what someone would want to read in five minutes before a first call. Cite sources as links. Mark anything you could not confirm as unconfirmed; do not fill gaps with plausible guesses.

4. **Save it.** For a new company call `create_lead`; for an existing one call `update_lead`. Either way pass the briefing and the structured fields together:

   | Field | What goes in it |
   | --- | --- |
   | `summary` | One or two sentences: what they do and why they could be a fit. |
   | `website` | The company's main URL. |
   | `headcount` | Approximate employee count, as a whole number. |
   | `annual_revenue_usd` | Estimated annual revenue in US dollars, as a whole number. |
   | `location` | Headquarters, as "City, Region" or "City, Country". |
   | `industry` | A few words. |
   | `certifications` | A list, for example `["B Corp", "USDA Organic"]`. Only ones you verified. |
   | `data_stack` | A list of tools, for example `["Segment", "Snowflake", "Looker"]`. |
   | `fit` | `strong`, `good`, `unclear` or `weak`. |
   | `briefing` | The Markdown briefing. |

   Leave a field out when you could not find it. An empty field is honest; a guessed one looks like a fact on the board. Estimates are fine for headcount and revenue as long as the briefing says they are estimates and where they came from.

5. **Attach contacts.** Pass them as `contacts` on `create_lead`, or call `add_contact` for an existing lead. Give each a name, title, LinkedIn URL if public, and a `notes` line on why they are the right person. Mark the best first contact `is_primary`. Only include contact details that are publicly listed; never guess an email address.

6. **Set the next action.** If the lead is new, set `next_action` to something concrete, for example "Email Jane Doe about their Segment migration". Use what you learned.

7. **Report back** in a few lines: the fit rating and the one or two reasons for it, who to contact first, and anything you could not find.

## Briefing template

```markdown
# {Company}

**Fit: {strong | good | unclear | weak}.** {One or two sentences on why.}

## What they do
## Size and shape
## Mission and certifications
## Data stack and data needs
{What is confirmed, what is inferred, and the evidence for each.}
## Why now
{Recent events that create an opening. Say so if there are none.}
## Who to talk to
## Open questions
{What to find out on a first call.}
## Sources
```

## Recording a conversation

When Devon reports a meeting, call or email with a lead:

1. `add_note` with the substance of what was said, using kind `meeting`, `call` or `email`.
2. `update_lead` with any durable facts that came up, such as a tool to add to `data_stack` or a corrected headcount.
3. If the conversation changes the stage, `move_lead` with a short `note` on why, plus the new `next_action` and `next_action_due`. Check the new stage's `exit_criteria` in `get_pipeline` to decide what the next action should be.
