use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchArgs {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    /// not yet implemented: load the page with JS and return serialized DOM
    #[serde(default)]
    pub dom: bool,
}

fn default_method() -> String {
    "GET".to_string()
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub status: u16,
    pub headers: std::collections::HashMap<String, String>,
    pub body: String,
}

/// CORS-free fetch for plugins. Runs server-side in the native shell, so source
/// sites can be reached without a proxy. `mode:'dom'` is a stub for future
/// headless rendering (returns a 501-style payload).
#[tauri::command]
pub async fn fetch_url(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    args: FetchArgs,
) -> Result<FetchResult, String> {
    if args.dom {
        return Err("fetch_url mode=dom is not implemented yet".to_string());
    }

    let client = &state.client;
    let mut req = client
        .request(reqwest::Method::from_bytes(args.method.as_bytes()).map_err(|e| e.to_string())?, &args.url)
        .header("user-agent", "media-platform/0.1 (+native)")
        .header("accept", "*/*");

    for (k, v) in &args.headers {
        req = req.header(k, v);
    }
    if let Some(b) = &args.body {
        req = req.body(b.clone());
    }

    let resp = req.send().await.map_err(|e| format!("fetch failed: {e}"))?;
    let status = resp.status().as_u16();
    let mut headers = std::collections::HashMap::new();
    for (k, v) in resp.headers() {
        if let Ok(hv) = v.to_str() {
            headers.insert(k.to_string(), hv.to_string());
        }
    }
    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    if status >= 500 {
        // keep the plugin error path simple; still deliver status
    }
    let _ = app;
    Ok(FetchResult { status, headers, body })
}

#[derive(Default)]
pub struct AppState {
    pub client: reqwest::Client,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(AppState {
            client: reqwest::Client::builder()
                .user_agent("media-platform/0.1 (+native)")
                .build()
                .expect("failed to build http client"),
        })
        .invoke_handler(tauri::generate_handler![fetch_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
