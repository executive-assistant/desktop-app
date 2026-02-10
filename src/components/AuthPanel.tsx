import { FormEvent, useCallback, useEffect, useState } from "react";
import { invokeSafe } from "../lib/tauri";
import type { AuthTokens, ConnectionProfile } from "../types";

type AuthPanelProps = {
  profile: ConnectionProfile | undefined;
};

export function AuthPanel({ profile }: AuthPanelProps) {
  const [accessToken, setAccessToken] = useState("");
  const [refreshToken, setRefreshToken] = useState("");
  const [hasStoredTokens, setHasStoredTokens] = useState(false);
  const [statusText, setStatusText] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const refreshTokenStatus = useCallback(async () => {
    if (!profile) {
      setHasStoredTokens(false);
      return;
    }

    try {
      const tokens = await invokeSafe<AuthTokens | null>("load_auth_tokens", {
        profileId: profile.id
      });
      setHasStoredTokens(Boolean(tokens?.accessToken));
    } catch {
      setHasStoredTokens(false);
      setStatusText("Unable to read token status.");
    }
  }, [profile]);

  useEffect(() => {
    void refreshTokenStatus();
  }, [refreshTokenStatus]);

  const onSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!profile) {
      return;
    }

    if (!accessToken.trim()) {
      setStatusText("Access token is required.");
      return;
    }

    setIsSaving(true);
    setStatusText("");

    try {
      await invokeSafe("save_auth_tokens", {
        profileId: profile.id,
        accessToken: accessToken.trim(),
        refreshToken: refreshToken.trim() ? refreshToken.trim() : null
      });
      setHasStoredTokens(true);
      setAccessToken("");
      setRefreshToken("");
      setStatusText("Tokens saved.");
    } catch {
      setStatusText("Failed to save tokens.");
    } finally {
      setIsSaving(false);
    }
  };

  const onLogout = async () => {
    if (!profile) {
      return;
    }

    setStatusText("");
    try {
      await invokeSafe("clear_auth_tokens", { profileId: profile.id });
      setHasStoredTokens(false);
      setAccessToken("");
      setRefreshToken("");
      setStatusText("Tokens cleared.");
    } catch {
      setStatusText("Failed to clear tokens.");
    }
  };

  return (
    <section className="panel">
      <h2>Auth Session</h2>
      <p className="subtle-text">
        Profile: <strong>{profile?.name ?? "None selected"}</strong>
      </p>
      <p className="subtle-text">
        Stored token status: <strong>{hasStoredTokens ? "Present" : "Missing"}</strong>
      </p>

      <form className="form-grid" onSubmit={onSave}>
        <label>
          Access Token
          <input
            type="password"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            placeholder="Paste access token"
            autoComplete="off"
          />
        </label>
        <label>
          Refresh Token (optional)
          <input
            type="password"
            value={refreshToken}
            onChange={(event) => setRefreshToken(event.target.value)}
            placeholder="Paste refresh token"
            autoComplete="off"
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={isSaving || !profile}>
            {isSaving ? "Saving..." : "Save Tokens"}
          </button>
          <button type="button" onClick={onLogout} disabled={!profile}>
            Logout
          </button>
        </div>
      </form>

      {statusText ? <p className="subtle-text">{statusText}</p> : null}
    </section>
  );
}
