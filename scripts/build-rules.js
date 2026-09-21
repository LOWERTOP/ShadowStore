/**
 * ShadowStore 规则集自动化构建引擎
 * 增强特性：Git Trees truncated 熔断、从 README 真实提取直链杜绝硬编码幽灵链接、配置建议提取与原子写盘
 */
const fs = require('fs');
const path = require('path');

const REPO_OWNER = 'blackmatrix7';
const REPO_NAME = 'ios_rule_script';
const RAW_PREFIX = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/rule/Shadowrocket`;

const BATCH_SIZE = 15;
const MAX_RETRIES = 2;


/* ==================== 图标匹配：与 build-modules.js 共用同一套逻辑 ==================== */

const ICONS_JSON_URL = 'https://raw.githubusercontent.com/fmz200/wool_scripts/main/icons/icons-all.json';
const LUESTR_TREE_API = 'https://api.github.com/repos/luestr/IconResource/git/trees/main?recursive=1';
const ZIRAWELL_TREE_API = 'https://api.github.com/repos/zirawell/R-Store/git/trees/main?recursive=1';

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

function isFlagKey(key, url = "") {
  if (!key && !url) return false;

  const k = (key || "").toLowerCase().trim();
  const u = (url || "").toLowerCase().trim();

  if (FLAG_CODES.has(k)) return true;

  const flagKeywords = [
    "flag", "flags", "国旗", "node", "节点",
    "country", "countries", "region", "regions", "geoip"
  ];

  if (flagKeywords.some(w => k.includes(w) || u.includes(w))) return true;

  if (/\/(?:flags?|countries|regions|country)\//i.test(u)) return true;

  if (/[_\-/](?:cn|us|hk|tw|jp|kr|sg|gb|uk|de|fr|ru|au|mo|ca)\.(?:png|jpg|jpeg|svg|webp)/i.test(u)) {
    return true;
  }

  return false;
}

async function loadLuestrIcons() {
  try {
    const res = await fetchWithRetry(LUESTR_TREE_API);

    if (res && res.ok) {
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
    const res = await fetchWithRetry(ZIRAWELL_TREE_API);

    if (res && res.ok) {
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
    const res = await fetchWithRetry(ICONS_JSON_URL);

    if (res && res.ok) {
      const data = await res.json();

      const extractUrl = (item) => {
        if (typeof item === 'string') return item;

        if (typeof item === 'object' && item !== null) {
          return item.icon ||
            item.url ||
            item.src ||
            item.img ||
            item.path ||
            item.link ||
            "";
        }

        return "";
      };

      const extractName = (item) => {
        if (typeof item === 'object' && item !== null) {
          return item.name ||
            item.title ||
            item.label ||
            item.id ||
            item.app ||
            "";
        }

        return "";
      };

      const addMap = (name, url) => {
        if (
          name &&
          typeof name === 'string' &&
          url &&
          typeof url === 'string' &&
          url.length > 5
        ) {
          if (isFlagKey(name, url)) return;

          const cleanName = name.trim().toLowerCase();

          if (cleanName.length < 2) return;

          remoteIconsMap[cleanName] = url.trim();

          const baseName = cleanName
            .replace(/[_-]?\d+$/, "")
            .trim();

          if (
            baseName &&
            baseName.length >= 2 &&
            !remoteIconsMap[baseName]
          ) {
            remoteIconsMap[baseName] = url.trim();
          }
        }
      };

      if (Array.isArray(data)) {
        data.forEach(item => addMap(
          extractName(item),
          extractUrl(item)
        ));
      } else if (data && typeof data === 'object') {
        const list = data.icons || data.data || data.list;

        if (Array.isArray(list)) {
          list.forEach(item => addMap(
            extractName(item),
            extractUrl(item)
          ));
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

  if (
    remoteIconsMap[lowerKey] &&
    !isFlagKey(lowerKey, remoteIconsMap[lowerKey])
  ) {
    return remoteIconsMap[lowerKey];
  }

  const baseKey = lowerKey
    .replace(/[_-]?\d+$/, "")
    .trim();

  if (
    baseKey &&
    remoteIconsMap[baseKey] &&
    !isFlagKey(baseKey, remoteIconsMap[baseKey])
  ) {
    return remoteIconsMap[baseKey];
  }

  for (const [iconKey, iconUrl] of Object.entries(remoteIconsMap)) {
    if (isFlagKey(iconKey, iconUrl)) continue;

    const cleanIconKey = iconKey
      .replace(/[_-]?\d+$/, "")
      .trim();

    if (
      cleanIconKey === lowerKey ||
      (baseKey && cleanIconKey === baseKey)
    ) {
      return iconUrl;
    }
  }

  return "";
}

function getMatchedIcon(name) {
  if (!name) return "";

  const lowerName = name.trim().toLowerCase();

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
    if (
      !iconName ||
      iconName.length < 3 ||
      isFlagKey(iconName, iconUrl)
    ) {
      continue;
    }

    const baseIconName = iconName
      .replace(/[_-]?\d+$/, "")
      .trim();

    if (
      baseIconName.length < 3 ||
      isFlagKey(baseIconName, iconUrl)
    ) {
      continue;
    }

    if (
      lowerName.includes(iconName) ||
      lowerName.includes(baseIconName)
    ) {
      return iconUrl;
    }
  }

  return "";
}

function resolveRuleIcon(id, title) {
  const candidates = [];

  if (id && String(id).trim()) {
    candidates.push(String(id).trim());
  }

  if (
    title &&
    String(title).trim() &&
    String(title).trim() !== String(id || '').trim()
  ) {
    candidates.push(String(title).trim());
  }

  for (const candidate of candidates) {
    const icon = getMatchedIcon(candidate);

    if (icon) {
      return {
        iconKey: candidate,
        icon
      };
    }
  }

  return {
    iconKey: candidates[0] || String(title || '').trim() || '',
    icon: ''
  };
}


/* ==================== 原有代码开始 ==================== */

async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = { ...options.headers };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
        headers['User-Agent'] = 'ShadowStore-Rules-Builder';
      }
      const res = await fetch(url, { ...options, headers });
      if (res.ok) return res;
      if (res.status === 404) return res;
    } catch (e) {
      if (i === retries) throw e;
      await new Promise(r => setTimeout(r, 600 * Math.pow(2, i)));
    }
  }
  return null;
}

/**
 * 获取规则目录树
 * 核心优化：增加针对 GitHub Git Trees API 的 truncated 校验
 */
async function getRulePaths() {
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/master?recursive=1`;
  const res = await fetchWithRetry(treeUrl);
  if (!res || !res.ok) throw new Error(`无法获取目录树: HTTP ${res?.status}`);

  const data = await res.json();

  // 关键改进 ①：截断校验，绝不使用不完整的残缺目录树
  if (data?.truncated) {
    throw new Error('❌ 来源熔断：Git Trees API 返回 truncated: true，目录树被截断，拒绝生成规则数据！');
  }

  if (!Array.isArray(data?.tree)) {
    throw new Error('❌ 来源熔断：Git Trees API 返回的数据结构异常！');
  }

  return data.tree
    .filter(item =>
      item.type === 'blob' &&
      item.path.startsWith('rule/Shadowrocket/') &&
      item.path.endsWith('/README.md')
    )
    .map(item => item.path);
}

