import { AuthPanel } from "./components/AuthPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ProfileManager } from "./components/ProfileManager";
import { ThreadWorkspacePanel } from "./components/ThreadWorkspacePanel";
import { useProfiles } from "./hooks/useProfiles";
import { useThreadWorkspace } from "./hooks/useThreadWorkspace";

function App() {
  const {
    profiles,
    selectedProfile,
    selectedProfileId,
    createProfile,
    updateProfile,
    deleteProfile,
    selectProfile
  } = useProfiles();
  const {
    threads,
    selectedThreadId,
    selectedWorkspace,
    isEnsuringWorkspace,
    workspaceError,
    addThread,
    selectThread
  } = useThreadWorkspace();

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Ken Desktop POC</h1>
        <div className="active-profile-banner">
          Active: <strong>{selectedProfile?.name ?? "None"}</strong>
          <span>{selectedProfile?.baseUrl ?? "No endpoint selected"}</span>
          <span>Thread: {selectedThreadId}</span>
        </div>
      </header>

      <main className="layout">
        <aside className="sidebar">
          <ProfileManager
            profiles={profiles}
            selectedProfileId={selectedProfileId}
            onSelect={selectProfile}
            onCreate={createProfile}
            onUpdate={updateProfile}
            onDelete={deleteProfile}
          />
          <AuthPanel profile={selectedProfile} />
          <ThreadWorkspacePanel
            threads={threads}
            selectedThreadId={selectedThreadId}
            selectedWorkspacePath={selectedWorkspace?.threadPath ?? null}
            rootPathHint={selectedWorkspace?.rootPath ?? "~/Executive Assistant/Ken"}
            isEnsuringWorkspace={isEnsuringWorkspace}
            workspaceError={workspaceError}
            onAddThread={addThread}
            onSelectThread={selectThread}
          />
        </aside>
        <section className="content">
          <ChatPanel profile={selectedProfile} threadId={selectedThreadId} />
        </section>
      </main>
    </div>
  );
}

export default App;
