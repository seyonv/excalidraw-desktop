// Dev-only. Mounts the real Sidebar so its reordering animation can be driven
// by a browser: the list changes exactly the way App's handleCreate and
// handleSelect change it, and every row's transform is sampled each frame.
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Sidebar from "../src/components/Sidebar.jsx";

const INITIAL = ["alpha", "beta", "gamma", "delta"].map((name) => ({ name }));

function Harness() {
  const [drawings, setDrawings] = useState(INITIAL);
  const [active, setActive] = useState("gamma");
  const counter = useRef(0);

  // Creating prepends the new drawing and lifts the one just left to second
  // place, because App flushes it first and the list is recency sorted.
  const create = useCallback(() => {
    const name = `new-${++counter.current}`;
    setActive((prev) => {
      setDrawings((list) => [
        { name },
        ...(prev ? [{ name: prev }] : []),
        ...list.filter((d) => d.name !== prev),
      ]);
      return name;
    });
  }, []);

  // Selecting lifts the drawing being left, same recency rule.
  const select = useCallback((name) => {
    setActive((prev) => {
      setDrawings((list) => [
        ...(prev && prev !== name ? [{ name: prev }] : []),
        ...list.filter((d) => d.name !== prev),
      ]);
      return name;
    });
  }, []);

  return (
    <Sidebar
      drawings={drawings}
      activeName={active}
      open
      onToggle={() => {}}
      onSelect={select}
      onCreate={create}
      onRename={() => {}}
      onDelete={(name) =>
        setDrawings((list) => list.filter((d) => d.name !== name))
      }
      theme="light"
    />
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
