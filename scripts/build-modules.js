/**
 * ShadowStore 数据聚合构建引擎
 * 严格来源熔断、原子化写盘、作者/头像解析、高精度全量图标匹配、配色方案自动提取、
 * 向上回溯解析作者/头像/依赖模块/徽章外链，Markdown 超链接纯净化与小火箭一键安装支持
 */
const fs = require("fs");
const path = require("path");

const CONFIG = {
  REPO_README_URL: "https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/README/README.md",
  REPO_README_BACKUP: "https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md",
  FMZ_TREE_API: "https://api.github.com/repos/fmz200/wool_scripts/git/trees/main?recursive=1",
  ZIRAWELL_README_URL: "https://raw.githubusercontent.com/zirawell/R-Store/main/README.md",
  ZIRAWELL_TREE_API: "https://api.github.com/repos/zirawell/R-Store/git/trees/main?recursive=1",
  ICONS_JSON_URL: "https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/icons-all.json",
  LUESTR_TREE_API: "https://api.github.com/repos/luestr/IconResource/git/trees/main?recursive=1",
  CONCURRENCY: 12,
  MAX_FAILURE_RATIO: 0.25
};

const APP_ALIASES = {
  "Plugin2Rocket": ["Shadowrocket"],
  "一汽大众": ["fawvw"],
  "上汽大众": ["csvw"],
  "流媒体": ["netflix"],
  "影视": ["netflix"],
  "大师兄": ["netflix"],
  "苹果": ["apple"],
  "apple": ["apple"],
  "谷歌": ["google"],
  "微软": ["microsoft"],
  "油管": ["youtube"],
  "youtube": ["youtube"],
  "电报": ["telegram"],
  "推特": ["twitter", "x"],
  "奈飞": ["netflix"],
  "网飞": ["netflix"],
  "迪士尼": ["disney"],
  "cmcc": ["中国移动"],
  "小米": ["xiaomi", "mi"],
  "米家": ["xiaomi", "mihome", "mi"],
  "call": ["googlevoice"],
  "ali": ["alibaba"],
  "阿里": ["alibaba"],
  "阿里系": ["alibaba"],
  "京东": ["jd", "jingdong"],
  "哔哩哔哩": ["bilibili", "b站", "bili"],
  "b站": ["bilibili"],
  "bili": ["bilibili"],
  "微信": ["weixin", "wechat"],
  "微博": ["weibo"],
  "知乎": ["zhihu"],
  "script": ["script-hub"],
  "小红书": ["xhs", "xiaohongshu", "rednot", "redbook"],
  "rednot": ["xhs", "xiaohongshu", "rednot", "redbook"],
  "抖音": ["douyin", "tiktok"],
  "快手": ["kuaishou"],
  "网易云": ["netease", "cloudmusic"],
  "百度": ["baidu"],
  "高德": ["amap", "gaode"],
  "腾讯": ["tencent"],
  "美团": ["meituan"],
  "拼多多": ["pdd", "pinduoduo"],
  "闲鱼": ["xianyu"],
  "咸鱼": ["xianyu"],
  "饿了么": ["eleme"],
  "爱奇艺": ["iqiyi"],
  "优酷": ["youku"],
  "淘宝": ["taobao"],
  "豆瓣": ["douban"],
  "贴吧": ["tieba"],
  "夸克": ["quark"],
  "12306": ["12306"],
  "高德地图": ["amap"]
};

const FLAG_CODES = new Set([
  "cn", "us", "hk", "tw", "jp", "kr", "sg", "uk", "gb", "de", "fr", "ca", "ru", "au",
  "mo", "vn", "th", "ph", "my", "in", "id", "br", "cl", "ar", "mx", "nl", "se", "no",
  "fi", "ch", "at", "it", "es", "pt", "tr", "ua", "za", "nz", "ie", "pl", "ro", "cz",
  "hu", "gr", "bg", "hr", "sk", "il", "china", "taiwan", "hongkong", "japan", "korea",
  "singapore", "usa", "united_states", "united_kingdom", "germany", "france", "russia", "australia"
]);

