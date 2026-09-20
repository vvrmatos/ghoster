/* ghoster nuke — advanced anti-tracking. Injected into every browsed page,
   before site scripts run. Poisons/blocks every known JS fingerprint + tracking
   vector. */
(function () {
  "use strict";
  var R = Math.random;
  function ri(a, b) { return Math.floor(a + R() * (b - a)); }
  function def(o, p, v) { try { Object.defineProperty(o, p, { get: function () { return v; }, configurable: false }); } catch (e) {} }
  function kill(o, p) { try { delete o[p]; } catch (e) {} try { def(o, p, undefined); } catch (e) {} }

  /* ── CANVAS ── */
  function poison(d) { for (var i = 0; i < d.length; i += 4) { var n = ri(-3, 3); d[i] = (d[i] + n) & 255; d[i+1] = (d[i+1] + n) & 255; d[i+2] = (d[i+2] + n) & 255; } }
  var _tdu = HTMLCanvasElement.prototype.toDataURL;
  var _tb = HTMLCanvasElement.prototype.toBlob;
  var _gid = CanvasRenderingContext2D.prototype.getImageData;
  HTMLCanvasElement.prototype.toDataURL = function () { try { var c = this.getContext("2d"); if (c) { var d = _gid.call(c, 0, 0, this.width, this.height); poison(d.data); c.putImageData(d, 0, 0); } } catch (e) {} return _tdu.apply(this, arguments); };
  HTMLCanvasElement.prototype.toBlob = function (cb, t, q) { try { var c = this.getContext("2d"); if (c) { var d = _gid.call(c, 0, 0, this.width, this.height); poison(d.data); c.putImageData(d, 0, 0); } } catch (e) {} return _tb.call(this, cb, t, q); };
  CanvasRenderingContext2D.prototype.getImageData = function () { var d = _gid.apply(this, arguments); poison(d.data); return d; };

  /* ── WEBGL ── */
  function glp(orig) { return function (p) { if (p === 37445 || p === 37446 || p === 7936) return "Mozilla"; if (p === 7937) return "WebGL 1.0"; if (p === 35724) return "WebGL GLSL ES 1.0"; return orig.call(this, p); }; }
  if (window.WebGLRenderingContext) {
    WebGLRenderingContext.prototype.getParameter = glp(WebGLRenderingContext.prototype.getParameter);
    var _ge = WebGLRenderingContext.prototype.getExtension;
    WebGLRenderingContext.prototype.getExtension = function (n) { if (n === "WEBGL_debug_renderer_info") return null; return _ge.call(this, n); };
    WebGLRenderingContext.prototype.getSupportedExtensions = function () { return ["OES_texture_float", "OES_standard_derivatives"]; };
    var _rp = WebGLRenderingContext.prototype.readPixels;
    WebGLRenderingContext.prototype.readPixels = function () { _rp.apply(this, arguments); if (arguments[6] && arguments[6].length) poison(arguments[6]); };
  }
  if (window.WebGL2RenderingContext) { WebGL2RenderingContext.prototype.getParameter = glp(WebGL2RenderingContext.prototype.getParameter); }

  /* ── WEBGPU (new fingerprint vector) ── */
  kill(navigator, "gpu");

  /* ── AUDIO ── */
  if (window.AnalyserNode) {
    var _gf = AnalyserNode.prototype.getFloatFrequencyData;
    AnalyserNode.prototype.getFloatFrequencyData = function (a) { _gf.call(this, a); for (var i = 0; i < a.length; i++) a[i] += (R() - 0.5) * 0.1; };
    var _gb = AnalyserNode.prototype.getByteFrequencyData;
    AnalyserNode.prototype.getByteFrequencyData = function (a) { _gb.call(this, a); for (var i = 0; i < a.length; i++) a[i] = (a[i] + ri(-2, 2)) & 255; };
  }
  if (window.AudioContext) def(AudioContext.prototype, "sampleRate", 44100);

  /* ── CLIENTRECTS / DOMRECT fingerprinting ── */
  var jitter = function (v) { return v + (R() - 0.5) * 0.0002; };
  if (window.Element) {
    var _gbcr = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { var r = _gbcr.apply(this, arguments); return new DOMRect(jitter(r.x), jitter(r.y), jitter(r.width), jitter(r.height)); };
    var _gcr = Element.prototype.getClientRects;
    Element.prototype.getClientRects = function () { var rl = _gcr.apply(this, arguments); return rl; };
  }
  /* text metrics fingerprinting */
  if (window.CanvasRenderingContext2D) {
    var _mt = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (t) { var m = _mt.call(this, t); try { def(m, "width", jitter(m.width)); } catch (e) {} return m; };
  }

  /* ── NAVIGATOR ── */
  var n = Navigator.prototype;
  def(n, "platform", "Win32");
  def(n, "oscpu", "Windows NT 10.0; Win64; x64");
  def(n, "vendor", "");
  def(n, "vendorSub", "");
  def(n, "productSub", "20100101");
  def(n, "hardwareConcurrency", 4);
  def(n, "deviceMemory", 8);
  def(n, "maxTouchPoints", 0);
  def(n, "language", "en-US");
  def(n, "languages", Object.freeze(["en-US", "en"]));
  def(n, "doNotTrack", "1");
  def(n, "webdriver", false);
  def(n, "pdfViewerEnabled", false);
  def(n, "cookieEnabled", true);
  def(n, "userAgentData", undefined);
  def(n, "connection", undefined);
  def(n, "plugins", Object.create(PluginArray.prototype, { length: { value: 0 } }));
  def(n, "mimeTypes", Object.create(MimeTypeArray.prototype, { length: { value: 0 } }));

  /* ── KILL DANGEROUS APIS ── */
  var apis = ["getBattery", "getGamepads", "requestMIDIAccess", "bluetooth", "usb", "serial", "hid", "nfc", "xr", "keyboard", "ink", "credentials", "geolocation", "wakeLock", "locks", "presentation", "getInstalledRelatedApps", "requestMediaKeySystemAccess", "clearAppBadge", "setAppBadge", "canShare", "share", "scheduling", "userActivation", "windowControlsOverlay", "virtualKeyboard", "devicePosture"];
  for (var i = 0; i < apis.length; i++) kill(Navigator.prototype, apis[i]);

  /* media devices */
  if (navigator.mediaDevices) {
    navigator.mediaDevices.enumerateDevices = function () { return Promise.resolve([]); };
    navigator.mediaDevices.getUserMedia = function () { return Promise.reject(new DOMException("NotAllowedError")); };
    navigator.mediaDevices.getDisplayMedia = function () { return Promise.reject(new DOMException("NotAllowedError")); };
  }

  /* ── SENSORS (accelerometer/gyro/magnetometer/ambient light) ── */
  ["Accelerometer", "Gyroscope", "Magnetometer", "AmbientLightSensor", "AbsoluteOrientationSensor", "RelativeOrientationSensor", "LinearAccelerationSensor", "GravitySensor"].forEach(function (s) { try { window[s] = undefined; } catch (e) {} });
  window.ondevicemotion = null;
  window.ondeviceorientation = null;
  window.DeviceMotionEvent = undefined;
  window.DeviceOrientationEvent = undefined;

  /* ── COMPUTE PRESSURE / IDLE ── */
  window.PressureObserver = undefined;
  window.IdleDetector = undefined;

  /* ── SCREEN / WINDOW ── */
  var S = Screen.prototype;
  def(S, "width", 1920); def(S, "height", 1080); def(S, "availWidth", 1920); def(S, "availHeight", 1040);
  def(S, "colorDepth", 24); def(S, "pixelDepth", 24);
  try { def(S, "orientation", { type: "landscape-primary", angle: 0 }); } catch (e) {}
  def(window, "devicePixelRatio", 1);
  def(window, "screenX", 0); def(window, "screenY", 0); def(window, "screenLeft", 0); def(window, "screenTop", 0);

  /* ── MATCHMEDIA (normalize) ── */
  var _mm = window.matchMedia;
  window.matchMedia = function (q) {
    if (/prefers-color-scheme/.test(q)) return _mm.call(window, "(prefers-color-scheme: dark)");
    if (/resolution|device-pixel-ratio|monochrome|dynamic-range|prefers-reduced-motion|hover|pointer|any-hover|any-pointer/.test(q))
      return { matches: false, media: q, onchange: null, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {}, dispatchEvent: function () { return false; } };
    return _mm.call(window, q);
  };

  /* ── TIMING (kill high-res timers used for timing attacks + fingerprinting) ── */
  var _now = Performance.prototype.now;
  Performance.prototype.now = function () { return Math.round(_now.call(this) / 10) * 10; };
  Performance.prototype.getEntries = function () { return []; };
  Performance.prototype.getEntriesByName = function () { return []; };
  Performance.prototype.getEntriesByType = function () { return []; };
  if (performance.memory) def(performance, "memory", { jsHeapSizeLimit: 2172649472, totalJSHeapSize: 1073741824, usedJSHeapSize: 536870912 });
  window.SharedArrayBuffer = undefined;

  /* ── TIMEZONE / LOCALE → UTC ── */
  Date.prototype.getTimezoneOffset = function () { return 0; };
  var _DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function () { var a = arguments; if (!a[1]) a = [a[0], {}]; if (!a[1].timeZone) a[1].timeZone = "UTC"; return new _DTF(a[0], a[1]); };
  Intl.DateTimeFormat.prototype = _DTF.prototype;
  Intl.DateTimeFormat.supportedLocalesOf = _DTF.supportedLocalesOf;
  var _ro = _DTF.prototype.resolvedOptions;
  _DTF.prototype.resolvedOptions = function () { var o = _ro.call(this); o.timeZone = "UTC"; o.locale = "en-US"; return o; };

  /* ── FONTS ── */
  if (document.fonts) {
    document.fonts.check = function (f) { return /monospace|sans-serif|serif/.test(f); };
    try { def(document.fonts, "size", 0); } catch (e) {}
    document.fonts.forEach = function () {};
    document.fonts.values = function () { return [][Symbol.iterator](); };
  }

  /* ── WEBRTC (IP leak — triple kill) ── */
  window.RTCPeerConnection = undefined;
  window.webkitRTCPeerConnection = undefined;
  window.mozRTCPeerConnection = undefined;
  window.RTCDataChannel = undefined;
  window.RTCIceCandidate = undefined;
  window.RTCSessionDescription = undefined;

  /* ── SPEECH ── */
  if (window.speechSynthesis) { window.speechSynthesis.getVoices = function () { return []; }; }

  /* ── NETWORK INFO ── */
  kill(window, "NetworkInformation");

  /* ── STORAGE ESTIMATION ── */
  if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate = function () { return Promise.resolve({ quota: 1073741824, usage: 0 }); };

  /* ── PERMISSIONS / NOTIFICATIONS → denied ── */
  if (navigator.permissions) navigator.permissions.query = function () { return Promise.resolve({ state: "denied", onchange: null, addEventListener: function () {} }); };
  if (window.Notification) { def(Notification, "permission", "denied"); Notification.requestPermission = function () { return Promise.resolve("denied"); }; }

  /* ── CLIPBOARD / BEACON ── */
  if (navigator.clipboard) { navigator.clipboard.readText = function () { return Promise.reject(new DOMException("NotAllowedError")); }; navigator.clipboard.read = function () { return Promise.reject(new DOMException("NotAllowedError")); }; }
  Navigator.prototype.sendBeacon = function () { return false; };

  /* ── TRACKING SURFACE ── */
  try { def(window, "name", ""); } catch (e) {}
  def(History.prototype, "length", 1);
  try { def(Document.prototype, "referrer", ""); } catch (e) {}

  /* ── ERROR STACK LEAK REDUCTION ── */
  try { Error.stackTraceLimit = 0; } catch (e) {}
})();
