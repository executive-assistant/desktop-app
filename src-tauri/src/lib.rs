use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const KEYCHAIN_SERVICE: &str = "ken-desktop";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthTokens {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadWorkspaceInfo {
    thread_id: String,
    root_path: String,
    thread_path: String,
    created: bool,
}

fn account_name(profile_id: &str, token_kind: &str) -> String {
    format!("{profile_id}:{token_kind}")
}

fn normalize_token(token: &str) -> Option<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

fn normalize_thread_id(thread_id: &str) -> Option<String> {
    let trimmed = thread_id.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.to_ascii_lowercase();
    if normalized.chars().all(|character| {
        character.is_ascii_alphanumeric()
            || character == '-'
            || character == '_'
            || character == '.'
    }) {
        Some(normalized)
    } else {
        None
    }
}

fn home_directory() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "Unable to resolve user home directory.".to_string())
}

fn workspace_root_path(home_directory: &Path) -> PathBuf {
    home_directory.join("Executive Assistant").join("Ken")
}

fn workspace_create_error(path: &Path, error: std::io::Error) -> String {
    let base = format!("Unable to create workspace at {}: {error}", path.display());
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        format!("{base}. Grant Files and Folders access to Ken Desktop in System Settings and ensure ~/Executive Assistant/Ken is writable.")
    } else {
        base
    }
}

fn keychain_entry(profile_id: &str, token_kind: &str) -> Result<Entry, String> {
    let account = account_name(profile_id, token_kind);
    Entry::new(KEYCHAIN_SERVICE, &account)
        .map_err(|error| format!("Unable to access keychain entry: {error}"))
}

fn is_missing_keychain_entry(error: &KeyringError) -> bool {
    let rendered = error.to_string().to_ascii_lowercase();
    rendered.contains("no entry") || rendered.contains("item not found")
}

fn delete_if_present(entry: &Entry) -> Result<(), String> {
    match entry.delete_password() {
        Ok(()) => Ok(()),
        Err(error) if is_missing_keychain_entry(&error) => Ok(()),
        Err(error) => Err(format!("Unable to clear keychain entry: {error}")),
    }
}

#[tauri::command]
fn save_auth_tokens(
    profile_id: String,
    access_token: String,
    refresh_token: Option<String>,
) -> Result<(), String> {
    let normalized_access_token =
        normalize_token(&access_token).ok_or_else(|| "Access token is required.".to_string())?;

    let access_entry = keychain_entry(&profile_id, "access")?;
    access_entry
        .set_password(&normalized_access_token)
        .map_err(|error| format!("Unable to save access token: {error}"))?;

    let refresh_entry = keychain_entry(&profile_id, "refresh")?;
    match refresh_token {
        Some(value) => match normalize_token(&value) {
            Some(normalized_refresh_token) => refresh_entry
                .set_password(&normalized_refresh_token)
                .map_err(|error| format!("Unable to save refresh token: {error}"))?,
            None => delete_if_present(&refresh_entry)?,
        },
        None => delete_if_present(&refresh_entry)?,
    }

    Ok(())
}

#[tauri::command]
fn load_auth_tokens(profile_id: String) -> Result<Option<AuthTokens>, String> {
    let access_entry = keychain_entry(&profile_id, "access")?;
    let access_token = match access_entry.get_password() {
        Ok(value) => value,
        Err(error) if is_missing_keychain_entry(&error) => return Ok(None),
        Err(error) => return Err(format!("Unable to read access token: {error}")),
    };

    let refresh_entry = keychain_entry(&profile_id, "refresh")?;
    let refresh_token = match refresh_entry.get_password() {
        Ok(value) => Some(value),
        Err(error) if is_missing_keychain_entry(&error) => None,
        Err(error) => return Err(format!("Unable to read refresh token: {error}")),
    };

    Ok(Some(AuthTokens {
        access_token,
        refresh_token,
    }))
}

#[tauri::command]
fn clear_auth_tokens(profile_id: String) -> Result<(), String> {
    let access_entry = keychain_entry(&profile_id, "access")?;
    delete_if_present(&access_entry)?;

    let refresh_entry = keychain_entry(&profile_id, "refresh")?;
    delete_if_present(&refresh_entry)?;

    Ok(())
}

#[tauri::command]
fn ensure_thread_workspace(thread_id: String) -> Result<ThreadWorkspaceInfo, String> {
    let normalized_thread_id = normalize_thread_id(&thread_id).ok_or_else(|| {
        "Thread ID is required and can only contain letters, numbers, '.', '_' or '-'.".to_string()
    })?;

    let home = home_directory()?;
    let root_path = workspace_root_path(&home);
    let thread_path = root_path.join(&normalized_thread_id);
    let already_exists = thread_path.exists();

    fs::create_dir_all(&thread_path)
        .map_err(|error| workspace_create_error(&thread_path, error))?;

    Ok(ThreadWorkspaceInfo {
        thread_id: normalized_thread_id,
        root_path: root_path.to_string_lossy().to_string(),
        thread_path: thread_path.to_string_lossy().to_string(),
        created: !already_exists,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_auth_tokens,
            load_auth_tokens,
            clear_auth_tokens,
            ensure_thread_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        account_name, normalize_thread_id, normalize_token, workspace_create_error,
        workspace_root_path,
    };
    use std::path::Path;

    #[test]
    fn account_name_is_stable() {
        assert_eq!(account_name("thread-1", "access"), "thread-1:access");
    }

    #[test]
    fn normalize_token_trims_and_accepts_content() {
        assert_eq!(
            normalize_token("  token-value  ").expect("token should be valid"),
            "token-value"
        );
    }

    #[test]
    fn normalize_token_rejects_empty_input() {
        assert!(normalize_token("   ").is_none());
    }

    #[test]
    fn normalize_thread_id_accepts_allowed_characters() {
        assert_eq!(
            normalize_thread_id("Thread-01_alpha.sample").expect("thread id should be valid"),
            "thread-01_alpha.sample"
        );
    }

    #[test]
    fn normalize_thread_id_rejects_invalid_characters() {
        assert!(normalize_thread_id("thread with spaces").is_none());
        assert!(normalize_thread_id("thread/child").is_none());
    }

    #[test]
    fn workspace_root_path_targets_executive_assistant_directory() {
        let path = workspace_root_path(Path::new("/Users/tester"));
        assert_eq!(
            path.to_string_lossy(),
            "/Users/tester/Executive Assistant/Ken"
        );
    }

    #[test]
    fn workspace_create_error_includes_permission_guidance() {
        let error = workspace_create_error(
            Path::new("/Users/tester/Executive Assistant/Ken/thread-1"),
            std::io::Error::from(std::io::ErrorKind::PermissionDenied),
        );

        assert!(error.contains("Grant Files and Folders access"));
        assert!(error.contains("System Settings"));
    }
}
