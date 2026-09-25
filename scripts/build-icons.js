const CONFIG = {
  ICONS_JSON_URL: "https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/icons-all.json",
  LUESTR_TREE_API: "https://api.github.com/repos/luestr/IconResource/git/trees/main?recursive=1",
  ZIRAWELL_TREE_API: "https://api.github.com/repos/zirawell/R-Store/git/trees/main?recursive=1"
};

const APP_ALIASES = {
  "Plugin2Rocket": ["script-hub"],
  "NSCheckin": ["cookie"],
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
  "高德地图": ["amap"],
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
  "12306": ["12306"]
};

const FLAG_CODES = new Set([
  "cn", "us", "hk", "tw", "jp", "kr", "sg", "uk", "gb", "de", "fr", "ca", "ru",
  "au", "mo", "vn", "th", "ph", "my", "in", "id", "br", "cl", "ar", "mx", "nl",
  "se", "no", "fi", "ch", "at", "it", "es", "pt", "tr", "ua", "za", "nz", "ie",
  "pl", "ro", "cz", "hu", "gr", "bg", "hr", "sk", "il", "china", "taiwan",
  "hongkong", "japan", "korea", "singapore", "usa", "united_states",
  "united_kingdom", "germany", "france", "russia", "australia"
]);

let remoteIconsMap = {};

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

function isFlagKey(key, url = "") {
  if (!key && !url) return false;
  const k = (key || "").toLowerCase().trim();
  const u = (url || "").toLowerCase().trim();

  if (FLAG_CODES.has(k)) return true;

  const flagKeywords = [
    "flag", "flags", "国旗", "node", "节点", "country", "countries",
    "region", "regions", "geoip"
  ];
  if (flagKeywords.some(w => k.includes(w) || u.includes(w))) return true;
  if (/\/(?:flags?|countries|regions|country)\//i.test(u)) return true;
  if (/[_\-\/](?:cn|us|hk|tw|jp|kr|sg|gb|uk|de|fr|ru|au|mo|ca)\.(?:png|jpg|jpeg|svg|webp)/i.test(u)) {
    return true;
  }
  return false;
}

async function loadLuestrIcons() {
  try {
    const res = await fetchWithTimeout(CONFIG.LUESTR_TREE_API, {}, 8000);
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.tree)) {
        for (const item of data.tree) {
          const pathName = item.path || "";
          if (
            item.type === "blob" &&
            /\.(?:png|jpg|jpeg|svg|webp)$/i.test(pathName)
          ) {
            const fileName = pathName
              .split("/")
              .pop()
              .replace(/\.(?:png|jpg|jpeg|svg|webp)$/i, "");
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
          if (
            item.type === "blob" &&
            /^Res\/Icon\//i.test(pathName) &&
            /\.(?:png|jpg|jpeg|svg|webp)$/i.test(pathName)
          ) {
            const fileName = pathName
              .split("/")
              .pop()
              .replace(/\.(?:png|jpg|jpeg|svg|webp)$/i, "");
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
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          return item.icon || item.url || item.src || item.img || item.path || item.link || "";
        }
        return "";
      };
      const extractName = (item) => {
        if (typeof item === "object" && item !== null) {
          return item.name || item.title || item.label || item.id || item.app || "";
        }
        return "";
      };
      const addMap = (name, url) => {
        if (
          name &&
          typeof name === "string" &&
          url &&
          typeof url === "string" &&
          url.length > 5
        ) {
          if (isFlagKey(name, url)) return;
          const cleanName = name.trim().toLowerCase();
          if (cleanName.length < 2) return;
          remoteIconsMap[cleanName] = url.trim();
          const baseName = cleanName
            .replace(/[_-]?\d+$/, "")
            .trim();
          if (baseName && baseName.length >= 2 && !remoteIconsMap[baseName]) {
            remoteIconsMap[baseName] = url.trim();
          }
        }
      };

      if (Array.isArray(data)) {
        data.forEach(item => {
          addMap(extractName(item), extractUrl(item));
        });
      } else if (data && typeof data === "object") {
        const list = data.icons || data.data || data.list;
        if (Array.isArray(list)) {
          list.forEach(item => {
            addMap(extractName(item), extractUrl(item));
          });
        } else {
          Object.entries(data).forEach(([k, v]) => {
            addMap(k, extractUrl(v));
          });
        }
      }
    }
  } catch (e) {
    console.warn("⚠️ FMZ 图标加载跳过:", e.message);
  }

  await Promise.all([
    loadLuestrIcons(),
    loadZirawellIcons()
  ]);
}

