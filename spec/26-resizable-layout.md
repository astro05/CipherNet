# 26. Resizable Layout (Like Chrome DevTools)

The CipherNet panel must support fully resizable panes and columns, matching the behavior of Chrome DevTools.

### Resizable Panes

Users must be able to resize all major panes by dragging splitter handles.

Supported layouts include:

* Request list ↔ Request details
* Left sidebar ↔ Main content
* Top pane ↔ Bottom pane (when applicable)
* Nested split views

Requirements:

* Drag handles should provide visual feedback.
* Resize should be smooth (60 FPS where possible).
* Enforce minimum and maximum pane sizes.
* Persist pane sizes across browser sessions using Chrome Storage.
* Double-clicking a splitter resets it to the default size.
* Layout updates should not require reloading the panel.

---

### Resizable Columns

The request table should behave like Chrome DevTools' Network table.

Users must be able to:

* Drag column borders to resize column widths.
* Double-click a column border to auto-fit its content.
* Reorder columns via drag-and-drop.
* Show or hide columns.
* Pin important columns (optional).
* Persist column widths, order, and visibility across sessions.

Columns include (but are not limited to):

* Name
* Status
* Type
* Initiator
* Size
* Time
* Waterfall
* Encryption
* Decryption Status
* API Name
* Response Hash
* Tags

---

### Request Detail Tabs

The request details panel (Headers, Preview, Response, Timing, Cookies, Security, etc.) should support:

* Adjustable panel height.
* Adjustable panel width.
* Draggable divider between the request list and details.
* Remember the user's preferred size.
* Smooth resizing without losing scroll position.

---

### UX Requirements

The resizing behavior should closely match Chrome DevTools:

* Cursor changes to indicate resizable edges.
* Live resizing during drag.
* No layout flickering.
* Responsive rendering.
* Virtualized tables continue to perform well after resizing.
* Keyboard accessibility where applicable.

Preferred implementation:

* Use a robust splitter library (e.g., react-resizable-panels or Split.js) for pane resizing.
* Use a headless table library (e.g., TanStack Table) with custom column-resizing support.
* Store layout preferences in Chrome Storage and restore them automatically when DevTools opens.
