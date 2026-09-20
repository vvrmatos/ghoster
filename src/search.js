const { SocksProxyAgent } = require("socks-proxy-agent");
const https = require("https");

const TOR_AGENT = new SocksProxyAgent("socks5h://127.0.0.1:9050");
const UA = "Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0";

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: TOR_AGENT,
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
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

function parseDDG(html, query) {
  const results = [];

  // DuckDuckGo HTML results: <a class="result__a" href="...">title</a>
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let url = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    // DDG wraps URLs in redirect: //duckduckgo.com/l/?uddg=...
    if (url.includes("uddg=")) {
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
    }
    if (url.startsWith("http") && title && !results.find((r) => r.url === url)) {
      results.push({ url, title });
    }
  }

  // Snippets: <a class="result__snippet" ...>text</a>
  const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let si = 0;
  while ((m = snipRe.exec(html)) !== null && si < results.length) {
    results[si].snippet = m[1].replace(/<[^>]+>/g, "").trim().slice(0, 200);
    si++;
  }

  return results.slice(0, 15);
}

async function search(query) {
  const q = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${q}`;

  try {
    const html = await fetch(url);
    const results = parseDDG(html, query);
    return { ok: true, results, query, engine: "duckduckgo" };
  } catch (err) {
    return { ok: false, error: err.message, results: [], query };
  }
}

module.exports = { search };
