---
name: sync-contact-log
description: Bring Headwaters' last-contact dates up to date from Gmail (and Google Calendar if connected). Use when asked to sync email with Headwaters, update last contact, or check who Devon has been in touch with. Needs the Headwaters connector and the Gmail connector.
---

# Sync the contact log from email

Headwaters records when each lead was last in touch (`last_contact_at`) and can resurface a lead a set number of days later (`check_in_days`). This skill fills in last contact from what actually happened in Gmail, so Devon does not have to log every email by hand.

Only read what is needed to match messages to leads. Do not summarise or store email content beyond one line per exchange.

## Steps

1. **Get the people to look for.** Call `list_contacts`. Each row has a contact's `email`, their `lead`, and that lead's current `last_contact_at`. Skip contacts with no email address. If a lead has a `website` but no contact emails, you may match on its domain instead, but not for shared domains such as gmail.com or outlook.com.

2. **Search Gmail for each lead.** Look for the most recent messages to or from the lead's contact addresses, for example `from:ana@example.com OR to:ana@example.com`. Limit the search to messages after the lead's `last_contact_at` when it has one; otherwise look back 12 months. Batch several addresses into one query where the connector allows it.

3. **Decide what counts as contact.** Count a real exchange between Devon and a person at the company, in either direction. Do not count newsletters, automated notifications, calendar system emails, or messages where the contact is only one of many recipients on a mass mailing.

4. **Log the latest exchange for each lead** with `log_contact`:
   - `lead`: the lead's name or id.
   - `at`: the message's sent time, as an ISO timestamp.
   - `kind`: `email`.
   - `summary`: one line, for example `Email from Ana Lee: "Re: analytics migration" (she will come back after their board meeting)`. Say who sent it and the subject, plus one clause on substance when it matters.

   `log_contact` is safe to repeat: the same lead, kind and time is recorded once, and an older message never moves the date back. One entry per lead for the latest exchange is enough; do not log every message in a thread.

5. **If Google Calendar is connected**, also look for past meetings whose attendees include a contact's address since the lead's `last_contact_at`, and log each with kind `meeting` and the event's start time.

6. **Notice what the email implies, but ask before acting on it.** If a message shows a meeting was booked, a proposal was accepted, or a lead went cold, say so and offer to move the lead or set a next action. Do not move stages on the strength of an email alone.

7. **Report back briefly:** which leads were updated and to what date, which leads with a check-in interval are now due, and any contacts you could not search for because they have no email address.

## Setting a check-in routine

When Devon says a conversation went well but there is nothing to do now, set the interval on the lead with `update_lead`, for example `check_in_days: 90`. It applies in any stage, including won clients. The lead will show as due for a check-in that many days after its last contact, and each new contact restarts the clock.
