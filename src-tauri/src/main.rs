// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem};

const WIX_API_BASE: &str = "https://www.wixapis.com";
const WIX_COLLECTION_ID: &str = "Horses";

// ── Horse data types ─────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Horse {
    pub id: String,
    pub name: String,
    pub breed: String,
    pub age: u32,
    pub color: String,
    pub owner: String,
    pub medical_notes: String,
    pub last_vet_visit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birth_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gender: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub microchip_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_image: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered: Option<bool>,
}

// ── Wix API response types ───────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WixDataItem {
    #[serde(rename = "_id")]
    id: Option<String>,
    data: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WixQueryResponse {
    data_items: Option<Vec<WixDataItem>>,
}

#[derive(Debug, Deserialize)]
struct WixErrorDetail {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WixError {
    message: Option<String>,
    details: Option<WixErrorDetail>,
}

// ── Helper ───────────────────────────────────────────────────────────────────

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .build()
        .map_err(|e| e.to_string())
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Push all local horses to the Wix "Horses" CMS collection (bulk upsert).
/// Returns a summary string on success, or an error message.
#[tauri::command]
async fn wix_push_horses(token: String, horses: Vec<Horse>) -> Result<String, String> {
    let client = build_client()?;

    // Build data items for bulk save
    let data_items: Vec<serde_json::Value> = horses
        .iter()
        .map(|h| {
            serde_json::json!({
                "dataItem": {
                    "_id": h.id,
                    "data": {
                        "name": h.name,
                        "breed": h.breed,
                        "age": h.age,
                        "color": h.color,
                        "owner": h.owner,
                        "medicalNotes": h.medical_notes,
                        "lastVetVisit": h.last_vet_visit,
                        "birthDate": h.birth_date,
                        "gender": h.gender,
                        "status": h.status,
                        "microchipId": h.microchip_id,
                        "profileImage": h.profile_image,
                        "registered": h.registered,
                    }
                }
            })
        })
        .collect();

    let body = serde_json::json!({
        "dataCollectionId": WIX_COLLECTION_ID,
        "dataItems": data_items
    });

    let url = format!("{}/wix-data/v2/items/bulk-save", WIX_API_BASE);

    let response = client
        .post(&url)
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if status.is_success() {
        Ok(format!("Pushed {} horses to Wix successfully.", horses.len()))
    } else {
        // Try to parse Wix error
        let msg = serde_json::from_str::<WixError>(&text)
            .ok()
            .and_then(|e| e.message.or_else(|| e.details.and_then(|d| d.message)))
            .unwrap_or_else(|| format!("HTTP {}: {}", status, text));
        Err(msg)
    }
}

/// Pull all horses from the Wix "Horses" CMS collection.
/// Returns a JSON array of Horse objects.
#[tauri::command]
async fn wix_pull_horses(token: String) -> Result<Vec<serde_json::Value>, String> {
    let client = build_client()?;

    let body = serde_json::json!({
        "dataCollectionId": WIX_COLLECTION_ID,
        "query": {
            "paging": { "limit": 1000 }
        }
    });

    let url = format!("{}/wix-data/v2/items/query", WIX_API_BASE);

    let response = client
        .post(&url)
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let msg = serde_json::from_str::<WixError>(&text)
            .ok()
            .and_then(|e| e.message.or_else(|| e.details.and_then(|d| d.message)))
            .unwrap_or_else(|| format!("HTTP {}: {}", status, text));
        return Err(msg);
    }

    let parsed: WixQueryResponse =
        serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;

    let items: Vec<serde_json::Value> = parsed
        .data_items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            let mut data = item.data?;
            // Inject Wix _id back as "id"
            if let Some(id) = item.id {
                data["id"] = serde_json::Value::String(id);
            }
            Some(data)
        })
        .collect();

    Ok(items)
}

/// Ensure the "Horses" collection exists in the Wix CMS.
/// Creates it if missing; no-ops if it already exists.
#[tauri::command]
async fn wix_ensure_collection(token: String) -> Result<String, String> {
    let client = build_client()?;

    // Check if collection exists
    let query_url = format!("{}/wix-data/v2/collections/query", WIX_API_BASE);
    let check_body = serde_json::json!({
        "query": {
            "filter": {
                "fieldName": "_id",
                "eq": { "$value": WIX_COLLECTION_ID }
            }
        }
    });

    let check_resp = client
        .post(&query_url)
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .json(&check_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if check_resp.status().is_success() {
        let body: serde_json::Value = check_resp
            .json()
            .await
            .map_err(|e| e.to_string())?;
        if body["collections"]
            .as_array()
            .map(|a| !a.is_empty())
            .unwrap_or(false)
        {
            return Ok("Collection already exists.".into());
        }
    }

    // Create collection
    let create_url = format!("{}/wix-data/v2/collections", WIX_API_BASE);
    let create_body = serde_json::json!({
        "collection": {
            "_id": WIX_COLLECTION_ID,
            "displayName": "Horses",
            "fields": [
                { "key": "name",         "displayName": "Name",           "type": "TEXT" },
                { "key": "breed",        "displayName": "Breed",          "type": "TEXT" },
                { "key": "age",          "displayName": "Age",            "type": "NUMBER" },
                { "key": "color",        "displayName": "Color",          "type": "TEXT" },
                { "key": "owner",        "displayName": "Owner",          "type": "TEXT" },
                { "key": "medicalNotes", "displayName": "Medical Notes",  "type": "TEXT" },
                { "key": "lastVetVisit", "displayName": "Last Vet Visit", "type": "TEXT" },
                { "key": "birthDate",    "displayName": "Birth Date",     "type": "TEXT" },
                { "key": "gender",       "displayName": "Gender",         "type": "TEXT" },
                { "key": "status",       "displayName": "Status",         "type": "TEXT" },
                { "key": "microchipId",  "displayName": "Microchip ID",   "type": "TEXT" },
                { "key": "registered",   "displayName": "Registered",     "type": "BOOLEAN" }
            ]
        }
    });

    let create_resp = client
        .post(&create_url)
        .header("Authorization", &token)
        .header("Content-Type", "application/json")
        .json(&create_body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let create_status = create_resp.status();
    let create_text = create_resp.text().await.map_err(|e| e.to_string())?;

    if create_status.is_success() {
        Ok("Collection created successfully.".into())
    } else {
        let msg = serde_json::from_str::<WixError>(&create_text)
            .ok()
            .and_then(|e| e.message)
            .unwrap_or_else(|| format!("HTTP {}: {}", create_status, create_text));
        Err(msg)
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let quit = CustomMenuItem::new("quit".to_string(), "Quit XBAR");
    let show = CustomMenuItem::new("show".to_string(), "Show App");

    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| {
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                match id.as_str() {
                    "quit" => std::process::exit(0),
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            wix_push_horses,
            wix_pull_horses,
            wix_ensure_collection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running XBAR LLC application");
}
