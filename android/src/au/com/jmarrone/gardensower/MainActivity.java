package au.com.jmarrone.gardensower;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.DownloadListener;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;

/**
 * GardenSower: a fully offline garden log bundled in the APK.
 * Camera capture is wired through to the page's file inputs; camera originals
 * are copied into the public gallery folder Pictures/GardenSower; the one-time
 * coarse location fix sets the hemisphere and climate band.
 */
public class MainActivity extends Activity {

  private static final String PAGE = "file:///android_asset/index.html";
  private static final String AUTHORITY = "au.com.jmarrone.gardensower.images";
  private static final int REQ_CHOOSER = 1001;
  private static final int REQ_CAMERA = 1002;
  private static final int REQ_LOCATION = 1003;

  private WebView web;
  private ProgressBar bar;
  private ValueCallback<Uri[]> pending;
  private Uri cameraUri;
  private Double lastLat, lastLng;
  private boolean pageReady = false;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);

    Window w = getWindow();
    w.setStatusBarColor(Color.parseColor("#eef2e3"));
    w.setNavigationBarColor(Color.parseColor("#eef2e3"));
    if (Build.VERSION.SDK_INT >= 23) {
      w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
    }

    FrameLayout root = new FrameLayout(this);
    root.setBackgroundColor(Color.parseColor("#eef2e3"));

    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#eef2e3"));
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setUseWideViewPort(true);
    s.setLoadWithOverviewMode(true);
    s.setAllowFileAccess(true);
    s.setAllowFileAccessFromFileURLs(true);
    s.setAllowUniversalAccessFromFileURLs(true);

    bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(100);
    bar.setVisibility(View.GONE);
    FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
    bp.gravity = Gravity.TOP;

    root.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    root.addView(bar, bp);
    setContentView(root);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        return handle(r.getUrl());
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView v, String url) {
        return handle(Uri.parse(url));
      }

      @Override
      public void onPageFinished(WebView v, String url) {
        pageReady = true;
        pushGps();
      }

      @Override
      public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        // local assets only; nothing to fall back to
      }

      @Override
      public void onReceivedError(WebView v, int code, String desc, String failingUrl) {
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onProgressChanged(WebView v, int p) {
        bar.setVisibility(p < 100 ? View.VISIBLE : View.GONE);
        bar.setProgress(p);
      }

      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb,
                                       FileChooserParams params) {
        if (pending != null) {
          pending.onReceiveValue(null);
          pending = null;
        }
        pending = cb;
        cameraUri = null;

        Intent camera = null;
        try {
          File dir = new File(getCacheDir(), "captures");
          if (!dir.exists()) dir.mkdirs();
          File f = new File(dir, "cap_" + System.currentTimeMillis() + ".jpg");
          cameraUri = Uri.parse("content://" + AUTHORITY + "/" + f.getName());
          camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
          camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
          camera.setClipData(ClipData.newRawUri("", cameraUri));
          camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION
              | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
          camera = null;
          cameraUri = null;
        }

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType("image/*");

        boolean wantCamera = params != null && params.isCaptureEnabled() && camera != null;
        try {
          if (wantCamera) {
            startActivityForResult(camera, REQ_CAMERA);
            return true;
          }
          Intent chooser = Intent.createChooser(pick, "Add a photo");
          if (camera != null) {
            chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
          }
          startActivityForResult(chooser, REQ_CHOOSER);
        } catch (Exception e) {
          try {
            startActivityForResult(pick, REQ_CHOOSER);
          } catch (Exception e2) {
            if (pending != null) {
              pending.onReceiveValue(null);
              pending = null;
            }
          }
        }
        return true;
      }
    });

    web.setDownloadListener(new DownloadListener() {
      @Override
      public void onDownloadStart(String url, String agent, String disp,
                                  String mime, long len) {
        saveDownload(url, disp);
      }
    });

    if (saved != null) {
      web.restoreState(saved);
      pageReady = (saved.getBoolean("pageReady"));
    } else {
      web.loadUrl(PAGE);
    }

    maybeAskLocation();
  }

  private boolean handle(Uri u) {
    if (u == null) return false;
    String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
    if ("file".equals(scheme) || "data".equals(scheme)) return false;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, u));
    } catch (Exception ignored) {
      return true;
    }
    return true;
  }

  /** One-time coarse location ask: hemisphere and climate band, never tracking. */
  private void maybeAskLocation() {
    SharedPreferences p = getSharedPreferences("gs", Context.MODE_PRIVATE);
    if (p.getBoolean("gpsAsked", false)) {
      pushGps();
      return;
    }
    p.edit().putBoolean("gpsAsked", true).apply();
    if (Build.VERSION.SDK_INT >= 23
        && checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_LOCATION);
    } else {
      readLocation();
    }
  }

  private void readLocation() {
    try {
      LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
      Location best = null;
      if (lm != null) {
        for (String prov : new String[]{LocationManager.NETWORK_PROVIDER,
            LocationManager.GPS_PROVIDER, LocationManager.PASSIVE_PROVIDER}) {
          try {
            if (lm.isProviderEnabled(prov)) {
              Location l = lm.getLastKnownLocation(prov);
              if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
          } catch (Exception ignored) {
          }
        }
      }
      if (best != null) {
        lastLat = best.getLatitude();
        lastLng = best.getLongitude();
      }
      pushGps();
    } catch (Exception ignored) {
    }
  }

  private void pushGps() {
    if (!pageReady || lastLat == null) return;
    web.evaluateJavascript(
        "window.__gps && window.__gps(" + lastLat + "," + lastLng + ");", null);
  }

  @Override
  public void onRequestPermissionsResult(int req, String[] perms, int[] res) {
    if (req == REQ_LOCATION
        && res != null && res.length > 0 && res[0] == PackageManager.PERMISSION_GRANTED) {
      readLocation();
    }
  }

  /** Copy a camera capture into the public gallery folder the app owns. */
  private void archiveCapture() {
    if (cameraUri == null) return;
    try {
      InputStream in = getContentResolver().openInputStream(cameraUri);
      if (in == null) return;
      ByteArrayOutputStream buf = new ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int n;
      while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
      in.close();
      byte[] bytes = buf.toByteArray();
      if (bytes.length == 0) return;

      if (Build.VERSION.SDK_INT >= 29) {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Images.Media.DISPLAY_NAME,
            "gardensower_" + System.currentTimeMillis() + ".jpg");
        cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        cv.put(MediaStore.Images.Media.RELATIVE_PATH,
            Environment.DIRECTORY_PICTURES + "/GardenSower");
        Uri u = getContentResolver().insert(
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
        if (u != null) {
          OutputStream os = getContentResolver().openOutputStream(u);
          os.write(bytes);
          os.close();
        }
      } else {
        File dir = getExternalFilesDir("GardenSower Originals");
        if (dir != null) {
          FileOutputStream os = new FileOutputStream(new File(dir,
              "gardensower_" + System.currentTimeMillis() + ".jpg"));
          os.write(bytes);
          os.close();
        }
      }
    } catch (Exception ignored) {
    }
  }

  /** Save an exported data: URL as a real file in Downloads/GardenSower. */
  private void saveDownload(String url, String disp) {
    try {
      if (!url.startsWith("data:")) {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        return;
      }
      int comma = url.indexOf(',');
      String meta = url.substring(5, comma);
      boolean base64 = meta.contains(";base64");
      String dataPart = url.substring(comma + 1);
      byte[] bytes;
      if (base64) {
        bytes = android.util.Base64.decode(dataPart, android.util.Base64.DEFAULT);
      } else {
        bytes = URLDecoder.decode(dataPart, "UTF-8").getBytes("UTF-8");
      }
      String name = disp == null || disp.trim().isEmpty()
          ? "gardensower_export.json" : disp;
      if (name.contains("/") || name.contains("\\")) name = "gardensower_export.json";

      boolean ok = false;
      if (Build.VERSION.SDK_INT >= 29) {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
        cv.put(MediaStore.Downloads.MIME_TYPE, guessMime(name));
        cv.put(MediaStore.Downloads.RELATIVE_PATH,
            Environment.DIRECTORY_DOWNLOADS + "/GardenSower");
        Uri u = getContentResolver().insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (u != null) {
          OutputStream os = getContentResolver().openOutputStream(u);
          os.write(bytes);
          os.close();
          ok = true;
        }
      } else {
        File dir = getExternalFilesDir("GardenSower Exports");
        if (dir != null) {
          FileOutputStream os = new FileOutputStream(new File(dir, name));
          os.write(bytes);
          os.close();
          ok = true;
        }
      }
      Toast.makeText(this, ok ? "Saved to Downloads/GardenSower"
          : "Could not save the export", Toast.LENGTH_LONG).show();
    } catch (Exception e) {
      Toast.makeText(this, "Could not save the export", Toast.LENGTH_LONG).show();
    }
  }

  private String guessMime(String name) {
    String ext = name.contains(".")
        ? name.substring(name.lastIndexOf('.') + 1) : "";
    String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
    return m == null ? "application/octet-stream" : m;
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    if (req == REQ_CHOOSER) {
      Uri[] out = null;
      boolean fromCamera = false;
      if (res == RESULT_OK) {
        if (data != null && data.getData() != null) {
          out = new Uri[]{data.getData()};
        } else if (data != null && data.getClipData() != null) {
          int n = data.getClipData().getItemCount();
          out = new Uri[n];
          for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
        } else if (cameraUri != null) {
          out = new Uri[]{cameraUri};
          fromCamera = true;
        }
      }
      if (fromCamera) archiveCapture();
      finishChooser(out);
    } else if (req == REQ_CAMERA) {
      boolean got = res == RESULT_OK && cameraUri != null;
      if (got) archiveCapture();
      finishChooser(got ? new Uri[]{cameraUri} : null);
    } else {
      super.onActivityResult(req, res, data);
    }
  }

  private void finishChooser(Uri[] out) {
    if (pending != null) {
      pending.onReceiveValue(out);
      pending = null;
    }
    cameraUri = null;
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    out.putBoolean("pageReady", pageReady);
    if (web != null) web.saveState(out);
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
    } else {
      super.onBackPressed();
    }
  }

  private int dp(int v) {
    return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
  }
}
