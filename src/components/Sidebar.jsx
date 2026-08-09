import { useEffect, useRef, useState } from "react";
import "./Sidebar.css";

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
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // Any click outside a row's menu closes it.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

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
        {drawings.map((drawing) => {
          const isActive = drawing.name === activeName;

          if (renaming === drawing.name) {
            return (
              <li key={drawing.name} className="drawing-row renaming">
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
              <li key={drawing.name} className="drawing-row confirming">
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
