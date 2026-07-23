import { useState, useEffect } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import "./App.css";
import { invoke } from "@tauri-apps/api/core";

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null);
  const [appState, setAppState] = useState({});
  const [elements, setElements] = useState([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (!excalidrawAPI) return;

    invoke("get_pending_file").then((content) => {
      if (!content) return;
      try {
        const data = JSON.parse(content);
        excalidrawAPI.updateScene({
          elements: data.elements || [],
          appState: data.appState || {},
        });
      } catch (e) {
        console.error("Failed to parse excalidraw file:", e);
      }
    });
  }, [excalidrawAPI]);

  useEffect(() => {
    window.EXCALIDRAW_ASSET_PATH = "/";

    window.addEventListener("beforeunload", () => {
      let currentAppState = excalidrawAPI.getAppState();
      let currentElements = excalidrawAPI.getSceneElements();

      delete currentAppState.collaborators;

      localStorage.setItem("excalidrawState", JSON.stringify(currentAppState));
      localStorage.setItem("excalidrawElements", JSON.stringify(currentElements));
    });

    const savedState = localStorage.getItem("excalidrawState");
    if (savedState) {
      const parsedState = JSON.parse(savedState);
      setAppState(parsedState);
    }

    const savedElements = localStorage.getItem("excalidrawElements");
    if (savedElements) {
      const parsedElements = JSON.parse(savedElements);
      setElements(parsedElements);
    }

    setMounted(true);
  }, [excalidrawAPI]);

  return (
    <main className="container">
      {mounted ? (
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          initialData={{
            appState: appState,
            elements: elements,
          }}
       />
      ) : (
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      )}
    </main>
  );
}

export default App;
