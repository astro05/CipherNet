# 30. Request Builder Variables ({{name}})

Postman-style environments in the API Testing drawer: named sets of
`name → value` variables, referenced as `{{name}}` and resolved at **send
time** (the editors keep the `{{name}}` literal, so it's non-destructive).

### Requirements

* An **environment switcher** picks the active environment ("No Environment"
  disables substitution). Environments are managed (create/rename/delete) and
  their variables edited in one pop-panel.
* `{{name}}` is substituted from the active environment wherever it appears:
  **URL, Query Params, Authorization → Bearer Token, Request Headers (key or
  value), and Body.** Unknown names are left as literal `{{name}}` rather than
  blanked, so a typo is visible instead of silently dropped.
* A variable name is any non-empty string of characters other than `{`, `}`,
  and whitespace, so URL-flavoured names such as `{{localhost:44380}}` or
  `{{api/v2}}` work everywhere (highlight, autocomplete, substitution).
* **Autocomplete** — typing `{{` in any of those fields (URL, Bearer Token,
  Body, or a Params/Headers Key/Value cell) opens a dropdown of the active
  environment's matching variable names (name + current value); ↑/↓ to move,
  Enter/Tab or click to insert, Esc to dismiss. One shared dropdown follows
  whichever field has focus.
* **Colour highlight** — `{{name}}` renders in a distinct colour everywhere it
  can be typed (URL, Bearer Token, Body, Params/Headers Key/Value cells): one
  shade when the active environment defines it, another when it doesn't. Each
  field's own text is otherwise invisible (only the caret shows) over a
  backdrop that renders the colour-highlighted copy — the URL field has its
  own dedicated version of this; every other field shares one generic
  implementation.
* **Query Params encoding** — a `{{name}}` reference typed into a Param's Key
  or Value is kept literal when the table syncs back to the URL (not
  percent-encoded), so it stays both readable and resolvable; only the
  surrounding literal text is percent-encoded.
* After a send, any `{{name}}` left unresolved (no active environment, or not
  defined in it) is called out in the status line.
* Environments persist in `chrome.storage.sync` and are mirrored to the linked
  backup file (see **Backup & Restore**).
