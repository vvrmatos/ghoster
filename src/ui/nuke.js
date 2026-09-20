// NUKE.JS — Total fingerprint annihilation
// Injected into every webview on every page load, MAIN world, before any site JS runs.
// Every fingerprinting vector is poisoned, randomized, or destroyed.

(function () {
  "use strict";

  const R = Math.random;
  function rand(min, max) { return min + R() * (max - min); }
  function randInt(min, max) { return Math.floor(rand(min, max)); }
  function freeze(obj, prop, val) {
    try { Object.defineProperty(obj, prop, { get: () => val, configurable: false, enumerable: true }); } catch {}
  }

  // ═══════════════════════════════════════════
  // CANVAS — poison every read with random noise
  // ═══════════════════════════════════════════

  const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
  const _toBlob = HTMLCanvasElement.prototype.toBlob;
  const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
  const _readPixels = WebGLRenderingContext.prototype.readPixels;

  function poisonPixels(data) {
    const len = data.length;
    const noise = randInt(1, 5);
    for (let i = 0; i < len; i += 4) {
      data[i] = (data[i] + randInt(-noise, noise)) & 0xff;
      data[i + 1] = (data[i + 1] + randInt(-noise, noise)) & 0xff;
      data[i + 2] = (data[i + 2] + randInt(-noise, noise)) & 0xff;
    }
  }

  HTMLCanvasElement.prototype.toDataURL = function () {
    try {
      const ctx = this.getContext("2d");
      if (ctx) { const d = _getImageData.call(ctx, 0, 0, this.width, this.height); poisonPixels(d.data); ctx.putImageData(d, 0, 0); }
    } catch {}
    return _toDataURL.apply(this, arguments);
  };

  HTMLCanvasElement.prototype.toBlob = function (cb, t, q) {
    try {
      const ctx = this.getContext("2d");
      if (ctx) { const d = _getImageData.call(ctx, 0, 0, this.width, this.height); poisonPixels(d.data); ctx.putImageData(d, 0, 0); }
    } catch {}
    return _toBlob.call(this, cb, t, q);
  };

  CanvasRenderingContext2D.prototype.getImageData = function () {
    const d = _getImageData.apply(this, arguments);
    poisonPixels(d.data);
    return d;
  };

  // WebGL readPixels
  WebGLRenderingContext.prototype.readPixels = function () {
    _readPixels.apply(this, arguments);
    if (arguments[6] && arguments[6].length) poisonPixels(arguments[6]);
  };
  if (typeof WebGL2RenderingContext !== "undefined") {
    const _readPixels2 = WebGL2RenderingContext.prototype.readPixels;
    WebGL2RenderingContext.prototype.readPixels = function () {
      _readPixels2.apply(this, arguments);
      if (arguments[6] && arguments[6].length) poisonPixels(arguments[6]);
    };
  }

  // ═══════════════════════════════════════════
  // WEBGL — spoof every parameter
  // ═══════════════════════════════════════════

  const GL_SPOOFS = {
    7936: "Mozilla",                          // GL_VENDOR
    7937: "Mozilla",                          // GL_VERSION → "WebGL 1.0"
    7938: "WebGL 1.0 OpenGL ES 2.0",          // GL_VERSION (full)
    35724: "WebGL GLSL ES 1.0",               // SHADING_LANGUAGE_VERSION
    37445: "Mozilla",                         // UNMASKED_VENDOR_WEBGL
    37446: "Mozilla",                         // UNMASKED_RENDERER_WEBGL
    3379: 16384,   // MAX_TEXTURE_SIZE
    3386: [32767, 32767],  // MAX_VIEWPORT_DIMS
    34076: 16384,  // MAX_CUBE_MAP_TEXTURE_SIZE
    34921: 16,     // MAX_TEXTURE_IMAGE_UNITS
    34930: 16,     // MAX_COMBINED_TEXTURE_IMAGE_UNITS
    35660: 16,     // MAX_VERTEX_TEXTURE_IMAGE_UNITS
    35661: 256,    // MAX_VERTEX_UNIFORM_VECTORS
    36347: 1024,   // MAX_FRAGMENT_UNIFORM_VECTORS
    36348: 32,     // MAX_VARYING_VECTORS
    34024: 16,     // MAX_VERTEX_ATTRIBS
  };

  function spoofGLParam(orig) {
    return function (p) {
      if (GL_SPOOFS[p] !== undefined) {
        const v = GL_SPOOFS[p];
        return Array.isArray(v) ? new Int32Array(v) : v;
      }
      return orig.call(this, p);
    };
  }

  WebGLRenderingContext.prototype.getParameter = spoofGLParam(WebGLRenderingContext.prototype.getParameter);
  if (typeof WebGL2RenderingContext !== "undefined") {
    WebGL2RenderingContext.prototype.getParameter = spoofGLParam(WebGL2RenderingContext.prototype.getParameter);
  }

  // Block getExtension for fingerprinting extensions
  const _getExt = WebGLRenderingContext.prototype.getExtension;
  WebGLRenderingContext.prototype.getExtension = function (name) {
    if (name === "WEBGL_debug_renderer_info") return null;
    return _getExt.call(this, name);
  };

  // getSupportedExtensions — return generic set
  WebGLRenderingContext.prototype.getSupportedExtensions = function () {
    return ["ANGLE_instanced_arrays", "OES_texture_float", "OES_standard_derivatives"];
  };

  // ═══════════════════════════════════════════
  // AUDIO — poison AudioContext fingerprint
  // ═══════════════════════════════════════════

  if (typeof AudioContext !== "undefined") {
    const _createOsc = AudioContext.prototype.createOscillator;
    const _createDyn = AudioContext.prototype.createDynamicsCompressor;
    const _createAn = AudioContext.prototype.createAnalyser;
    const _getFloat = AnalyserNode.prototype.getFloatFrequencyData;
    const _getByte = AnalyserNode.prototype.getByteFrequencyData;

    AnalyserNode.prototype.getFloatFrequencyData = function (arr) {
      _getFloat.call(this, arr);
      for (let i = 0; i < arr.length; i++) arr[i] += (R() - 0.5) * 0.1;
    };
    AnalyserNode.prototype.getByteFrequencyData = function (arr) {
      _getByte.call(this, arr);
      for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] + randInt(-2, 2)) & 0xff;
    };

    // Spoof sampleRate
    freeze(AudioContext.prototype, "sampleRate", 44100);
    if (typeof OfflineAudioContext !== "undefined") {
      freeze(OfflineAudioContext.prototype, "sampleRate", 44100);
    }
  }

  // ═══════════════════════════════════════════
  // NAVIGATOR — lock down every property
  // ═══════════════════════════════════════════

  const nav = Navigator.prototype;
  freeze(nav, "platform", "Win32");
  freeze(nav, "oscpu", "Windows NT 10.0; Win64; x64");
  freeze(nav, "vendor", "");
  freeze(nav, "vendorSub", "");
  freeze(nav, "productSub", "20100101");
  freeze(nav, "hardwareConcurrency", 4);
  freeze(nav, "deviceMemory", 8);
  freeze(nav, "maxTouchPoints", 0);
  freeze(nav, "language", "en-US");
  freeze(nav, "languages", Object.freeze(["en-US", "en"]));
  freeze(nav, "onLine", true);
  freeze(nav, "cookieEnabled", true);
  freeze(nav, "doNotTrack", "1");
  freeze(nav, "pdfViewerEnabled", false);
  freeze(nav, "webdriver", false);
  freeze(nav, "connection", undefined);
  freeze(nav, "userAgentData", undefined);

  // Kill plugins / mimeTypes
  freeze(nav, "plugins", Object.create(PluginArray.prototype, { length: { value: 0 } }));
  freeze(nav, "mimeTypes", Object.create(MimeTypeArray.prototype, { length: { value: 0 } }));

  // Kill dangerous APIs entirely
  delete Navigator.prototype.getBattery;
  delete Navigator.prototype.getGamepads;
  delete Navigator.prototype.requestMIDIAccess;
  delete Navigator.prototype.bluetooth;
  delete Navigator.prototype.usb;
  delete Navigator.prototype.serial;
  delete Navigator.prototype.hid;
  delete Navigator.prototype.xr;
  delete Navigator.prototype.keyboard;
  delete Navigator.prototype.ink;
  delete Navigator.prototype.mediaDevices;
  delete Navigator.prototype.credentials;

  // mediaDevices — return empty
  if (navigator.mediaDevices) {
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("NotAllowedError"); };
    navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException("NotAllowedError"); };
  }

  // ═══════════════════════════════════════════
  // SCREEN — generic 1920x1080
  // ═══════════════════════════════════════════

  const S = Screen.prototype;
  freeze(S, "width", 1920);
  freeze(S, "height", 1080);
  freeze(S, "availWidth", 1920);
  freeze(S, "availHeight", 1040);
  freeze(S, "colorDepth", 24);
  freeze(S, "pixelDepth", 24);
  freeze(window, "devicePixelRatio", 1);
  freeze(window, "innerWidth", 1920);
  freeze(window, "outerWidth", 1920);
  freeze(window, "innerHeight", 940);
  freeze(window, "outerHeight", 1040);
  freeze(window, "screenX", 0);
  freeze(window, "screenY", 0);
  freeze(window, "screenLeft", 0);
  freeze(window, "screenTop", 0);

  // matchMedia — spoof to generic
  const _matchMedia = window.matchMedia;
  window.matchMedia = function (q) {
    if (q.includes("prefers-color-scheme")) return _matchMedia.call(window, "(prefers-color-scheme: dark)");
    if (q.includes("resolution") || q.includes("device-pixel-ratio")) {
      return { matches: false, media: q, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false };
    }
    return _matchMedia.call(window, q);
  };

  // ═══════════════════════════════════════════
  // TIMING — destroy precision
  // ═══════════════════════════════════════════

  const _now = Performance.prototype.now;
  Performance.prototype.now = function () { return Math.round(_now.call(this) * 10) / 10; };

  const _getEntries = Performance.prototype.getEntries;
  Performance.prototype.getEntries = function () { return []; };
  Performance.prototype.getEntriesByName = function () { return []; };
  Performance.prototype.getEntriesByType = function () { return []; };

  if (performance.memory) {
    freeze(performance, "memory", { jsHeapSizeLimit: 2172649472, totalJSHeapSize: 1073741824, usedJSHeapSize: 536870912 });
  }

  // ═══════════════════════════════════════════
  // DATE / TIMEZONE — always UTC
  // ═══════════════════════════════════════════

  Date.prototype.getTimezoneOffset = function () { return 0; };

  const _DTF = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function (...args) {
    if (!args[1]) args[1] = {};
    if (!args[1].timeZone) args[1].timeZone = "UTC";
    return new _DTF(...args);
  };
  Object.setPrototypeOf(Intl.DateTimeFormat, _DTF);
  Object.setPrototypeOf(Intl.DateTimeFormat.prototype, _DTF.prototype);
  Intl.DateTimeFormat.prototype.resolvedOptions = function () {
    const o = _DTF.prototype.resolvedOptions.call(this);
    o.timeZone = "UTC";
    return o;
  };
  Intl.DateTimeFormat.supportedLocalesOf = _DTF.supportedLocalesOf;

  // ═══════════════════════════════════════════
  // FONTS — block enumeration
  // ═══════════════════════════════════════════

  if (document.fonts && document.fonts.check) {
    const genericFonts = ["monospace", "sans-serif", "serif"];
    document.fonts.check = function (font) {
      return genericFonts.some((f) => font.includes(f));
    };
    document.fonts.forEach = function () {};
    freeze(document.fonts, "size", 0);
  }

  // ═══════════════════════════════════════════
  // STORAGE — spoof estimation
  // ═══════════════════════════════════════════

  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate = async () => ({ quota: 1073741824, usage: 0 });
  }

  // ═══════════════════════════════════════════
  // WEBRTC — triple kill (belt + suspenders + duct tape)
  // ═══════════════════════════════════════════

  window.RTCPeerConnection = undefined;
  window.webkitRTCPeerConnection = undefined;
  window.mozRTCPeerConnection = undefined;
  window.RTCDataChannel = undefined;
  window.RTCSessionDescription = undefined;
  window.RTCIceCandidate = undefined;

  // ═══════════════════════════════════════════
  // SPEECH — block voice enumeration
  // ═══════════════════════════════════════════

  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices = () => [];
    window.speechSynthesis.addEventListener = () => {};
  }

  // ═══════════════════════════════════════════
  // MISC — kill every remaining vector
  // ═══════════════════════════════════════════

  // window.name can track across navigations
  try { Object.defineProperty(window, "name", { get: () => "", set: () => {}, configurable: false }); } catch {}

  // history.length reveals browsing depth
  freeze(History.prototype, "length", 1);

  // Referrer — always empty
  freeze(Document.prototype, "referrer", "");

  // Permissions API — always "denied"
  if (navigator.permissions) {
    navigator.permissions.query = async () => ({ state: "denied", addEventListener: () => {} });
  }

  // Notification — always "denied"
  if (window.Notification) {
    freeze(Notification, "permission", "denied");
    Notification.requestPermission = async () => "denied";
  }

  // Clipboard — blocked
  if (navigator.clipboard) {
    navigator.clipboard.readText = async () => { throw new DOMException("NotAllowedError"); };
    navigator.clipboard.read = async () => { throw new DOMException("NotAllowedError"); };
  }

  // SharedArrayBuffer — kill
  window.SharedArrayBuffer = undefined;

  // Beacon — block
  Navigator.prototype.sendBeacon = () => false;

  // console.log proof it ran
  // (removed in production — this is silent)
})();
