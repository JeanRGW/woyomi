use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use tauri::Manager;
use tokio::io::AsyncWriteExt;
use tokio::sync::{watch, Mutex};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchArgs {
    pub url: String,
    #[serde(default = "default_method")]
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
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
    pub headers: HashMap<String, String>,
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
        .request(
            reqwest::Method::from_bytes(args.method.as_bytes()).map_err(|e| e.to_string())?,
            &args.url,
        )
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
    let mut headers = HashMap::new();
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
    Ok(FetchResult {
        status,
        headers,
        body,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartDownloadAssetArgs {
    file_id: String,
    index: u32,
    url: String,
    #[serde(default)]
    headers: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadAssetArgs {
    file_id: String,
    index: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveDownloadFilesArgs {
    file_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheCoverImageArgs {
    url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CachedCoverImage {
    file_hash: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadAssetStatus {
    state: DownloadState,
    downloaded_bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    content_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DownloadState {
    Downloading,
    Complete,
    Failed,
    Cancelled,
}

struct DownloadJob {
    status: DownloadAssetStatus,
    cancel: watch::Sender<bool>,
}

type DownloadKey = (String, u32);

pub struct AppState {
    pub client: reqwest::Client,
    download_client: reqwest::Client,
    jobs: Arc<Mutex<HashMap<DownloadKey, DownloadJob>>>,
}

fn validate_file_id(file_id: &str) -> Result<(), String> {
    if !file_id.is_empty()
        && file_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        Ok(())
    } else {
        Err("invalid fileId".to_string())
    }
}

fn downloads_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("downloads"))
        .map_err(|e| format!("resolve app local data directory: {e}"))
}

fn covers_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("covers"))
        .map_err(|e| format!("resolve app local data directory: {e}"))
}

fn cover_hash(url: &str) -> String {
    format!("{:x}", Sha256::digest(url.as_bytes()))
}

fn validate_cover_hash(hash: &str) -> Result<(), String> {
    if hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid cover hash".to_string())
    }
}

#[tauri::command]
async fn cache_cover_image(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    args: CacheCoverImageArgs,
) -> Result<CachedCoverImage, String> {
    let url = reqwest::Url::parse(&args.url).map_err(|e| format!("invalid cover url: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("cover url must use http or https".to_string());
    }
    let file_hash = cover_hash(&args.url);
    let root = covers_root(&app)?;
    let image_path = root.join(&file_hash);
    if tokio::fs::try_exists(&image_path)
        .await
        .map_err(|e| format!("check cached cover: {e}"))?
    {
        return Ok(CachedCoverImage { file_hash });
    }

    let response = state
        .client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("download cover: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("cover returned HTTP {}", response.status()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .filter(|value| value.starts_with("image/") && value.is_ascii() && !value.bytes().any(|byte| byte.is_ascii_control()))
        .unwrap_or("image/jpeg")
        .to_string();
    let body = response.bytes().await.map_err(|e| format!("read cover: {e}"))?;
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| format!("create covers directory: {e}"))?;
    tokio::fs::write(&image_path, body)
        .await
        .map_err(|e| format!("write cover: {e}"))?;
    tokio::fs::write(root.join(format!("{file_hash}.type")), content_type)
        .await
        .map_err(|e| format!("write cover content type: {e}"))?;
    Ok(CachedCoverImage { file_hash })
}

#[tauri::command]
async fn start_download_asset(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    args: StartDownloadAssetArgs,
) -> Result<(), String> {
    validate_file_id(&args.file_id)?;
    let url = reqwest::Url::parse(&args.url).map_err(|e| format!("invalid url: {e}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("url must use http or https".to_string());
    }

    let directory = downloads_root(&app)?.join(&args.file_id);
    let key = (args.file_id.clone(), args.index);
    let (cancel, cancelled) = watch::channel(false);
    let client = state.download_client.clone();
    let jobs = state.jobs.clone();
    let mut job_map = jobs.lock().await;
    if job_map
        .get(&key)
        .is_some_and(|job| job.status.state == DownloadState::Downloading)
    {
        return Err("asset is already downloading".to_string());
    }
    job_map.insert(
        key.clone(),
        DownloadJob {
            status: DownloadAssetStatus {
                state: DownloadState::Downloading,
                downloaded_bytes: 0,
                total_bytes: None,
                content_type: None,
                error: None,
            },
            cancel,
        },
    );
    drop(job_map);

    let part_path = directory.join(format!("{}.part", args.index));
    tauri::async_runtime::spawn(async move {
        if let Err(error) = download_asset(
            client,
            jobs.clone(),
            key.clone(),
            cancelled,
            url,
            args.headers,
            directory,
        )
        .await
        {
            let _ = tokio::fs::remove_file(&part_path).await;
            let mut jobs = jobs.lock().await;
            if let Some(job) = jobs.get_mut(&key) {
                if *job.cancel.borrow() {
                    job.status.state = DownloadState::Cancelled;
                    job.status.error = None;
                } else {
                    job.status.state = DownloadState::Failed;
                    job.status.error = Some(error);
                }
            }
        }
    });

    Ok(())
}

async fn download_asset(
    client: reqwest::Client,
    jobs: Arc<Mutex<HashMap<DownloadKey, DownloadJob>>>,
    key: DownloadKey,
    mut cancelled: watch::Receiver<bool>,
    url: reqwest::Url,
    headers: HashMap<String, String>,
    directory: PathBuf,
) -> Result<(), String> {
    let part_path = directory.join(format!("{}.part", key.1));
    let final_path = directory.join(key.1.to_string());
    let mut request = client.get(url);
    for (name, value) in headers {
        request = request.header(name, value);
    }
    let mut response = tokio::select! {
        result = request.send() => result.map_err(|e| format!("download failed: {e}"))?,
        _ = cancelled.changed() => return Err("download cancelled".to_string()),
    };
    if !response.status().is_success() {
        return Err(format!("download returned HTTP {}", response.status()));
    }

    let total_bytes = response.content_length();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    {
        let mut jobs = jobs.lock().await;
        if let Some(job) = jobs.get_mut(&key) {
            job.status.total_bytes = total_bytes;
            job.status.content_type = content_type;
        }
    }

    tokio::select! {
        result = tokio::fs::create_dir_all(&directory) => {
            result.map_err(|e| format!("create download directory: {e}"))?
        }
        _ = cancelled.changed() => return Err("download cancelled".to_string()),
    }
    let mut file = tokio::select! {
        result = tokio::fs::File::create(&part_path) => {
            result.map_err(|e| format!("create partial download: {e}"))?
        }
        _ = cancelled.changed() => return Err("download cancelled".to_string()),
    };
    loop {
        let chunk = tokio::select! {
            result = response.chunk() => result.map_err(|e| format!("read download: {e}"))?,
            _ = cancelled.changed() => return Err("download cancelled".to_string()),
        };
        let Some(chunk) = chunk else {
            break;
        };
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("write download: {e}"))?;
        let mut jobs = jobs.lock().await;
        if let Some(job) = jobs.get_mut(&key) {
            job.status.downloaded_bytes += chunk.len() as u64;
        }
    }
    if *cancelled.borrow() {
        return Err("download cancelled".to_string());
    }
    tokio::select! {
        result = file.flush() => result.map_err(|e| format!("flush download: {e}"))?,
        _ = cancelled.changed() => return Err("download cancelled".to_string()),
    }
    drop(file);
    if *cancelled.borrow() {
        return Err("download cancelled".to_string());
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("finish download: {e}"))?;

    let mut jobs = jobs.lock().await;
    if let Some(job) = jobs.get_mut(&key) {
        job.status.state = DownloadState::Complete;
    }
    Ok(())
}

#[tauri::command]
async fn download_asset_status(
    state: tauri::State<'_, AppState>,
    args: DownloadAssetArgs,
) -> Result<DownloadAssetStatus, String> {
    validate_file_id(&args.file_id)?;
    state
        .jobs
        .lock()
        .await
        .get(&(args.file_id, args.index))
        .map(|job| job.status.clone())
        .ok_or_else(|| "unknown download asset".to_string())
}

#[tauri::command]
async fn cancel_download_asset(
    state: tauri::State<'_, AppState>,
    args: DownloadAssetArgs,
) -> Result<(), String> {
    validate_file_id(&args.file_id)?;
    let jobs = state.jobs.lock().await;
    let job = jobs
        .get(&(args.file_id, args.index))
        .ok_or_else(|| "unknown download asset".to_string())?;
    if job.status.state == DownloadState::Downloading {
        let _ = job.cancel.send(true);
    }
    Ok(())
}

#[tauri::command]
async fn remove_download_files(
    app: tauri::AppHandle,
    args: RemoveDownloadFilesArgs,
) -> Result<(), String> {
    validate_file_id(&args.file_id)?;
    let directory = downloads_root(&app)?.join(args.file_id);
    match tokio::fs::remove_dir_all(directory).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("remove download files: {error}")),
    }
}

/// Base URL of the localhost media-stream proxy. The player points the <video>
/// at `{base}/stream?url=...&headers=...` so header-gated streams (e.g. animefire's
/// Referer) play; the proxy forwards Range for seeking.
#[tauri::command]
fn stream_proxy_base(app: tauri::AppHandle) -> Result<String, String> {
    Ok(format!(
        "http://127.0.0.1:{}",
        stream_proxy_port(downloads_root(&app)?)
    ))
}

/// Ephemeral localhost HTTP proxy that streams media with custom headers (e.g.
/// the Referer animefire requires) and forwards Range so the <video> can seek.
/// Bound to 127.0.0.1 on an ephemeral port; started on first use.
fn stream_proxy_port(downloads_root: PathBuf) -> &'static u16 {
    static PORT: OnceLock<u16> = OnceLock::new();
    PORT.get_or_init(|| {
        let server = tiny_http::Server::http("127.0.0.1:0").expect("failed to bind stream proxy");
        let port = server
            .server_addr()
            .to_ip()
            .expect("stream proxy not IP")
            .port();
        std::thread::spawn(move || serve_streams(server, downloads_root));
        port
    })
}

fn serve_streams(server: tiny_http::Server, downloads_root: PathBuf) {
    // No total timeout on the proxy client — a 122MB stream must not be aborted
    // mid-download like the 15s fetch_url client would.
    let client = reqwest::blocking::Client::builder()
        .build()
        .expect("failed to build stream proxy client");
    for request in server.incoming_requests() {
        let client = client.clone();
        let downloads_root = downloads_root.clone();
        let _ = std::thread::spawn(move || {
            let result = if request.url().starts_with("/offline/") {
                serve_offline(&downloads_root, request)
            } else if request.url().starts_with("/covers/") {
                serve_cover(&downloads_root, request)
            } else {
                proxy_one(&client, request)
            };
            if let Err(error) = result {
                eprintln!("stream proxy: {error}");
            }
        });
    }
}

fn serve_cover(downloads_root: &Path, request: tiny_http::Request) -> Result<(), String> {
    if !matches!(request.method(), tiny_http::Method::Get | tiny_http::Method::Head) {
        return request
            .respond(tiny_http::Response::empty(405))
            .map_err(|e| format!("respond: {e}"));
    }
    let parsed = match url::Url::parse(&format!("http://127.0.0.1{}", request.url())) {
        Ok(parsed) => parsed,
        Err(_) => return respond_empty(request, 404),
    };
    let mut segments = match parsed.path_segments() {
        Some(segments) => segments,
        None => return respond_empty(request, 404),
    };
    if segments.next() != Some("covers") {
        return respond_empty(request, 404);
    }
    let Some(hash) = segments.next() else {
        return respond_empty(request, 404);
    };
    if segments.next().is_some() || validate_cover_hash(hash).is_err() {
        return respond_empty(request, 404);
    }

    let covers_root = downloads_root.parent().ok_or("resolve covers root")?.join("covers");
    let image_path = covers_root.join(hash);
    let file = match std::fs::File::open(image_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return respond_empty(request, 404),
        Err(error) => return Err(format!("open cached cover: {error}")),
    };
    let content_type = std::fs::read_to_string(covers_root.join(format!("{hash}.type")))
        .ok()
        .filter(|value| value.starts_with("image/") && value.is_ascii() && !value.bytes().any(|byte| byte.is_ascii_control()))
        .unwrap_or_else(|| "image/jpeg".to_string());
    let length = file.metadata().map_err(|e| format!("stat cached cover: {e}"))?.len();
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(200),
        vec![response_header("Content-Type", &content_type)?],
        file,
        Some(usize::try_from(length).map_err(|_| "cached cover too large")?),
        None,
    );
    request.respond(response).map_err(|e| format!("respond: {e}"))
}

