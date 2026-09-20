# 33. Hide URL Patterns (More filters)

The Network panel's **More filters ▾** menu gets a "Hide URL patterns" section: a
textarea where the user pastes a list of URLs (one per line) that must never
appear in the request table.

## UI

* A textarea lives at the bottom of the More filters dropdown, below a menu
  separator, with a small label ("Hide URL patterns") and a hint line.
* Placeholder shows an example, e.g. `https://signal.peopledesk.io/NotificationHub`.
* The textarea accepts one URL/pattern per line; blank lines are ignored.
* The More filters button shows its active state (accent highlight) when at
  least one pattern is present, matching the existing toggle behavior.

## Matching semantics

* Matching is case-insensitive.
* A line containing `*` is a wildcard pattern: `*` matches any run of characters,
  and the whole URL must match (anchored at both ends).
* A line without `*` is a substring match: any URL containing the line (e.g.
  with extra query-string parameters after the pasted URL) is hidden.
* A request is hidden when its URL matches **any** pattern. It composes with all
  other predicates (filter mini-language, type pills, search, encrypted-only,
  other More filters toggles) through the existing single row-visibility
  predicate.

## Persistence

* Patterns persist across DevTools sessions in `chrome.storage.local` alongside
  the other filter settings, and are restored when the panel opens.
* The list is saved as soon as it changes (no debounce), consistent with the
  other More filters toggles.

## Performance

* Patterns are compiled once per edit (substring needles / anchored regexes), so
  per-row evaluation stays O(number of patterns) with no re-parsing per request.
* The table must remain smooth with tens of thousands of captured requests
  (§29), as with the existing filter engine.
