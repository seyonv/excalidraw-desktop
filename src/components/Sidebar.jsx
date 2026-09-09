import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./Sidebar.css";

const REORDER_MS = 220;
const SORT_KEY = "excalidraw:sidebarSort";

// The list holds still by default: alphabetical order never changes under
// the cursor, whereas recency reorders every time a drawing is left. Recency
// is a click away for finding what was worked on last.
const sortDrawings = (drawings, sort) =>
  [...drawings].sort((a, b) =>
    sort === "recent"
      ? b.modified - a.modified || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

/**
 * FLIP's second half: pin the element to the state it is animating *from*,
 * flush that, then release it to its real state on the next frame so the
 * change plays out as a transition instead of a jump.
 */
function animateFrom(el, prop, from) {
  el.style.transition = "none";
  el.style[prop] = from;
  el.getBoundingClientRect(); // force reflow before releasing the transition
  requestAnimationFrame(() => {
    el.style.transition = `${prop} ${REORDER_MS}ms ease`;
    el.style[prop] = "";
  });
}

/**
 * Collapsible list of drawings. Purely presentational — every mutation is
 * delegated upward so App stays the single owner of the library state.
 */
function Sidebar({
  drawings,
  activeName,
  open,
  onToggle,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  theme,
}) {
  const themeClass = theme === "dark" ? " dark" : "";
  // Name of the row being renamed, and the name of the row awaiting delete confirmation.
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const [sort, setSort] = useState(
    () => (localStorage.getItem(SORT_KEY) === "recent" ? "recent" : "name"),
  );
  const inputRef = useRef(null);
  const rowRefs = useRef(new Map());
  const rowPositions = useRef(new Map());

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // Recency sort reshuffles this list under the user's cursor — e.g.
  // switching drawings autosaves the one just left, moving it in the
  // ranking. React reorders the underlying DOM nodes instantly since they're
  // keyed by name; a FLIP animation (measure the old position, then slide
  // from there to the new one) is what turns that snap into a slide the eye
  // can follow instead of a jarring jump.
  useLayoutEffect(() => {
    const nextPositions = new Map();
    rowRefs.current.forEach((el, name) => {
      nextPositions.set(name, el.getBoundingClientRect().top);
    });

    // The first list we see is the app opening, not a reorder — there is
    // nothing to animate against, and every row would count as new.
    if (rowPositions.current.size) {
      nextPositions.forEach((top, name) => {
        const el = rowRefs.current.get(name);
        const prevTop = rowPositions.current.get(name);

        // A row that wasn't here before — "New drawing" — has no old position
        // to slide from, and the rows it displaced spend the whole animation
        // still translated over its slot. Fading it in on the same beat lets
        // them clear out first; drawn instantly at full opacity it pops in
        // underneath their text, which is the part that reads as sudden.
        if (prevTop === undefined) {
          animateFrom(el, "opacity", "0");
          return;
        }

        const delta = prevTop - top;
        if (delta) animateFrom(el, "transform", `translateY(${delta}px)`);
      });
    }

    rowPositions.current = nextPositions;
  }, [drawings, sort]);

  // Any click outside a row's menu closes it.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  const toggleSort = () => {
    const next = sort === "recent" ? "name" : "recent";
    localStorage.setItem(SORT_KEY, next);
    setSort(next);
  };

  const sorted = sortDrawings(drawings, sort);

  const rowRef = (name) => (el) => {
    if (el) rowRefs.current.set(name, el);
    else rowRefs.current.delete(name);
  };

  const startRename = (name) => {
    setRenaming(name);
    setDraft(name);
    setConfirmingDelete(null);
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (renaming && trimmed && trimmed !== renaming)
      onRename(renaming, trimmed);
    setRenaming(null);
  };

  if (!open) {
    return (
      <button
        className={`sidebar-reopen${themeClass}`}
        onClick={onToggle}
        title="Show drawings"
        aria-label="Show drawings"
      >
        ☰
      </button>
    );
  }

  return (
    <aside className={`sidebar${themeClass}`}>
      <header className="sidebar-header">
        <span className="sidebar-title">Drawings</span>
        <button
          className={`sort-button${sort === "recent" ? " on" : ""}`}
          onClick={toggleSort}
          title={
            sort === "recent"
              ? "Sorted by last modified — click to sort by name"
              : "Sorted by name — click to sort by last modified"
          }
          aria-label="Toggle sort order"
          aria-pressed={sort === "recent"}
        >
          {sort === "recent" ? "Recent" : "A–Z"}
        </button>
        <button
          className="icon-button"
          onClick={onToggle}
          title="Hide sidebar"
          aria-label="Hide sidebar"
        >
          ‹
        </button>
      </header>

      <button className="new-button" onClick={onCreate}>
        <span className="new-button-plus">+</span> New drawing
      </button>

      <ul className="drawing-list">
        {sorted.map((drawing) => {
          const isActive = drawing.name === activeName;

          if (renaming === drawing.name) {
            return (
              <li key={drawing.name} ref={rowRef(drawing.name)} className="drawing-row renaming">
                <input
                  ref={inputRef}
                  className="rename-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                  autoFocus
                />
              </li>
            );
          }

          if (confirmingDelete === drawing.name) {
            return (
              <li key={drawing.name} ref={rowRef(drawing.name)} className="drawing-row confirming">
                <span className="confirm-text">Delete?</span>
                <button
                  className="confirm-yes"
                  onClick={() => {
                    setConfirmingDelete(null);
                    onDelete(drawing.name);
                  }}
                >
                  Delete
                </button>
                <button
                  className="confirm-no"
                  onClick={() => setConfirmingDelete(null)}
                >
                  Cancel
                </button>
              </li>
            );
          }

          return (
            <li
              key={drawing.name}
              ref={rowRef(drawing.name)}
              className={`drawing-row${isActive ? " active" : ""}`}
            >
              <button
                className="drawing-name"
                onClick={() => onSelect(drawing.name)}
                onDoubleClick={() => startRename(drawing.name)}
                title={drawing.name}
              >
                {drawing.name}
              </button>
              <button
                className="icon-button row-menu-button"
                title="More"
                aria-label={`Actions for ${drawing.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === drawing.name ? null : drawing.name);
                }}
              >
                ⋯
              </button>
              {menuFor === drawing.name && (
                <div className="row-menu" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => {
                      setMenuFor(null);
                      startRename(drawing.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenuFor(null);
                      setConfirmingDelete(drawing.name);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {drawings.length === 0 && <p className="empty-note">No drawings yet.</p>}
    </aside>
  );
}

export default Sidebar;
