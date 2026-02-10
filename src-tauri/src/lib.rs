use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};

const KEYCHAIN_SERVICE: &str = "ken-desktop";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthTokens {
    access_token: String,
    refresh_token: Option<String>,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_auth_tokens,
            load_auth_tokens,
            clear_auth_tokens
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{account_name, normalize_token};

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
}