/**
 * 解析单个规则的 README
 * 核心优化：从 README 内真实提取 .list 与 _Domain.list 的直链，不再盲猜拼接
 */
async function parseRule(readmePath) {
  const rawUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${readmePath}`;
  const res = await fetchWithRetry(rawUrl);
  if (!res || !res.ok) return null;

  const text = await res.text();
  const dirName = readmePath.split('/')[2];

  // 1. 提取规则标题并彻底去除 Emoji 及首尾残留符号
  const titleMatch = text.match(/#\s*(.+)/);
  let rawTitle = titleMatch ? titleMatch[1].trim() : dirName;
  const title = rawTitle
    .replace(/\p{Extended_Pictographic}/gu, '') // 去除 Unicode Emoji 图标
    .replace(/^[\s\-_—·|/:：]+|[\s\-_—·|/:：]+$/g, '') // 清除首尾因去除表情残留的连字符、标点与空格
    .trim() || dirName; // 如果清理后为空则回退使用目录名

  // 2. 提取配置建议
  const configMatch = text.match(/###\s*配置建议([\s\S]*?)(?=###|$)/);
  let suggestion = '';
  let suggestionRaw = '';

  if (configMatch) {
    suggestionRaw = configMatch[1];
    suggestion = suggestionRaw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.includes('_Resolve.list'))
      .join('\n');
  }

  // 3. 关键改进 ②：从 README 提取真实的直链，避免硬编码推导导致幽灵链接
  const buttons = [];

  // 提取主规则直链（.list）
  const mainListRegex = new RegExp(`(https?:\\/\\/[^\\s)\\]\"'<>]+\\/${dirName}\\.list)`, 'i');
  const mainListMatch = text.match(mainListRegex);
  const mainRuleUrl = mainListMatch ? mainListMatch[1].trim() : `${RAW_PREFIX}/${dirName}/${dirName}.list`;

  buttons.push({
    label: '复制规则集',
    url: mainRuleUrl
  });

  // 提取域名集直链（_Domain.list）
  const isCombined = /共同使用/.test(suggestionRaw) && /_Domain\\.list/.test(suggestionRaw);
  if (isCombined) {
    const domainListRegex = new RegExp(`(https?:\\/\\/[^\\s)\\]\"'<>]+\\/${dirName}_Domain\\.list)`, 'i');
    const domainListMatch = text.match(domainListRegex);
    const domainRuleUrl = domainListMatch ? domainListMatch[1].trim() : `${RAW_PREFIX}/${dirName}/${dirName}_Domain.list`;

    buttons.push({
      label: '复制域名集',
      url: domainRuleUrl
    });
  }

  // 4. 提取图标
  const iconMatch = text.match(/!\[.*?\]\((https?:\/\/.*?\.(?:png|jpg|jpeg|svg|webp).*?)\)/i);
  const readmeIcon = iconMatch ? iconMatch[1].trim() : '';

  // 优先使用现有图标库匹配；匹配不到才回退 README 原图标
  const resolvedIcon = resolveRuleIcon(dirName, title);
  const icon = resolvedIcon.icon || readmeIcon;

  return {
    id: dirName,
    title,
    iconKey: resolvedIcon.iconKey || dirName,
    suggestion,
    icon,
    isCombined,
    buttons
  };
}