let remoteIconsMap = {};
const stats = { totalAttempted: 0, failedCount: 0 };
const sourceHealth = { local: false, fmz: false, zirawell: false };

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, "")
    .replace(/\\t/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 清除 Markdown 格式中的超链接并提取纯文本
 */
function cleanMarkdownText(value) {
  if (!value) return "";
  return String(value)
    .replace(/!\[[^\]]*\]\([^\)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/<https?:\/\/[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/^>+\s*/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFlagKey(key, url = "") {
  if (!key && !url) return false;
  const k = (key || "").toLowerCase().trim();
  const u = (url || "").toLowerCase().trim();
  if (FLAG_CODES.has(k)) return true;
  const flagKeywords = ["flag", "flags", "国旗", "node", "节点", "country", "countries", "region", "regions", "geoip"];
  if (flagKeywords.some(w => k.includes(w) || u.includes(w))) return true;
  if (/\/(?:flags?|countries|regions|country)\//i.test(u)) return true;
  if (/[_\-/](?:cn|us|hk|tw|jp|kr|sg|gb|uk|de|fr|ru|au|mo|ca)\.(?:png|jpg|jpeg|svg|webp)/i.test(u)) return true;
  return false;
}

function isInvalidOr404(text) {
  if (!text) return false;
  const t = String(text);
  return /404\s*:\s*Not\s*Found/i.test(t) ||
         /404\s+Not\s+Found/i.test(t) ||
         /Cannot\s+GET/i.test(t) ||
         /(?:已失效|此模块已失效|资源已失效|链接已失效|文件已删除|文件不存在|404\s*失效)/i.test(t);
}

function normalizeRawURL(url) {
  if (!url) return "";
  let value = url.trim().replace(/^<|>$/g, "").replace(/&amp;/g, "&");
  value = value.replace(/\\([#_~`*])/g, "$1");
  if (value.includes("url=")) {
    const match = value.match(/[?&]url=([^&]+)/i) || value.match(/url=([^&]+)/i);
    if (match) {
      try { value = decodeURIComponent(match[1]); } catch(e) {}
    }
  }
  if (value.includes("install?module=")) {
    const match = value.match(/install\?module=([^&]+)/i);
    if (match) {
      try { value = decodeURIComponent(match[1]); } catch(e) {}
    }
  }
  value = value.replace(/#/g, "%23").replace(/\s+/g, "%20");
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "raw.githubusercontent.com") return parsed.href;
    if (parsed.hostname === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      const rawIndex = parts.indexOf("raw") !== -1 ? parts.indexOf("raw") : parts.indexOf("blob");
      if (parts.length >= 4 && rawIndex === 2) {
        return `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${parts.slice(4).join("/")}${parsed.search}`;
      }
    }
    return parsed.href;
  } catch {
    return value;
  }
}

function getModuleNameFromURL(rawURL) {
  if (!rawURL) return "";
  try {
    const cleanURL = String(rawURL).split(/[?#]/)[0];
    const parts = cleanURL.split("/").filter(Boolean);
    const last = parts.pop() || "";
    return decodeURIComponent(last).replace(/\.(?:sgmodule|srmodule|module)$/i, "").trim();
  } catch {
    return "";
  }
}

function resolveFallbackName(fallbackName, rawURL) {
  if (fallbackName && fallbackName !== "未命名模块" && fallbackName.trim()) {
    return fallbackName.trim();
  }
  return getModuleNameFromURL(rawURL) || "未命名模块";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { ...options.headers };
  if (process.env.GITHUB_TOKEN && url.includes("api.github.com")) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
    headers["User-Agent"] = "ShadowStore-Builder";
  }
  try {
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRawText(url, isPartial = true) {
  const retries = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (isPartial) {
        try {
          const response = await fetchWithTimeout(url, { headers: { Range: "bytes=0-2047" } }, 5000);
          if (response.status === 404) return "404: Not Found";
          if (response.status === 206 || response.status === 200) return await response.text();
        } catch (e) {}
      }
      const fallbackRes = await fetchWithTimeout(url, {}, 8000);
      if (fallbackRes.status === 404) return "404: Not Found";
      if (fallbackRes.ok) return await fallbackRes.text();
      throw new Error(`HTTP ${fallbackRes.status}`);
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = 500 * Math.pow(2, attempt);
      console.warn(`⚠️ 获取失败，${delay}ms 后重试 (${attempt + 1}/${retries}):${url}`);
      await wait(delay);
    }
  }
  throw new Error(`无法获取资源: ${url}`);
}

async function fetchFMZModules() {
  console.log("📦 正在获取 FMZ 目录树...");
  const res = await fetchWithTimeout(CONFIG.FMZ_TREE_API, {}, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.truncated) throw new Error("FMZ 目录树被 GitHub 截断 (truncated: true)");
  if (!Array.isArray(data?.tree)) throw new Error("FMZ Tree API 数据结构异常");
  const modules = data.tree
    .filter(item => item.type === "blob" && (item.path || "").startsWith("Shadowrocket/module/") && /\.(?:sgmodule|srmodule|module)$/i.test(item.path))
    .map(item => {
      const fileName = item.path.split("/").pop().replace(/\.(?:sgmodule|srmodule|module)$/i, "");
      const rawURL = normalizeRawURL(`https://raw.githubusercontent.com/fmz200/wool_scripts/main/${item.path}`);
      return { name: fileName, rawURL, fromFMZ: true };
    });
  if (!modules.length) throw new Error("FMZ 目录树获取成功，但未解析到模块");
  console.log(`✅ FMZ 获取 ${modules.length} 个模块`);
  return modules;
}

async function fetchZirawellModules() {
  console.log("📦 正在获取 Zirawell 模块...");
  const modules = [];
  try {
    const readme = await fetchRawText(CONFIG.ZIRAWELL_README_URL, false);
    parseRepositoryModules(readme).forEach(m => modules.push({ ...m, fromZirawell: true }));
  } catch (e) {
    console.warn("⚠️ Zirawell README 解析跳过:", e.message);
  }
  const res = await fetchWithTimeout(CONFIG.ZIRAWELL_TREE_API, {}, 15000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data?.truncated) throw new Error("Zirawell 目录树被 GitHub 截断 (truncated: true)");
  if (!Array.isArray(data?.tree)) throw new Error("Zirawell Tree API 数据结构异常");
  data.tree.forEach(item => {
    if (item.type === "blob" && (item.path || "").startsWith("Rule/Surge/") && /\.(?:sgmodule|srmodule|module)$/i.test(item.path)) {
      const fileName = item.path.split("/").pop().replace(/\.(?:sgmodule|srmodule|module)$/i, "");
      const rawURL = normalizeRawURL(`https://raw.githubusercontent.com/zirawell/R-Store/main/${item.path}`);
      modules.push({ name: fileName, rawURL, fromZirawell: true });
    }
  });
  if (!modules.length) throw new Error("Zirawell 获取成功，但未解析到模块");
  console.log(`✅ Zirawell 获取 ${modules.length} 个模块`);
  return modules;
}

async function loadLuestrIcons() {
  try {
    const res = await fetchWithTimeout(CONFIG.LUESTR_TREE_API, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tree)) {
        for (const item of data.tree) {
          const pathName = item.path || "";
          if (item.type === "blob" && /\.(?:png|jpg|jpeg|svg|webp)$/i.test(pathName)) {
            const fileName = pathName.split("/").pop().replace(/\.(?:png|jpg|jpeg|svg|webp)$/i, "");
            const url = `https://raw.githubusercontent.com/luestr/IconResource/main/${pathName}`;
            if (!isFlagKey(fileName, url)) {
              const cleanName = fileName.trim().toLowerCase();
              if (cleanName.length >= 2 && !remoteIconsMap[cleanName]) {
                remoteIconsMap[cleanName] = url;
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ IconResource 图标库拉取跳过:", e.message);
  }
}

async function loadZirawellIcons() {
  try {
    const res = await fetchWithTimeout(CONFIG.ZIRAWELL_TREE_API, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tree)) {
        for (const item of data.tree) {
          const pathName = item.path || "";
          if (item.type === "blob" && /^Res\/Icon\//i.test(pathName) && /\.(?:png|jpg|jpeg|svg|webp)$/i.test(pathName)) {
            const fileName = pathName.split("/").pop().replace(/\.(?:png|jpg|jpeg|svg|webp)$/i, "");
            const url = `https://raw.githubusercontent.com/zirawell/R-Store/main/${pathName}`;
            if (!isFlagKey(fileName, url)) {
              const cleanName = fileName.trim().toLowerCase();
              if (cleanName.length >= 2 && !remoteIconsMap[cleanName]) {
                remoteIconsMap[cleanName] = url;
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ Zirawell 图标库拉取跳过:", e.message);
  }
}

async function loadRemoteIcons() {
  remoteIconsMap = {};
  try {
    const res = await fetchWithTimeout(CONFIG.ICONS_JSON_URL, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      const extractUrl = (item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          return item.icon || item.url || item.src || item.img || item.path || item.link || "";
        }
        return "";
      };
      const extractName = (item) => {
        if (typeof item === 'object' && item !== null) {
          return item.name || item.title || item.label || item.id || item.app || "";
        }
        return "";
      };
      const addMap = (name, url) => {
        if (name && typeof name === 'string' && url && typeof url === 'string' && url.length > 5) {
          if (isFlagKey(name, url)) return;
          const cleanName = name.trim().toLowerCase();
          if (cleanName.length < 2) return;
          remoteIconsMap[cleanName] = url.trim();
          const baseName = cleanName.replace(/[_-]?\d+$/, "").trim();
          if (baseName && baseName.length >= 2 && !remoteIconsMap[baseName]) {
            remoteIconsMap[baseName] = url.trim();
          }
        }
      };
      if (Array.isArray(data)) {
        data.forEach(item => addMap(extractName(item), extractUrl(item)));
      } else if (data && typeof data === 'object') {
        const list = data.icons || data.data || data.list;
        if (Array.isArray(list)) {
          list.forEach(item => addMap(extractName(item), extractUrl(item)));
        } else {
          Object.entries(data).forEach(([k, v]) => addMap(k, extractUrl(v)));
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ FMZ 图标加载跳过:", e.message);
  }
  await Promise.all([loadLuestrIcons(), loadZirawellIcons()]);
}

function findIconInMap(key) {
  if (!key) return "";
  const lowerKey = key.toLowerCase().trim();
  if (remoteIconsMap[lowerKey] && !isFlagKey(lowerKey, remoteIconsMap[lowerKey])) return remoteIconsMap[lowerKey];
  const baseKey = lowerKey.replace(/[_-]?\d+$/, "").trim();
  if (baseKey && remoteIconsMap[baseKey] && !isFlagKey(baseKey, remoteIconsMap[baseKey])) return remoteIconsMap[baseKey];
  for (const [iconKey, iconUrl] of Object.entries(remoteIconsMap)) {
    if (isFlagKey(iconKey, iconUrl)) continue;
    const cleanIconKey = iconKey.replace(/[_-]?\d+$/, "").trim();
    if (cleanIconKey === lowerKey || (baseKey && cleanIconKey === baseKey)) {
      return iconUrl;
    }
  }
  return "";
}

function getMatchedIcon(name) {
  if (!name) return "";
  const lowerName = name.trim().toLowerCase();
  if (!lowerName) return "";
  if (lowerName.includes("youtube") || lowerName.includes("油管") || lowerName.includes("ytb")) {
    const ytIcon = findIconInMap("youtube");
    if (ytIcon) return ytIcon;
  }
  if (lowerName.includes("小米") || lowerName.includes("米家") || lowerName.includes("xiaomi") || lowerName.includes("mihome")) {
    const miIcon = findIconInMap("xiaomi") || findIconInMap("mihome") || findIconInMap("mi");
    if (miIcon) return miIcon;
  }
  let matched = findIconInMap(lowerName);
  if (matched) return matched;
  const cleanName = lowerName
    .replace(/(去广告|净化|移除|破解|签到|脚本|模块|解锁|自动|净化版|修复|增强|vip|pro|lite|hd|edge|plus|v\d+)/g, "")
    .replace(/[-_.\s]/g, "")
    .trim();
  if (cleanName && cleanName.length >= 2) {
    matched = findIconInMap(cleanName);
    if (matched) return matched;
  }
  for (const [cnKeyword, enKeys] of Object.entries(APP_ALIASES)) {
    if (lowerName.includes(cnKeyword.toLowerCase())) {
      for (const key of enKeys) {
        matched = findIconInMap(key);
        if (matched) return matched;
      }
    }
  }
  for (const [iconName, iconUrl] of Object.entries(remoteIconsMap)) {
    if (!iconName || iconName.length < 3 || isFlagKey(iconName, iconUrl)) continue;
    const baseIconName = iconName.replace(/[_-]?\d+$/, "").trim();
    if (baseIconName.length < 3 || isFlagKey(baseIconName, iconUrl)) continue;
    if (lowerName.includes(iconName) || lowerName.includes(baseIconName)) {
      return iconUrl;
    }
  }
  return "";
}

function resolveIconURL(icon, rawURL) {
  if (!icon) return "";
  icon = icon.trim();
  if (isFlagKey("", icon)) return "";
  if (icon.startsWith("data:")) return icon;
  if (/^https?:\/\//i.test(icon)) return normalizeRawURL(icon);
  try {
    const safeIcon = icon.replace(/#/g, "%23").replace(/\s+/g, "%20");
    return new URL(safeIcon, rawURL).href;
  } catch {
    return "";
  }
}

function extractIconKeyFromPath(iconStr) {
  if (!iconStr) return "";
  try {
    const clean = iconStr.split(/[?#]/)[0].trim();
    const fileName = clean.split("/").pop() || "";
    return fileName.replace(/\.(?:png|jpg|jpeg|svg|webp)$/i, "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function resolveModuleIcon(metadata, rawURL) {
  let rawIcon = metadata.icon ? metadata.icon.trim() : "";
  if (rawIcon) {
    const key = extractIconKeyFromPath(rawIcon);
    if (key) {
      const matchedVerifiedIcon = findIconInMap(key);
      if (matchedVerifiedIcon) return matchedVerifiedIcon;
    }
    let fixedIcon = rawIcon;
    if (fixedIcon.includes("zirawell/R-Store")) {
      fixedIcon = fixedIcon
        .replace("/master/", "/main/")
        .replace("/Rule/Res/Icon/", "/Res/Icon/")
        .replace("/Icon/", "/Res/Icon/");
    }
    const resolved = resolveIconURL(fixedIcon, rawURL);
    if (resolved && !resolved.includes("/Rule/Res/Icon/")) {
      return resolved;
    }
  }
  if (metadata.declaredName) {
    const matched = getMatchedIcon(metadata.declaredName);
    if (matched) return matched;
  }
  const fileName = getModuleNameFromURL(rawURL);
  if (fileName) {
    const matched = getMatchedIcon(fileName);
    if (matched) return matched;
  }
  if (metadata.name) {
    const matched = getMatchedIcon(metadata.name);
    if (matched) return matched;
  }
  return "";
}

function parseRepositoryModules(markdown) {
  if (!markdown || markdown === "404: Not Found") return [];
  const result = [];
  let currentHeading = "";
  let orderIndex = 0;
  const lines = markdown.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const headingMatch = line.match(/^(?:#{1,6}|\*|-|\+)\s*(?:\[([^\]]+)\]|`([^`]+)`|([^\n(#*]+))/);
    if (headingMatch) {
      const rawTitle = (headingMatch[1] || headingMatch[2] || headingMatch[3] || "").trim();
      const cleanTitle = cleanText(rawTitle.replace(/[*`_#]/g, "").replace(/^[🚀📁📦\s]+/, ""));
      if (cleanTitle && cleanTitle.length >= 2) currentHeading = cleanTitle;
    }
    const rawRegex = /(https?:\/\/[^\s)\]"'<>]+?\.(?:sgmodule|srmodule|module)(?:[^\s)\]"'<>]*)?)/ig;
    let match;
    while ((match = rawRegex.exec(line)) !== null) {
      let rawURL = normalizeRawURL(match[1].replace(/[),\]"'<>]+$/g, ""));
      if (!rawURL || !/\.(?:sgmodule|srmodule|module)(?:$|[?#%])/i.test(rawURL)) continue;
      result.push({
        name: getModuleNameFromURL(rawURL) || currentHeading || "未命名模块",
        rawURL,
        readmeIndex: orderIndex++
      });
    }
  }
  const seen = new Set();
  return result.filter(item => {
    const key = item.rawURL.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseGitHubRawURL(rawURL) {
  try {
    const url = new URL(rawURL);
    if (url.hostname === "raw.githubusercontent.com" || url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return {
        owner: parts[0],
        repo: parts[1],
        fullName: `${parts[0]}/${parts[1]}`,
        url: `https://github.com/${parts[0]}/${parts[1]}`
      };
    }
  } catch {}
  return null;
}

function getSourceRepoInfo(rawURL, githubInfo) {
  if (githubInfo) return { name: githubInfo.repo, url: githubInfo.url };
  try {
    const url = new URL(rawURL);
    return { name: url.hostname, url: url.origin };
  } catch {
    return { name: "开源仓库", url: "#" };
  }
}

function getAuthorFromURL(rawURL, githubInfo) {
  if (!rawURL) return { name: "作者信息识别失败", url: "", username: "" };
  try {
    const prMatch = decodeURIComponent(rawURL).match(/\/PR\/([^/?#]+)\//i);
    if (prMatch && prMatch[1] && !/\.(?:sgmodule|srmodule|module)$/i.test(prMatch[1].trim())) {
      const prAuthor = prMatch[1].trim();
      return {
        name: prAuthor,
        url: `https://github.com/${encodeURIComponent(prAuthor)}`,
        username: prAuthor
      };
    }
  } catch (e) {}
  if (githubInfo) return {
    name: githubInfo.owner,
    url: `https://github.com/${encodeURIComponent(githubInfo.owner)}`,
    username: githubInfo.owner
  };
  return { name: "作者信息识别失败", url: "", username: "" };
}

function parseModuleMetadata(text, fallbackName, rawURL = "") {
  const metadata = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 100); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("#!")) {
      const match = line.match(/^#!\s*([a-zA-Z0-9_-]+)\s*=\s*(.*)$/i);
      if (match) metadata[match[1].trim().toLowerCase()] = cleanText(match[2]);
      continue;
    }
    const commentMatch = line.match(/^(?:#|\/\/)\s*@?(?:name|规则名称|模块名称)\s*[:=]\s*(.+)$/i);
    if (commentMatch && !metadata.name) metadata.name = cleanText(commentMatch[1]);
  }
  const declaredName = metadata.name || "";
  const resolvedName = declaredName || resolveFallbackName(fallbackName, rawURL);
  return {
    name: resolvedName,
    declaredName,
    description: metadata.desc || "",
    icon: metadata.icon || ""
  };
}

function generateDescription(metadata, rawText) {
  if (metadata.description) return cleanMarkdownText(metadata.description);
  const lines = rawText.split(/\r?\n/);
  const comments = [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#!") || line.startsWith("//")) continue;
    if (line.startsWith("#")) {
      line = line.replace(/^#+\s*/, "").trim();
      if (line && !/^[-=*]+$/.test(line) && line.length >= 4) comments.push(line);
    }
  }
  return comments.length ? cleanMarkdownText(comments.slice(0, 2).join(" ")) : `${metadata.name} 模块信息获取失败，请自行判断该模块的作用和有效性。`;
}

function getPinnedRank(item) {
  if (!item) return 9999;
  const rawURL = (item.rawURL || "").toLowerCase();
  if (item.isDubious || rawURL.includes("ddgksf2013.top")) {
    return 9999;
  }
  const name = (item.name || "").toLowerCase().replace(/[\s_\-.]/g, "");
  if (name.includes("scripthub") || rawURL.includes("script-hub") || rawURL.includes("scripthub")) return 1;
  if (name.includes("substore") || rawURL.includes("sub-store") || rawURL.includes("substore")) return 2;
  if (name.includes("boxjs") || rawURL.includes("boxjs") || name.includes("box.js")) return 3;
  if (item.fromMyRepo) return 10;
  if (item.fromFMZ || rawURL.includes("fmz200")) return 40;
  if (item.fromZirawell || rawURL.includes("zirawell")) return 50;
  return 60;
}

function sortPinnedModules(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const rankDiff = getPinnedRank(a) - getPinnedRank(b);
    if (rankDiff !== 0) return rankDiff;
    if (a.fromMyRepo && b.fromMyRepo) {
      const idxA = a.readmeIndex !== undefined ? a.readmeIndex : 99999;
      const idxB = b.readmeIndex !== undefined ? b.readmeIndex : 99999;
      return idxA - idxB;
    }
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

async function fetchModule(item) {
  stats.totalAttempted++;
  const githubInfo = parseGitHubRawURL(item.rawURL);
  const sourceInfo = getSourceRepoInfo(item.rawURL, githubInfo);
  const urlAuthor = getAuthorFromURL(item.rawURL, githubInfo);
  const avatarUrl = urlAuthor.username ? `https://github.com/${encodeURIComponent(urlAuthor.username)}.png?size=64` : "";
  const fromMyRepo = item.fromMyRepo || false;
  const fromFMZ = item.fromFMZ || false;
  const fromZirawell = item.fromZirawell || false;
  const readmeIndex = item.readmeIndex !== undefined ? item.readmeIndex : 99999;
  try {
    const rawText = await fetchRawText(item.rawURL, true);
    if (!rawText || rawText === "404: Not Found") throw new Error("404 Not Found");
    const metadata = parseModuleMetadata(rawText, item.name, item.rawURL);
    const description = generateDescription(metadata, rawText);
    if (description && description.includes("已合并至")) return null;
    const icon = resolveModuleIcon(metadata, item.rawURL);
    const isDubious = isInvalidOr404(rawText) || isInvalidOr404(description);
    if (isDubious) stats.failedCount++;
    return {
      name: metadata.name,
      rawURL: item.rawURL,
      category: "module",
      description,
      author: urlAuthor,
      authorAvatar: avatarUrl,
      icon,
      sourceName: sourceInfo.name,
      sourceURL: sourceInfo.url,
      installURL: `shadowrocket://install?module=${encodeURIComponent(item.rawURL)}`,
      isDubious,
      fromMyRepo,
      fromFMZ,
      fromZirawell,
      readmeIndex,
      _searchKeywords: [metadata.name, description, urlAuthor.name, sourceInfo.name].join(" ").toLowerCase()
    };
  } catch (error) {
    stats.failedCount++;
    const resolvedName = resolveFallbackName(item.name, item.rawURL);
    const fallbackDesc = `${resolvedName || "该模块"} 模块信息获取失败，请自行判断该模块的作用和有效性。`;
    return {
      name: resolvedName,
      rawURL: item.rawURL,
      category: "module",
      description: fallbackDesc,
      author: urlAuthor,
      authorAvatar: avatarUrl,
      icon: getMatchedIcon(resolvedName) || "",
      sourceName: sourceInfo.name,
      sourceURL: sourceInfo.url,
      installURL: `shadowrocket://install?module=${encodeURIComponent(item.rawURL)}`,
      isDubious: true,
      fromMyRepo,
      fromFMZ,
      fromZirawell,
      readmeIndex,
      _searchKeywords: [resolvedName, fallbackDesc, urlAuthor.name, sourceInfo.name].join(" ").toLowerCase()
    };
  }
}

async function mapWithConcurrency(items, concurrency, handler) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      results[current] = await handler(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function validateOutputData(data) {
  if (!Array.isArray(data) || !data.length) throw new Error("❌ 最终数据为空或不是数组");
  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (!item?.name || !item?.rawURL || !item?.installURL) {
      throw new Error(`❌ 第 ${i + 1} 条资源缺少关键字段 (name/rawURL/installURL)`);
    }
  }
}

/**
 * 自动提取 Shadowrocket 配色方案
 */
async function fetchColorThemes(markdownText) {
  console.log("🎨 开始解析 Shadowrocket 配色方案...");
  const colorItems = [];
  if (!markdownText) return colorItems;

  const colorSectionIdx = markdownText.indexOf("## Shadowrocket 配色文件");
  const parseScope = colorSectionIdx !== -1 ? markdownText.slice(colorSectionIdx) : markdownText;

  const sections = parseScope.split(/(?=###\s+)/g);

  for (const sec of sections) {
    if (
      !sec.includes("Shadowrocket") ||
      sec.includes("Shadowrocket 原创配色") ||
      sec.includes("请使用相应内容替换") ||
      sec.includes("自定义配色") ||
      sec.includes("配色教程")
    ) {
      continue;
    }

    const lines = sec.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let displayName = "";

    for (let i = 1; i < lines.length; i++) {
      let line = lines[i];
      if (
        line &&
        !line.startsWith("#") &&
        !line.startsWith("[!") &&
        !line.startsWith("!") &&
        !line.startsWith("shadowrocket://") &&
        !line.startsWith("<details") &&
        !line.startsWith("<summary") &&
        !line.startsWith("<p")
      ) {
        line = line.replace(/^>+\s*/, "");
        const supMatch = line.match(/<sup>([^<]+)<\/sup>/i);
        if (supMatch) {
          displayName = supMatch[1].trim();
        } else {
          displayName = line.replace(/<[^>]+>/g, "").replace(/[*`_#~]/g, "").trim();
        }
        if (displayName && (displayName.includes("亮底色") || displayName.includes("暗底色") || displayName.length >= 2)) {
          break;
        }
      }
    }

    let previewImg = "";
    const imgTagMatch = sec.match(/<img[^>]+src=["'](https?:\/\/[^"'\s>]+)["']/i);
    if (imgTagMatch) {
      previewImg = imgTagMatch[1].trim();
    } else {
      const mdImgMatch = sec.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
      if (mdImgMatch) previewImg = mdImgMatch[1].trim();
    }

    let installScheme = "";
    const ios26Match = sec.match(/iOS\s*26\s*及以上[\s\S]*?(shadowrocket\s*:\s*\/\/\s*color\?[^\r\n\`]+)/i);
    if (ios26Match) {
      installScheme = ios26Match[1].replace(/\s+/g, "");
    } else {
      const allSchemes = Array.from(sec.matchAll(/shadowrocket\s*:\s*\/\/\s*color\?[^\r\n\`\s]+/gi));
      if (allSchemes.length > 0) {
        installScheme = allSchemes[allSchemes.length - 1][0].replace(/\s+/g, "");
      }
    }

    if (displayName && installScheme && !displayName.includes("替换代码")) {
      colorItems.push({
        name: displayName,
        rawURL: installScheme,
        installURL: installScheme,
        category: "color",
        previewImg: previewImg,
        icon: previewImg || "https://github.com/LOWERTOP.png?size=64",
        author: {
          name: "LOWERTOP",
          url: "https://github.com/LOWERTOP",
          username: "LOWERTOP"
        },
        authorAvatar: "https://github.com/LOWERTOP.png?size=64",
        sourceName: "Shadowrocket-First",
        sourceURL: "https://github.com/LOWERTOP/Shadowrocket-First#shadowrocket-%E9%85%8D%E8%89%B2%E6%96%87%E4%BB%B6",
        description: "Shadowrocket 原创精选配色方案，支持一键载入至客户端，建议搭配相应底色模式使用。",
        primaryBtnText: "安装配色",
        preInstallURL: "",
        secondaryBtnText: "",
        isDubious: false,
        fromMyRepo: true,
        _searchKeywords: [displayName, "配色", "LOWERTOP", "Shadowrocket-First"].join(" ").toLowerCase()
      });
    }
  }

  console.log(`✅ 成功解析出 ${colorItems.length} 个配色方案（已修复名称、过滤教程、提取真实截图与 iOS 26 协议）`);
  return colorItems;
}

/**
 * 自动识别并提取 README.md 里的“更多资源”小节
 * 核心逻辑调整：
 * 1. 识别徽章行，并向前/向后捕获对应的描述行（支持上文描述、下文徽章的排版）
 * 2. 从描述行首个 Markdown 链接 `[作者名](作者GitHub)` 提取作者、主页与真实头像
 * 3. 自动嗅探依赖的模块直链（.sgmodule / .srmodule），注入 preInstallURL 并展示“安装模块”
 * 4. 彻底去除简介中的 Markdown 超链接，仅保留纯文本
 */
function parseMoreResourcesFromReadme(markdownText) {
  console.log("📑 开始解析 README.md 中的“更多资源”小节...");
  const moreItems = [];
  if (!markdownText) return moreItems;

  const sectionMatch = markdownText.match(/(?:^|\n)#{1,4}\s*[^#\n]*?更多资源[\s\S]*?(?=\n#{1,3}\s+|$)/i);
  if (!sectionMatch) {
    console.warn("⚠️ 未找到匹配 '更多资源' 的章节");
    return moreItems;
  }

  const sectionContent = sectionMatch[0];
  const lines = sectionContent.split(/\r?\n/);

  // 匹配徽章格式：[![alt](badge_img)](target_url)
  const badgeRegex = /\[!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)\]\((https?:\/\/[^\s\)]+?)(?:\s+["'][^"']*["'])?\)/i;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const bMatch = line.match(badgeRegex);

    if (bMatch) {
      const badgeAlt = bMatch[1].trim();
      const badgeImg = bMatch[2].trim();
      const targetURL = bMatch[3].trim(); // 徽章链接的目标项目/网站地址

      // 忽略自身仓库和手册
      if (
        targetURL.includes("LOWERTOP/Shadowrocket-First") ||
        targetURL.includes("lowertop.github.io/Shadowrocket")
      ) {
        continue;
      }

      // 从徽章中获取默认项目标识名
      let badgeMessage = "";
      try {
        const badgeUrlObj = new URL(badgeImg);
        badgeMessage = badgeUrlObj.searchParams.get("message") || "";
      } catch (e) {}

      // 搜集该徽章相关的描述行：涵盖徽章上方 1-3 行（处理文字在上徽章在下的排版）与下方 1-3 行
      const candidateLines = [];
      for (let prev = Math.max(0, i - 3); prev < i; prev++) {
        const pLine = lines[prev].trim();
        if (pLine && !pLine.startsWith("#") && !pLine.includes("[![")) {
          candidateLines.push(pLine);
        }
      }
      for (let next = i + 1; next < Math.min(lines.length, i + 4); next++) {
        const nLine = lines[next].trim();
        if (!nLine || nLine.startsWith("#") || nLine.includes("[![")) break;
        candidateLines.push(nLine);
      }

      let detectedAuthorName = "";
      let detectedAuthorURL = "";
      let detectedAuthorUsername = "";
      let detectedModuleURL = "";
      let descText = "";

      // 分析所有候选行
      for (const cLine of candidateLines) {
        // 1. 嗅探作者链接（提取如 [Ling KeQing](https://github.com/QingRex) 或 [可莉](https://github.com/luestr)）
        const authorMatch = cLine.match(/\[([^\]]+)\]\((https?:\/\/github\.com\/([a-zA-Z0-9_-]+)(?:\/[a-zA-Z0-9_-]+)?)\)/i);
        if (authorMatch && !detectedAuthorName) {
          detectedAuthorName = authorMatch[1].trim();
          detectedAuthorUsername = authorMatch[3].trim();
          detectedAuthorURL = `https://github.com/${detectedAuthorUsername}`;
        }

        // 2. 嗅探依赖模块链接（.sgmodule / .srmodule）
        const moduleMatch = cLine.match(/(https?:\/\/[^\s)\]"'<>]+?\.(?:sgmodule|srmodule|module)|shadowrocket:\/\/install\?[^\s)\]"'<>]+)/i);
        if (moduleMatch && !detectedModuleURL) {
          const rawModuleLink = moduleMatch[1].trim();
          if (rawModuleLink.startsWith("shadowrocket://")) {
            detectedModuleURL = rawModuleLink;
          } else {
            detectedModuleURL = `shadowrocket://install?module=${encodeURIComponent(rawModuleLink)}`;
          }
        }

        // 3. 提取简介并彻底去除 Markdown 超链接
        const rawClean = cLine.replace(/^>+\s*/, "").replace(/^[*\->+]\s*/, "").trim();
        if (rawClean && !rawClean.startsWith("http")) {
          const pureText = cleanMarkdownText(rawClean);
          if (pureText && (!descText || pureText.length > descText.length)) {
            descText = pureText;
          }
        }
      }

      // 如果未在描述中明确匹配到作者，则尝试从目标 URL 或徽章兜底
      if (!detectedAuthorUsername) {
        try {
          const parsed = new URL(targetURL);
          if (parsed.hostname.includes("github.com")) {
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts[0]) {
              detectedAuthorUsername = parts[0];
              if (!detectedAuthorName) detectedAuthorName = parts[0];
              if (!detectedAuthorURL) detectedAuthorURL = `https://github.com/${parts[0]}`;
            }
          }
        } catch (e) {}
      }

      const finalAuthorName = detectedAuthorName || badgeMessage || "开源作者";
      const finalAuthorURL = detectedAuthorURL || targetURL;
      const finalItemName = badgeMessage || finalAuthorName;

      // 核心：直接读取作者的真实头像
      const authorAvatar = detectedAuthorUsername ? `https://github.com/${encodeURIComponent(detectedAuthorUsername)}.png?size=64` : "";

      let sourceName = "外部资源";
      try {
        const u = new URL(targetURL);
        if (u.hostname.includes("github.com")) {
          const parts = u.pathname.split("/").filter(Boolean);
          sourceName = parts[1] || parts[0] || "GitHub";
        } else {
          sourceName = u.hostname;
        }
      } catch (e) {}

      moreItems.push({
        id: `more_auto_${moreItems.length}_${encodeURIComponent(finalItemName).slice(0, 16)}`,
        category: "more",
        name: finalItemName,
        description: descText || "Shadowrocket 开源社区精选扩展资源。",
        icon: authorAvatar, // 卡片大图标展示作者 GitHub 头像
        author: {
          name: finalAuthorName, // 对应描述里的作者名
          url: finalAuthorURL,   // 对应描述里的作者主页
          username: detectedAuthorUsername
        },
        authorAvatar: authorAvatar,
        sourceName: sourceName,
        sourceURL: targetURL,
        rawURL: targetURL,
        installURL: targetURL, // 访问按钮跳转徽章内的网址
        primaryBtnText: "访问链接",
        preInstallURL: detectedModuleURL, // 依赖模块直链
        secondaryBtnText: detectedModuleURL ? "安装模块" : "", // 次要按钮文字为“安装模块”
        isRepoCard: true,
        isDubious: false,
        _searchKeywords: [finalItemName, descText, sourceName, finalAuthorName, "更多资源"].join(" ").toLowerCase()
      });
    }
  }

  console.log(`✅ 成功从描述超链接解析出 ${moreItems.length} 个“更多资源”条目 (已应用作者/头像/依赖模块)`);
  return moreItems;
}

/**
 * 组装“更多”标签页前置固定的两张核心卡片（手册第 1，仓库第 2）
 */
function getTopMoreCards() {
  return [
    {
      id: "more_manual",
      category: "more",
      name: "使用手册",
      description: "Shadowrocket 使用手册与进阶配置指南，系统收录了协议配置、规则分流、解密等全方位软件设置说明与知识词条。",
      primaryBtnText: "查阅手册",
      icon: "https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/refs/heads/main/img/Shadowrocket.png",
      author: {
        name: "LOWERTOP",
        url: "https://github.com/LOWERTOP",
        username: "LOWERTOP"
      },
      authorAvatar: "https://github.com/LOWERTOP.png?size=64",
      sourceName: "Shadowrocket",
      sourceURL: "https://github.com/LOWERTOP/Shadowrocket",
      rawURL: "https://github.com/LOWERTOP/Shadowrocket",
      installURL: "https://github.com/LOWERTOP/Shadowrocket",
      isDubious: false,
      isRepoCard: true,
      _searchKeywords: "使用手册 教程 shadowrocket 准官方 lowertop"
    },
    {
      id: "more_repo_first",
      category: "more",
      name: "配色与配置仓库",
      description: "Shadowrocket 精选模块、规则、配色方案的聚合类型资源仓库，汇聚了众多开源社区优质资源，也是本站的核心数据处理仓库。",
      primaryBtnText: "访问仓库",
      icon: "https://avatars.githubusercontent.com/u/16624731?v=4",
      author: {
        name: "LOWERTOP",
        url: "https://github.com/LOWERTOP",
        username: "LOWERTOP"
      },
      authorAvatar: "https://github.com/LOWERTOP.png?size=64",
      sourceName: "Shadowrocket-First",
      sourceURL: "https://github.com/LOWERTOP/Shadowrocket-First",
      rawURL: "https://github.com/LOWERTOP/Shadowrocket-First",
      installURL: "https://github.com/LOWERTOP/Shadowrocket-First",
      isDubious: false,
      isRepoCard: true,
      _searchKeywords: "配色与配置仓库 shadowrocket-first 聚合资源 核心仓库 lowertop"
    }
  ];
}

async function main() {
  console.log("⏳ 等待 60 秒上游缓存同步与网络就绪...");
  await wait(60000);
  console.log("🚀 ShadowStore 聚合构建引擎启动...\n");

  const outputPath = path.resolve(__dirname, "modules.json");
  const tempPath = `${outputPath}.tmp`;

  let repoMarkdown = "";
  try {
    repoMarkdown = await fetchRawText(CONFIG.REPO_README_URL, false);
    if (!repoMarkdown || repoMarkdown === "404: Not Found" || repoMarkdown.length < 50) throw new Error("主 README 无效");
  } catch (e) {
    try {
      repoMarkdown = await fetchRawText(CONFIG.REPO_README_BACKUP, false);
      if (!repoMarkdown || repoMarkdown === "404: Not Found" || repoMarkdown.length < 50) throw new Error("备用 README 无效");
    } catch (e2) {
      throw new Error("❌ 来源熔断：本仓库 README 获取失败，拒绝发布！");
    }
  }

  const localModules = parseRepositoryModules(repoMarkdown).map(m => ({ ...m, fromMyRepo: true }));
  if (!localModules.length) throw new Error("❌ 来源熔断：本仓库未解析到任何有效模块！");
  sourceHealth.local = true;

  const fmzModules = await fetchFMZModules();
  sourceHealth.fmz = true;

  const zirawellModules = await fetchZirawellModules();
  sourceHealth.zirawell = true;

  await loadRemoteIcons();

  const seenURLs = new Set();
  const sourceModules = [...localModules, ...fmzModules, ...zirawellModules].filter(item => {
    if (!item?.rawURL) return false;
    const k = item.rawURL.toLowerCase();
    if (seenURLs.has(k)) return false;
    seenURLs.add(k);
    return true;
  });

  console.log(`📦 去重后共 ${sourceModules.length} 个独立模块，开始抓取元数据...`);
  stats.totalAttempted = 0;
  stats.failedCount = 0;

  const result = await mapWithConcurrency(sourceModules, CONFIG.CONCURRENCY, fetchModule);
  const failureRatio = stats.totalAttempted > 0 ? stats.failedCount / stats.totalAttempted : 0;
  console.log(`📊 抓取总数: ${stats.totalAttempted} | 失败: ${stats.failedCount} | 失败率: ${(failureRatio * 100).toFixed(2)}%`);

  if (failureRatio > CONFIG.MAX_FAILURE_RATIO) {
    throw new Error(`❌ 数据熔断：失败率 ${(failureRatio * 100).toFixed(2)}% 超出安全阈值，中止发布！`);
  }

  const sortedResult = sortPinnedModules(result.filter(Boolean));

  // 1. 抓取配色方案
  const colorItems = await fetchColorThemes(repoMarkdown);

  // 2. 组装“更多”分类：手册第 1，仓库第 2，随后跟随解析出的精选资源
  const topMoreCards = getTopMoreCards();
  const autoMoreItems = parseMoreResourcesFromReadme(repoMarkdown);
  const allMoreItems = [...topMoreCards, ...autoMoreItems];

  // 3. 汇总所有资源
  const finalResources = [...sortedResult, ...colorItems, ...allMoreItems];

  validateOutputData(finalResources);
  fs.writeFileSync(tempPath, JSON.stringify(finalResources, null, 2), "utf-8");

  const verifyData = JSON.parse(fs.readFileSync(tempPath, "utf-8"));
  validateOutputData(verifyData);
  if (verifyData.length !== finalResources.length) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error("❌ 临时文件校验不一致！");
  }

  fs.renameSync(tempPath, outputPath);
  console.log(`\n🎉 ShadowStore 同步完成！共输出 ${finalResources.length} 个资源 (含 ${colorItems.length} 个配色, ${allMoreItems.length} 个更多标签页资源) 至 modules.json\n`);
}

main().catch(err => {
  console.error("\n❌ ShadowStore 构建失败:", err.message);
  const tempPath = path.resolve(__dirname, "modules.json.tmp");
  if (fs.existsSync(tempPath)) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
  process.exit(1);
});
