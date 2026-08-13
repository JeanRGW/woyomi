package app.rgw.woyomi

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  private var safeTop = 0f
  private var safeBottom = 0f
  private var safeLeft = 0f
  private var safeRight = 0f

  private inner class SafeAreaBridge {
    @JavascriptInterface
    @Synchronized
    fun get(): String =
      "{\"top\":$safeTop,\"bottom\":$safeBottom,\"left\":$safeLeft,\"right\":$safeRight}"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)

    // Android WebView never populates CSS env(safe-area-inset-*), so bridge the
    // real insets (status bar + display cutout) into CSS custom properties.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _, insets ->
      val systemBars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      // CSS px == dp; convert physical px so the stylesheet can use the value directly.
      val density = resources.displayMetrics.density
      safeTop = systemBars.top / density
      safeBottom = systemBars.bottom / density
      safeLeft = systemBars.left / density
      safeRight = systemBars.right / density
      injectSafeArea(webView)
      insets
    }

    webView.addJavascriptInterface(SafeAreaBridge(), "woyomiInsets")

    if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      WebViewCompat.addDocumentStartJavaScript(webView, safeAreaScript(), setOf("*"))
    }
    ViewCompat.requestApplyInsets(webView)
  }

  private fun safeAreaScript(): String = """
    (function() {
      function apply() {
        try {
          var insets = JSON.parse(window.woyomiInsets.get());
          var style = document.documentElement.style;
          style.setProperty('--sat', insets.top + 'px');
          style.setProperty('--sab', insets.bottom + 'px');
          style.setProperty('--sal', insets.left + 'px');
          style.setProperty('--sar', insets.right + 'px');
        } catch (error) {}
      }
      if (document.readyState === 'loading') {
        window.addEventListener('load', apply, { once: true });
      } else {
        apply();
      }
    })();
  """.trimIndent()

  private fun injectSafeArea(webView: WebView) {
    webView.evaluateJavascript("""
      (function() {
        var style = document.documentElement.style;
        style.setProperty('--sat', '${safeTop}px');
        style.setProperty('--sab', '${safeBottom}px');
        style.setProperty('--sal', '${safeLeft}px');
        style.setProperty('--sar', '${safeRight}px');
      })();
    """.trimIndent(), null)
  }
}
