import { FormEvent, useState } from "react";

type ThreadWorkspacePanelProps = {
  threads: string[];
  selectedThreadId: string;
  selectedWorkspacePath: string | null;
  rootPathHint: string;
  isEnsuringWorkspace: boolean;
  workspaceError: string | null;
  onAddThread: (threadId: string) => string | null;
  onSelectThread: (threadId: string) => void;
};

export function ThreadWorkspacePanel({
  threads,
  selectedThreadId,
  selectedWorkspacePath,
  rootPathHint,
  isEnsuringWorkspace,
  workspaceError,
  onAddThread,
  onSelectThread
}: ThreadWorkspacePanelProps) {
  const [draftThreadId, setDraftThreadId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const error = onAddThread(draftThreadId);
    if (error) {
      setFormError(error);
      return;
    }
    setDraftThreadId("");
    setFormError(null);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Thread Workspaces</h2>
      </div>

      <p className="subtle-text">
        Root folder: <strong>{rootPathHint}</strong>
      </p>

      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          Thread ID
          <input
            value={draftThreadId}
            onChange={(event) => setDraftThreadId(event.target.value)}
            placeholder="thread-2026-01"
          />
        </label>
        {formError ? <p className="error-text">{formError}</p> : null}
        <div className="form-actions">
          <button type="submit">Add Thread</button>
        </div>
      </form>

      <ul className="profile-list">
        {threads.map((threadId) => {
          const isActive = threadId === selectedThreadId;
          return (
            <li key={threadId} className={isActive ? "profile-item active" : "profile-item"}>
              <div className="profile-meta">
                <strong>{threadId}</strong>
              </div>
              <div className="profile-actions">
                <button type="button" onClick={() => onSelectThread(threadId)} disabled={isActive}>
                  {isActive ? "Active" : "Select"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="subtle-text">
        Workspace: <strong>{selectedWorkspacePath ?? "Pending..."}</strong>
      </p>
      {isEnsuringWorkspace ? <p className="subtle-text">Provisioning workspace...</p> : null}
      {workspaceError ? <p className="error-text">{workspaceError}</p> : null}
    </section>
  );
}
