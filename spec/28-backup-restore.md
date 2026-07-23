# 28. Backup & Restore (Collections + History)

Saved requests (Collections) and Request History must survive **removing and
re-adding the extension**.

Chrome erases an extension's storage — `chrome.storage.local` *and*
`chrome.storage.sync` — when the extension is removed. Synced data only returns
for Web Store installs on a signed-in profile, so a sideloaded build gets nothing
back. Extension storage therefore cannot satisfy this requirement on its own: the
data must be mirrored **outside** the extension, to a file on disk.

### Requirements

* The user links a **backup file** once (File System Access API).
* Every change to Collections or History is written to that file automatically.
* When the panel opens, the linked file is read and merged back in automatically
  — no interaction beyond having linked the file.
* After a remove/re-add, re-linking the same file restores everything.
* Provide a **Restore from file** and a **Download a copy** path that work
  without a linked file (moving data between machines, one-off snapshots).
* Restores are **non-destructive**: folders and requests are merged, not
  replaced; history is de-duplicated.

### Constraints

* Chrome blocks file pickers in cross-origin iframes, and a DevTools panel is
  one. Picking a file and granting permission must therefore happen on a
  top-level extension page; reads and writes must happen in the service worker.
* Chrome revokes file permissions across browser restarts. The UI must show when
  auto-save needs re-authorising, and it must be a single click to restore.
* Per §24, **keys and IVs are never written to the backup file.** The file does
  contain Bearer tokens saved with a request, and the UI must say so.
