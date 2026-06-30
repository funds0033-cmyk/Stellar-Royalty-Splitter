import { useEffect, useState } from "react";
import { isOnline, watchConnectivity } from "../lib/registerServiceWorker";

/**
 * Banner that appears whenever the browser reports `offline` (#522).
 *
 * Renders nothing when online so it occupies no layout space. When
 * offline, renders a fixed-position banner at the top of the viewport
 * with a brief message and a status-role for assistive tech. The
 * inline styles keep the component self-contained — no extra CSS file
 * needed for a single 1-line banner.
 */
export function OfflineIndicator(): JSX.Element | null {
  const [online, setOnline] = useState<boolean>(isOnline());

  useEffect(() => {
    const handle = watchConnectivity(setOnline);
    return () => handle.stop();
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        background: "#b45309",
        color: "#fff",
        textAlign: "center",
        padding: "0.5rem 1rem",
        fontSize: "0.9rem",
        fontFamily: "system-ui, sans-serif",
        boxShadow: "0 2px 6px rgba(0,0,0,0.18)",
      }}
    >
      You're offline — writes will be queued and synced when you reconnect.
    </div>
  );
}
