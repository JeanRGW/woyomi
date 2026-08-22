package app.rgw.woyomi

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import org.json.JSONTokener

object AndroidDomRenderer {
    @JvmStatic
    external fun onDomResult(id: Long, html: String?, error: String?)

    @JvmStatic
    fun renderDom(activity: Activity, id: Long, url: String, waitFor: String?) {
        activity.runOnUiThread {
            try {
                val webView = WebView(activity.applicationContext)
                val settings = webView.settings
                settings.javaScriptEnabled = true
                settings.domStorageEnabled = true
                settings.userAgentString = "woyomi/0.1 (+native)"

                val handler = Handler(Looper.getMainLooper())
                var completed = false

                val timeoutRunnable = Runnable {
                    if (!completed) {
                        completed = true
                        try {
                            webView.stopLoading()
                            webView.destroy()
                        } catch (_: Exception) {}
                        onDomResult(id, null, "DOM page rendering timed out")
                    }
                }
                handler.postDelayed(timeoutRunnable, 15000)

                fun finishWithSuccess(html: String) {
                    if (completed) return
                    completed = true
                    handler.removeCallbacks(timeoutRunnable)
                    try {
                        webView.destroy()
                    } catch (_: Exception) {}
                    onDomResult(id, html, null)
                }

                fun finishWithError(error: String) {
                    if (completed) return
                    completed = true
                    handler.removeCallbacks(timeoutRunnable)
                    try {
                        webView.destroy()
                    } catch (_: Exception) {}
                    onDomResult(id, null, error)
                }

                fun takeSnapshot() {
                    val script = "document.documentElement ? document.documentElement.outerHTML : ''"
                    webView.evaluateJavascript(script) { jsonResult ->
                        if (completed) return@evaluateJavascript
                        try {
                            val tokener = JSONTokener(jsonResult ?: "")
                            val value = tokener.nextValue()
                            val html = if (value is String) value else jsonResult ?: ""
                            finishWithSuccess(html)
                        } catch (e: Exception) {
                            finishWithError("evaluate DOM: ${e.message}")
                        }
                    }
                }

                fun pollSelector(selector: String) {
                    val escapedSelector = JSONObject.quote(selector)
                    val script = "(() => { try { return !!document.querySelector($escapedSelector); } catch (e) { return false; } })()"
                    webView.evaluateJavascript(script) { result ->
                        if (completed) return@evaluateJavascript
                        if (result == "true") {
                            takeSnapshot()
                        } else {
                            handler.postDelayed({
                                if (!completed) {
                                    pollSelector(selector)
                                }
                            }, 100)
                        }
                    }
                }

                webView.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, finishedUrl: String?) {
                        super.onPageFinished(view, finishedUrl)
                        if (completed) return

                        handler.postDelayed({
                            if (completed) return@postDelayed
                            if (!waitFor.isNullOrEmpty()) {
                                pollSelector(waitFor)
                            } else {
                                takeSnapshot()
                            }
                        }, 350)
                    }

                    override fun onReceivedError(
                        view: WebView?,
                        request: WebResourceRequest?,
                        error: WebResourceError?
                    ) {
                        super.onReceivedError(view, request, error)
                        if (request?.isForMainFrame == true && !completed) {
                            finishWithError("load DOM page: ${error?.description ?: "unknown error"}")
                        }
                    }
                }

                webView.loadUrl(url)
            } catch (e: Exception) {
                onDomResult(id, null, "start DOM navigation: ${e.message}")
            }
        }
    }
}