fn proxy_one(
    client: &reqwest::blocking::Client,
    request: tiny_http::Request,
) -> Result<(), String> {
    // tiny_http gives the path+query (relative); parse against a dummy base so
    // the query string (url + headers) is reachable.
    let parsed = url::Url::parse(&format!("http://127.0.0.1{}", request.url()))
        .map_err(|e| format!("bad request url: {e}"))?;
    let target = parsed
        .query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())
        .ok_or("missing url param")?;
    let headers = parsed
        .query_pairs()
        .find(|(k, _)| k == "headers")
        .map(|(_, v)| serde_json::from_str::<HashMap<String, String>>(v.as_ref()))
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

    let resp = builder
        .send()
        .map_err(|e| format!("upstream request failed: {e}"))?;
    let status = resp.status();

    let mut response = tiny_http::Response::empty(status.as_u16());
    // Forward length/range headers so the media element can seek.
    for name in [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
    ] {
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
    request
        .respond(response.with_data(stream, None))
        .map_err(|e| format!("respond: {e}"))
}

fn serve_offline(downloads_root: &Path, request: tiny_http::Request) -> Result<(), String> {
    if !matches!(
        request.method(),
        tiny_http::Method::Get | tiny_http::Method::Head
    ) {
        return request
            .respond(tiny_http::Response::empty(405))
            .map_err(|e| format!("respond: {e}"));
    }

    let parsed = match url::Url::parse(&format!("http://127.0.0.1{}", request.url())) {
        Ok(parsed) => parsed,
        Err(_) => return respond_empty(request, 404),
    };
    let mut segments = match parsed.path_segments() {
        Some(segments) => segments,
        None => return respond_empty(request, 404),
    };
    if segments.next() != Some("offline") {
        return respond_empty(request, 404);
    }
    let Some(file_id) = segments.next() else {
        return respond_empty(request, 404);
    };
    let Some(index) = segments.next().and_then(|value| value.parse::<u32>().ok()) else {
        return respond_empty(request, 404);
    };
    if segments.next().is_some() || validate_file_id(file_id).is_err() {
        return respond_empty(request, 404);
    }

    let path = downloads_root.join(file_id).join(index.to_string());
    let mut file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return respond_empty(request, 404)
        }
        Err(error) => return Err(format!("open offline file: {error}")),
    };
    let metadata = file
        .metadata()
        .map_err(|e| format!("stat offline file: {e}"))?;
    if !metadata.is_file() {
        return respond_empty(request, 404);
    }
    let file_len = metadata.len();
    let range_header = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Range"))
        .map(|header| header.value.as_str());
    let (status, start, end) = match range_header {
        Some(value) => match parse_range(value, file_len) {
            Some((start, end)) => (206, start, end),
            None => return respond_range_not_satisfiable(request, file_len),
        },
        None if file_len > 0 => (200, 0, file_len - 1),
        None => (200, 0, 0),
    };
    let content_len = if file_len == 0 { 0 } else { end - start + 1 };
    if start > 0 {
        file.seek(std::io::SeekFrom::Start(start))
            .map_err(|e| format!("seek offline file: {e}"))?;
    }

    let content_type = parsed
        .query_pairs()
        .find(|(key, _)| key == "type")
        .map(|(_, value)| value.into_owned())
        .filter(|value| {
            !value.is_empty()
                && value.is_ascii()
                && !value.bytes().any(|byte| byte.is_ascii_control())
                && value.contains('/')
        })
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let mut headers = vec![
        response_header("Content-Type", &content_type)?,
        response_header("Accept-Ranges", "bytes")?,
    ];
    if status == 206 {
        headers.push(response_header(
            "Content-Range",
            &format!("bytes {start}-{end}/{file_len}"),
        )?);
    }
    let data_length = usize::try_from(content_len).map_err(|_| "offline file too large")?;
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(status),
        headers,
        file.take(content_len),
        Some(data_length),
        None,
    );
    request
        .respond(response)
        .map_err(|e| format!("respond: {e}"))
}

