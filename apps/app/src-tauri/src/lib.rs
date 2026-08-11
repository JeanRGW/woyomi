use serde::{Deserialize, Serialize};
use std::io::Read;
use std::sync::OnceLock;

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
async fn fetch_url(
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
        .header("user-agent", "woyomi/0.1 (+native)")
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

/// Base URL of the localhost media-stream proxy. The player points the <video>
/// at `{base}/stream?url=...&headers=...` so header-gated streams (e.g. animefire's
/// Referer) play; the proxy forwards Range for seeking.
#[tauri::command]
fn stream_proxy_base() -> String {
    format!("http://127.0.0.1:{}", stream_proxy_port())
}

#[derive(Default)]
pub struct AppState {
    pub client: reqwest::Client,
}

/// Ephemeral localhost HTTP proxy that streams media with custom headers (e.g.
/// the Referer animefire requires) and forwards Range so the <video> can seek.
/// Bound to 127.0.0.1 on an ephemeral port; started on first use.
fn stream_proxy_port() -> &'static u16 {
    static PORT: OnceLock<u16> = OnceLock::new();
    PORT.get_or_init(|| {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("failed to bind stream proxy");
        let port = server.server_addr().to_ip().expect("stream proxy not IP").port();
        std::thread::spawn(move || serve_streams(server));
        port
    })
}

fn serve_streams(server: tiny_http::Server) {
    // No total timeout on the proxy client — a 122MB stream must not be aborted
    // mid-download like the 15s fetch_url client would.
    let client = reqwest::blocking::Client::builder().build().expect("failed to build stream proxy client");
    for request in server.incoming_requests() {
        let client = client.clone();
        let _ = std::thread::spawn(move || {
            if let Err(e) = proxy_one(&client, request) {
                eprintln!("stream proxy: {e}");
            }
        });
    }
}

fn proxy_one(client: &reqwest::blocking::Client, request: tiny_http::Request) -> Result<(), String> {
    // tiny_http gives the path+query (relative); parse against a dummy base so
    // the query string (url + headers) is reachable.
    let parsed = url::Url::parse(&format!("http://127.0.0.1{}", request.url())).map_err(|e| format!("bad request url: {e}"))?;
    let target = parsed
        .query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())
        .ok_or("missing url param")?;
    let headers = parsed
        .query_pairs()
        .find(|(k, _)| k == "headers")
        .map(|(_, v)| serde_json::from_str::<std::collections::HashMap<String, String>>(v.as_ref()))
        .transpose()
        .map_err(|e| format!("bad headers param: {e}"))?
        .unwrap_or_default();

    let mut builder = client.get(&target);
    for (k, v) in headers {
        builder = builder.header(k, v);
    }
    // Forward Range so seeking works on the proxy URL.
    if let Some(range) = request.headers().iter().find(|h| h.field.equiv("Range")) {
        let value = range.value.as_str().to_string();
        if !value.is_empty() {
            builder = builder.header("Range", value);
        }
    }

    let resp = builder.send().map_err(|e| format!("upstream request failed: {e}"))?;
    let status = resp.status();

    let mut response = tiny_http::Response::empty(status.as_u16());
    // Forward length/range headers so the media element can seek.
    for name in ["content-type", "content-length", "content-range", "accept-ranges"] {
        if let Some(v) = resp.headers().get(name) {
            if let Ok(s) = v.to_str() {
                let hdr = tiny_http::Header::from_bytes(name.as_bytes(), s.as_bytes())
                    .map_err(|e| format!("bad {name} header: {e:?}"))?;
                response = response.with_header(hdr);
            }
        }
    }

    struct UpstreamBody(reqwest::blocking::Response);
    impl Read for UpstreamBody {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.0.read(buf)
        }
    }

    let stream = UpstreamBody(resp);
    request.respond(response.with_data(stream, None)).map_err(|e| format!("respond: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(AppState {
            client: reqwest::Client::builder()
                .user_agent("woyomi/0.1 (+native)")
                .timeout(std::time::Duration::from_secs(15))
                .build()
                .expect("failed to build http client"),
        })
        .invoke_handler(tauri::generate_handler![fetch_url, stream_proxy_base])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
