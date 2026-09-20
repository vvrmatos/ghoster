const { SocksProxyAgent } = require("socks-proxy-agent");
const https = require("https");
const http = require("http");

const TOR_AGENT = new SocksProxyAgent("socks5h://127.0.0.1:9050");
const UA = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const req = mod.get(url, {
      agent: TOR_AGENT,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.5",
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function extractResults(html) {
  const results = [];

  // Extract organic results from Google's HTML
  // Google wraps results in <div class="g"> or similar containers
  // Links are in <a href="/url?q=..."> or direct <a href="https://...">

  // Method 1: Extract from /url?q= redirects
  const linkRe = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(html)) !== null) {
    const url = decodeURIComponent(match[1]);
    if (url.startsWith("http") && !url.includes("google.com") && !url.includes("accounts.google")) {
      const titleHtml = match[2];
      const title = titleHtml.replace(/<[^>]+>/g, "").trim();
      if (title && title.length > 0 && !results.find((r) => r.url === url)) {
        results.push({ url, title });
      }
    }
  }

  // Method 2: direct href extraction as fallback
  if (results.length < 3) {
    const directRe = /<a[^>]+href="(https?:\/\/(?!www\.google|accounts\.google|maps\.google|support\.google|policies\.google)[^"]+)"[^>]*>(?:<h3[^>]*>)?([\s\S]*?)(?:<\/h3>)?<\/a>/gi;
    while ((match = directRe.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].replace(/<[^>]+>/g, "").trim();
      if (title && title.length > 2 && !results.find((r) => r.url === url)) {
        results.push({ url, title });
      }
    }
  }

  // Extract snippets: text near the result URLs
  for (const r of results) {
    const domain = new URL(r.url).hostname;
    // Try to find a snippet near the domain mention
    const snippetRe = new RegExp(
      escapeRegex(domain) + "[\\s\\S]{0,500}?<span[^>]*>([\\s\\S]{20,300}?)<\\/span>",
      "i"
    );
    const sm = snippetRe.exec(html);
    if (sm) {
      r.snippet = sm[1].replace(/<[^>]+>/g, "").trim().slice(0, 200);
    }
  }

  return results.slice(0, 15);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function search(query) {
  const q = encodeURIComponent(query);
  const url = `https://www.google.com/search?q=${q}&num=15&hl=en&safe=off&pws=0&gl=us`;

  try {
    const html = await fetch(url);
    const results = extractResults(html);
    return { ok: true, results, query };
  } catch (err) {
    return { ok: false, error: err.message, results: [], query };
  }
}

module.exports = { search };
