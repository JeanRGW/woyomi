package app.rgw.woyomi

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.os.Bundle
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  private var safeTop = 0f
  private var safeBottom = 0f
  private var safeLeft = 0f
  private var safeRight = 0f

  private var isPlayerActive = false
  private var savedOrientation: Int? = null
  private var savedStatusBarsVisible: Boolean? = null
  private var savedNavigationBarsVisible: Boolean? = null
  private var savedSystemBarsBehavior: Int? = null
  private var isPlaying = false

  private inner class SafeAreaBridge {
    @JavascriptInterface
    @Synchronized
    fun get(): String =
      "{\"top\":$safeTop,\"bottom\":$safeBottom,\"left\":$safeLeft,\"right\":$safeRight}"
  }

  private inner class PlayerBridge {
    @JavascriptInterface
    fun enter(autoRotate: Boolean) {
      runOnUiThread {
        if (!isPlayerActive) {
          isPlayerActive = true
          savedOrientation = requestedOrientation
          val rootInsets = ViewCompat.getRootWindowInsets(window.decorView)
          savedStatusBarsVisible = rootInsets?.isVisible(WindowInsetsCompat.Type.statusBars()) ?: true
          savedNavigationBarsVisible =
            rootInsets?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true
        }

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        if (savedSystemBarsBehavior == null) {
          savedSystemBarsBehavior = insetsController.systemBarsBehavior
        }
        insetsController.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        insetsController.hide(WindowInsetsCompat.Type.systemBars())

        val config = resources.configuration
        val isTelevision =
          (config.uiMode and Configuration.UI_MODE_TYPE_MASK) == Configuration.UI_MODE_TYPE_TELEVISION
        val isPhone = config.smallestScreenWidthDp < 600 && !isTelevision

        if (isPhone) {
          if (autoRotate) {
            requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
          } else {
            savedOrientation?.let { requestedOrientation = it }
          }
        }

        if (isPlaying) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }

    @JavascriptInterface
    fun exit() {
      runOnUiThread {
        isPlaying = false
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (!isPlayerActive) return@runOnUiThread
        isPlayerActive = false

        savedOrientation?.let { requestedOrientation = it }
        savedOrientation = null

        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        savedSystemBarsBehavior?.let { insetsController.systemBarsBehavior = it }
        if (savedStatusBarsVisible != false) {
          insetsController.show(WindowInsetsCompat.Type.statusBars())
        } else {
          insetsController.hide(WindowInsetsCompat.Type.statusBars())
        }
        if (savedNavigationBarsVisible != false) {
          insetsController.show(WindowInsetsCompat.Type.navigationBars())
        } else {
          insetsController.hide(WindowInsetsCompat.Type.navigationBars())
        }
        savedStatusBarsVisible = null
        savedNavigationBarsVisible = null
        savedSystemBarsBehavior = null
      }
    }

    @JavascriptInterface
    fun setPlaying(playing: Boolean) {
      runOnUiThread {
        if (!isPlayerActive) {
          isPlaying = false
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
          return@runOnUiThread
        }
        isPlaying = playing
        if (playing) {
          window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        } else {
          window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
      }
    }
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
    webView.addJavascriptInterface(PlayerBridge(), "woyomiPlayer")

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