fn response_header(name: &str, value: &str) -> Result<tiny_http::Header, String> {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
        .map_err(|_| format!("invalid {name} header"))
}

fn respond_empty(request: tiny_http::Request, status: u16) -> Result<(), String> {
    request
        .respond(tiny_http::Response::empty(status))
        .map_err(|e| format!("respond: {e}"))
}

fn respond_range_not_satisfiable(request: tiny_http::Request, file_len: u64) -> Result<(), String> {
    request
        .respond(
            tiny_http::Response::empty(416)
                .with_header(response_header(
                    "Content-Range",
                    &format!("bytes */{file_len}"),
                )?)
                .with_header(response_header("Accept-Ranges", "bytes")?),
        )
        .map_err(|e| format!("respond: {e}"))
}

fn parse_range(value: &str, file_len: u64) -> Option<(u64, u64)> {
    let (unit, range) = value.split_once('=')?;
    if !unit.eq_ignore_ascii_case("bytes") {
        return None;
    }
    if file_len == 0 || range.contains(',') {
        return None;
    }
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((file_len.saturating_sub(suffix), file_len - 1));
    }

    let start = start.parse::<u64>().ok()?;
    if start >= file_len {
        return None;
    }
    let end = if end.is_empty() {
        file_len - 1
    } else {
        end.parse::<u64>().ok()?.min(file_len - 1)
    };
    (start <= end).then_some((start, end))
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
            download_client: reqwest::Client::builder()
                .user_agent("woyomi/0.1 (+native)")
                .connect_timeout(std::time::Duration::from_secs(15))
                .read_timeout(std::time::Duration::from_secs(60))
                .build()
                .expect("failed to build download client"),
            jobs: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            fetch_url,
            start_download_asset,
            download_asset_status,
            cancel_download_asset,
            remove_download_files,
            stream_proxy_base,
            cache_cover_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{parse_range, validate_cover_hash, validate_file_id};

    #[test]
    fn validates_opaque_file_ids() {
        for valid in ["a", "ABC-123", "0"] {
            assert!(validate_file_id(valid).is_ok(), "{valid}");
        }
        for invalid in ["", "a_b", "../a", "a/b", "é", "a.b"] {
            assert!(validate_file_id(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn validates_cover_hashes() {
        assert!(validate_cover_hash(&"a".repeat(64)).is_ok());
        for invalid in ["", "a", &"g".repeat(64), &"a".repeat(63)] {
            assert!(validate_cover_hash(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn parses_single_byte_ranges() {
        assert_eq!(parse_range("bytes=2-5", 10), Some((2, 5)));
        assert_eq!(parse_range("BYTES=2-5", 10), Some((2, 5)));
        assert_eq!(parse_range("bytes=7-", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=-20", 10), Some((0, 9)));
        assert_eq!(parse_range("bytes=2-20", 10), Some((2, 9)));

        for invalid in [
            "items=0-1",
            "bytes=",
            "bytes=1",
            "bytes=5-2",
            "bytes=10-",
            "bytes=-0",
            "bytes=0-1,3-4",
        ] {
            assert_eq!(parse_range(invalid, 10), None, "{invalid}");
        }
        assert_eq!(parse_range("bytes=0-", 0), None);
    }
}
