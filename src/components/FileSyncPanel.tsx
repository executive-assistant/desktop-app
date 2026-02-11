import type { FileSyncOperation } from "../types";

type FileSyncPanelProps = {
  threadId: string;
  isSyncing: boolean;
  syncError: string | null;
  lastAppliedCursor: string | null;
  lastServerTimeUtc: string | null;
  operations: FileSyncOperation[];
  onSyncNow: () => Promise<void>;
};

export function FileSyncPanel({
  threadId,
  isSyncing,
  syncError,
  lastAppliedCursor,
  lastServerTimeUtc,
  operations,
  onSyncNow
}: FileSyncPanelProps) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>File Sync</h2>
        <button type="button" onClick={() => void onSyncNow()} disabled={isSyncing}>
          {isSyncing ? "Syncing..." : "Initial Pull"}
        </button>
      </div>

      <p className="subtle-text">
        Thread: <strong>{threadId}</strong>
      </p>
      <p className="subtle-text">
        Last applied cursor: <strong>{lastAppliedCursor ?? "none"}</strong>
      </p>
      <p className="subtle-text">
        Server time: <strong>{lastServerTimeUtc ?? "unknown"}</strong>
      </p>

      {syncError ? <p className="error-text">{syncError}</p> : null}

      {operations.length === 0 ? (
        <p className="subtle-text">No sync operations yet.</p>
      ) : (
        <ul className="timeline-list">
          {operations.map((operation) => (
            <li key={operation.id} className="timeline-item">
              <header>
                <strong>
                  {operation.operation}: {operation.path}
                </strong>
                <span className={`status-pill ${operation.status}`}>{operation.status}</span>
              </header>
              <p className="subtle-text">Retries: {operation.retryCount}</p>
              {operation.detail ? <p className="error-text">{operation.detail}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
