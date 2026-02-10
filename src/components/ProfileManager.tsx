import { FormEvent, useMemo, useState } from "react";
import type { ConnectionProfile, NewProfileInput, ProfileKind } from "../types";

type ProfileManagerProps = {
  profiles: ConnectionProfile[];
  selectedProfileId: string;
  onSelect: (profileId: string) => void;
  onCreate: (input: NewProfileInput) => void;
  onUpdate: (profileId: string, input: NewProfileInput) => void;
  onDelete: (profileId: string) => void;
};

type DraftForm = {
  name: string;
  baseUrl: string;
  kind: ProfileKind;
};

const DEFAULT_DRAFT: DraftForm = {
  name: "",
  baseUrl: "https://",
  kind: "remote"
};

function toDraft(profile: ConnectionProfile): DraftForm {
  return {
    name: profile.name,
    baseUrl: profile.baseUrl,
    kind: profile.kind
  };
}

function validateDraft(draft: DraftForm): string | null {
  if (!draft.name.trim()) {
    return "Profile name is required.";
  }

  if (!draft.baseUrl.trim()) {
    return "Base URL is required.";
  }

  let parsed: URL;
  try {
    parsed = new URL(draft.baseUrl.trim());
  } catch {
    return "Base URL is invalid.";
  }

  if (draft.kind === "remote" && parsed.protocol !== "https:") {
    return "Remote profiles must use HTTPS.";
  }

  if (draft.kind === "local_dev") {
    const host = parsed.hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      return "Local Dev profiles must target localhost or 127.0.0.1.";
    }
  }

  return null;
}

export function ProfileManager({
  profiles,
  selectedProfileId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete
}: ProfileManagerProps) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftForm>(DEFAULT_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );

  const startCreate = () => {
    setEditingProfileId(null);
    setDraft(DEFAULT_DRAFT);
    setError(null);
  };

  const startEdit = (profile: ConnectionProfile) => {
    setEditingProfileId(profile.id);
    setDraft(toDraft(profile));
    setError(null);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateDraft(draft);
    if (validationError) {
      setError(validationError);
      return;
    }

    const input: NewProfileInput = {
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      kind: draft.kind
    };

    if (editingProfileId) {
      onUpdate(editingProfileId, input);
    } else {
      onCreate(input);
    }

    setEditingProfileId(null);
    setDraft(DEFAULT_DRAFT);
    setError(null);
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Connection Profiles</h2>
        <button type="button" onClick={startCreate}>
          New
        </button>
      </div>

      <ul className="profile-list">
        {profiles.map((profile) => {
          const isActive = profile.id === selectedProfileId;
          return (
            <li key={profile.id} className={isActive ? "profile-item active" : "profile-item"}>
              <div className="profile-meta">
                <strong>{profile.name}</strong>
                <span>{profile.baseUrl}</span>
              </div>
              <div className="profile-actions">
                <button type="button" onClick={() => onSelect(profile.id)} disabled={isActive}>
                  {isActive ? "Active" : "Select"}
                </button>
                <button type="button" onClick={() => startEdit(profile)}>
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(profile.id)}
                  disabled={profiles.length === 1}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form className="form-grid" onSubmit={onSubmit}>
        <h3>{editingProfileId ? "Edit Profile" : "Create Profile"}</h3>
        <label>
          Name
          <input
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="Remote VM"
          />
        </label>

        <label>
          Type
          <select
            value={draft.kind}
            onChange={(event) => {
              const nextKind = event.target.value as ProfileKind;
              setDraft((current) => ({
                ...current,
                kind: nextKind,
                baseUrl:
                  nextKind === "local_dev" && current.baseUrl === "https://"
                    ? "http://127.0.0.1:8000"
                    : current.baseUrl
              }));
            }}
          >
            <option value="remote">Remote</option>
            <option value="local_dev">Local Dev</option>
          </select>
        </label>

        <label>
          Base URL
          <input
            value={draft.baseUrl}
            onChange={(event) =>
              setDraft((current) => ({ ...current, baseUrl: event.target.value }))
            }
            placeholder="https://ken.example.com"
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <div className="form-actions">
          <button type="submit">{editingProfileId ? "Save" : "Create"}</button>
          {editingProfileId ? (
            <button
              type="button"
              onClick={() => {
                setEditingProfileId(null);
                setDraft(DEFAULT_DRAFT);
                setError(null);
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <p className="subtle-text">
        Active profile: <strong>{selectedProfile?.name ?? "None"}</strong>
      </p>
    </section>
  );
}