function findIconInMap(key) {
  if (!key) return "";
  const lowerKey = key.toLowerCase().trim();

  if (remoteIconsMap[lowerKey] && !isFlagKey(lowerKey, remoteIconsMap[lowerKey])) {
    return remoteIconsMap[lowerKey];
  }

  const baseKey = lowerKey
    .replace(/[_-]?\d+$/, "")
    .trim();
  if (baseKey && remoteIconsMap[baseKey] && !isFlagKey(baseKey, remoteIconsMap[baseKey])) {
    return remoteIconsMap[baseKey];
  }

  for (const [iconKey, iconUrl] of Object.entries(remoteIconsMap)) {
    if (isFlagKey(iconKey, iconUrl)) continue;
    const cleanIconKey = iconKey
      .replace(/[_-]?\d+$/, "")
      .trim();
    if (cleanIconKey === lowerKey || (baseKey && cleanIconKey === baseKey)) {
      return iconUrl;
    }
  }

  return "";
}

/**
 * 匹配或获取图标
 * @param {string} name 模块或规则名称
 * @param {string} [originalIcon=""] 模块自身附带的原图标链接
 * @returns {string} 优先返回模块自带图标，不存在或无效时返回匹配的图标链接
 */
function getMatchedIcon(name, originalIcon = "") {
  // 1. 首选：模块自带图标
  if (typeof originalIcon === "string" && originalIcon.trim().length > 5) {
    const rawIcon = originalIcon.trim();
    if (!isFlagKey("", rawIcon)) {
      return rawIcon;
    }
  }

  // 2. 次选：根据名称匹配图标库
  if (!name) return "";

  // 预清洗：剥离特殊区域指示符、方块字母（如 🆃🅾🅿🅼🅾🅳🆂）和 Emoji 符号
  const strippedName = String(name)
    .replace(/[\uD83C\uDD00-\uD83C\uDDFF]/gu, "")
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "")
    .trim();

  const lowerName = (strippedName || name).trim().toLowerCase();
  if (!lowerName) return "";

  if (
    lowerName.includes("youtube") ||
    lowerName.includes("油管") ||
    lowerName.includes("ytb")
  ) {
    const ytIcon = findIconInMap("youtube");
    if (ytIcon) return ytIcon;
  }

  if (
    lowerName.includes("小米") ||
    lowerName.includes("米家") ||
    lowerName.includes("xiaomi") ||
    lowerName.includes("mihome")
  ) {
    const miIcon =
      findIconInMap("xiaomi") ||
      findIconInMap("mihome") ||
      findIconInMap("mi");
    if (miIcon) return miIcon;
  }

  let matched = findIconInMap(lowerName);
  if (matched) return matched;

  const cleanName = lowerName
    .replace(
      /(去广告|净化|移除|破解|签到|脚本|模块|解锁|自动|净化版|修复|增强|vip|pro|lite|hd|edge|plus|v\d+)/g,
      ""
    )
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
    if (!iconName || iconName.length < 3 || isFlagKey(iconName, iconUrl)) {
      continue;
    }
    const baseIconName = iconName
      .replace(/[_-]?\d+$/, "")
      .trim();
    if (baseIconName.length < 3 || isFlagKey(baseIconName, iconUrl)) {
      continue;
    }
    if (lowerName.includes(iconName) || lowerName.includes(baseIconName)) {
      return iconUrl;
    }
  }

  return "";
}

module.exports = {
  loadRemoteIcons,
  getMatchedIcon
};
