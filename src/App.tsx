import { AuthPanel } from "./components/AuthPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ProfileManager } from "./components/ProfileManager";
import { useProfiles } from "./hooks/useProfiles";

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Ken Desktop POC</h1>
        <div className="active-profile-banner">
          Active: <strong>{selectedProfile?.name ?? "None"}</strong>
          <span>{selectedProfile?.baseUrl ?? "No endpoint selected"}</span>
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
        </aside>
        <section className="content">
          <ChatPanel profile={selectedProfile} />
        </section>
      </main>
    </div>
  );
}

export default App;