async function main() {
  console.log('🚀 开始获取 Blackmatrix7 规则列表...');
  const paths = await getRulePaths();
  console.log(`📦 共发现 ${paths.length} 个规则 README，开始批量解析...`);

  // 加载现有图标库，供规则构建阶段直接匹配
  await loadRemoteIcons();

  const results = [];
  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const batchData = await Promise.all(batch.map(p => parseRule(p)));
    results.push(...batchData.filter(Boolean));
    process.stdout.write(`\r⏳ 进度: ${Math.min(i + BATCH_SIZE, paths.length)} / ${paths.length}`);
  }
  console.log('\n✅ 规则详情解析完成！');

  const outputPath = path.resolve(__dirname, 'rules.json');
  const tempPath = `${outputPath}.tmp`;

  // 质量与数量熔断检查
  if (results.length < 50) {
    throw new Error(`❌ 数量熔断：提取的规则总数 (${results.length}) 严重偏低，拒绝写入！`);
  }

  if (fs.existsSync(outputPath)) {
    try {
      const oldData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
      if (Array.isArray(oldData) && results.length < oldData.length * 0.7) {
        throw new Error(`❌ 波动熔断：本次解析数量 (${results.length}) 远低于旧数据基准 (${oldData.length})！`);
      }
    } catch (e) {
      if (e.message.includes('波动熔断')) throw e;
    }
  }

  // 原子化写盘
  fs.writeFileSync(tempPath, JSON.stringify(results, null, 2), 'utf-8');
  const verify = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
  if (verify.length !== results.length) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    throw new Error('❌ 校验失败：临时文件数据条目不一致！');
  }

  fs.renameSync(tempPath, outputPath);
  console.log(`🎉 rules.json 构建成功！共输出 ${results.length} 条规则。\n`);
}

main().catch(err => {
  console.error('\n❌ rules 构建失败:', err.message);
  const tempPath = path.resolve(__dirname, 'rules.json.tmp');
  if (fs.existsSync(tempPath)) {
    try { fs.unlinkSync(tempPath); } catch (e) {}
  }
  process.exit(1);
});
