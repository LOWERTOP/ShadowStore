const fs = require("fs");

const file = "scripts/build-modules.js";

let content = fs.readFileSync(file, "utf8");

/* =========================================================
 * 1. 引入统一图标模块
 * ========================================================= */

if (!content.includes('require("./build-icons")')) {
  content = content.replace(
    'const path = require("path");',
    `const path = require("path");

const {
  loadRemoteIcons,
  getMatchedIcon
} = require("./build-icons");`
  );
}

/* =========================================================
 * 2. 删除模块 JS 自己维护的图标配置
 * ========================================================= */

content = content.replace(
  /  ICONS_JSON_URL:.*\r?\n/,
  ""
);

content = content.replace(
  /  LUESTR_TREE_API:.*\r?\n/,
  ""
);

/* =========================================================
 * 3. 删除 APP_ALIASES
 * ========================================================= */

content = content.replace(
  /const APP_ALIASES = \{[\s\S]*?\n\};\r?\n\r?\n/,
  ""
);

/* =========================================================
 * 4. 删除 FLAG_CODES + remoteIconsMap
 * ========================================================= */

content = content.replace(
  /const FLAG_CODES = new Set\(\[[\s\S]*?\]\);\r?\n\r?\nlet remoteIconsMap = \{\};\r?\n/,
  ""
);

/* =========================================================
 * 5. 删除旧的图标加载/匹配函数
 *
 * 保留：
 *   resolveIconURL()
 *   extractIconKeyFromPath()
 *   resolveModuleIcon()
 *
 * 删除：
 *   isFlagKey()
 *   loadLuestrIcons()
 *   loadZirawellIcons()
 *   loadRemoteIcons()
 *   findIconInMap()
 *   getMatchedIcon()
 * ========================================================= */

const iconStart = content.indexOf("function isFlagKey(");
const iconEnd = content.indexOf("function resolveIconURL(", iconStart);

if (iconStart !== -1 && iconEnd !== -1) {
  content =
    content.slice(0, iconStart) +
    content.slice(iconEnd);
}

/* =========================================================
 * 6. resolveModuleIcon 改用公共图标匹配器
 * ========================================================= */

content = content.replace(
  /findIconInMap\(key\)/g,
  "getMatchedIcon(key)"
);

/* =========================================================
 * 7. 防止出现重复 require
 * ========================================================= */

const requirePattern =
  /const \{\s*loadRemoteIcons,\s*getMatchedIcon\s*\} = require\("\.\/build-icons"\);\r?\n/g;

const matches = content.match(requirePattern);

if (matches && matches.length > 1) {
  let first = true;

  content = content.replace(
    requirePattern,
    match => {
      if (first) {
        first = false;
        return match;
      }
      return "";
    }
  );
}

/* =========================================================
 * 8. 基础完整性检查
 * ========================================================= */

const required = [
  'require("./build-icons")',
  "loadRemoteIcons",
  "getMatchedIcon",
  "function resolveIconURL(",
  "function extractIconKeyFromPath(",
  "function resolveModuleIcon(",
  "await loadRemoteIcons();",
  "function parseRepositoryModules(",
  "function fetchModule(",
  "function mapWithConcurrency(",
  "function fetchColorThemes(",
  "function parseMoreResourcesFromReadme(",
  "function getTopMoreCards(",
  "async function main()"
];

for (const item of required) {
  if (!content.includes(item)) {
    throw new Error(`修改失败：缺少必要内容 -> ${item}`);
  }
}

/* =========================================================
 * 9. 确认旧图标系统已经完全移除
 * ========================================================= */

const forbidden = [
  "const APP_ALIASES = {",
  "const FLAG_CODES = new Set(",
  "let remoteIconsMap = {};",
  "function isFlagKey(",
  "function loadLuestrIcons(",
  "function loadZirawellIcons(",
  "function findIconInMap(",
  "function getMatchedIcon("
];

for (const item of forbidden) {
  if (content.includes(item)) {
    throw new Error(`修改失败：旧图标逻辑仍然存在 -> ${item}`);
  }
}

/* =========================================================
 * 10. 写回文件
 * ========================================================= */

fs.writeFileSync(file, content, "utf8");

console.log("✅ build-modules.js 图标逻辑已改为统一引用 build-icons.js");
console.log("✅ 原模块解析、排序、来源、作者、配色、更多资源逻辑均未重写");