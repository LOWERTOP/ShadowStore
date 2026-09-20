import fs from 'fs';
import path from 'path';

const REPO_OWNER = 'blackmatrix7';
const REPO_NAME = 'ios_rule_script';
const TARGET_PATH = 'rule/Shadowrocket';

const RAW_PREFIX =
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${TARGET_PATH}`;

const SOURCE_URL =
  `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${TARGET_PATH}/`;

const CONFIG = {
  TREE_RETRIES: 3,
  README_RETRIES: 3,
  RETRY_DELAY: 800,
  BATCH_SIZE: 15,

  // README 解析失败超过 10% 时禁止覆盖现有 rules.json
  MAX_FAILURE_RATIO: 0.10,

  // 防止 GitHub API 异常返回极少目录时生成一个残缺 rules.json
  MIN_VALID_RULES: 50
};


// ==============================
// 基础网络工具
// ==============================

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}


async function fetchText(url, retries = CONFIG.README_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          Accept: 'text/plain, text/markdown, */*'
        }
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      return await response.text();

    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await wait(CONFIG.RETRY_DELAY * (attempt + 1));
      }
    }
  }

  throw lastError;
}


async function fetchJson(url, retries = CONFIG.TREE_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = {
        Accept: 'application/vnd.github+json'
      };

      if (process.env.GITHUB_TOKEN) {
        headers.Authorization =
          `Bearer ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(url, {
        cache: 'no-store',
        headers
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      return await response.json();

    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await wait(CONFIG.RETRY_DELAY * (attempt + 1));
      }
    }
  }

  throw lastError;
}


// ==============================
// 获取 README 列表
// ==============================

async function fetchAllReadmePaths() {
  const treeUrl =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}` +
    `/git/trees/master?recursive=1`;

  const data = await fetchJson(treeUrl);

  // GitHub Trees API 如果 truncated=true，
  // 说明返回的目录树并不完整。
  // 此时绝对不能继续生成 rules.json。
  if (data?.truncated === true) {
    throw new Error(
      'Git Trees API 返回 truncated=true，' +
      '规则目录列表不完整，已中止本次同步'
    );
  }

  if (!Array.isArray(data?.tree)) {
    throw new Error(
      'Git Trees API 返回的数据结构无效'
    );
  }

  return data.tree
    .filter(item =>
      item &&
      item.type === 'blob' &&
      item.path.startsWith(`${TARGET_PATH}/`) &&
      item.path.endsWith('/README.md')
    )
    .map(item => item.path)
    .sort((a, b) => a.localeCompare(b));
}


// ==============================
// 路径处理
// ==============================

function getDirName(relPath) {
  const prefix = `${TARGET_PATH}/`;

  if (!relPath.startsWith(prefix)) {
    throw new Error(
      `README 路径不属于目标目录: ${relPath}`
    );
  }

  const relative = relPath.slice(prefix.length);
  const parts = relative.split('/');

  if (
    parts.length !== 2 ||
    parts[1] !== 'README.md' ||
    !parts[0]
  ) {
    throw new Error(
      `README 路径层级异常: ${relPath}`
    );
  }

  return parts[0];
}


// ==============================
// README 标题
// ==============================

function normalizeTitle(title, fallback) {
  if (!title) {
    return fallback;
  }

  let result = title
    .replace(/\r/g, '')
    .replace(/^#\s+/, '')
    .trim();

  // 去除标题最前面的 emoji / 装饰字符。
  //
  // 例如：
  // # 🧸 115
  // # 🧸 Apple
  //
  // 最终分别得到：
  // 115
  // Apple
  result = result
    .replace(
      /^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+[\s·•:：\-—]*)+/u,
      ''
    )
    .trim();

  return result || fallback;
}


function parseTitle(markdown, fallback) {
  const match = markdown.match(
    /^#\s+(.+?)\s*$/m
  );

  return normalizeTitle(
    match?.[1],
    fallback
  );
}


// ==============================
// README Section 解析
// ==============================

function getSection(markdown, headingText) {
  const headingMatch = markdown.match(
    new RegExp(
      `^(#{3,6})\\s*${headingText}\\s*$`,
      'im'
    )
  );

  if (!headingMatch) {
    return '';
  }

  const level = headingMatch[1].length;
  const start =
    headingMatch.index + headingMatch[0].length;

  const rest = markdown.slice(start);

  // 找到下一个相同或更高等级的标题。
  const nextHeading = rest.search(
    new RegExp(
      `^#{1,${level}}\\s+`,
      'm'
    )
  );

  return (
    nextHeading === -1
      ? rest
      : rest.slice(0, nextHeading)
  ).trim();
}


// ==============================
// 配置建议
// ==============================

function cleanSuggestion(section) {
  if (!section) {
    return '';
  }

  const lines = section
    .replace(/\r/g, '')
    .split('\n');

  const result = [];
  let inCodeBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (line.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    const cleaned = line
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();

    if (cleaned) {
      result.push(cleaned);
    }
  }

  return result.join('\n').trim();
}


// ==============================
// 从配置建议中提取 .list 文件
// ==============================

function extractListNames(text) {
  if (!text) {
    return [];
  }

  const matches =
    text.match(
      /\b[A-Za-z0-9][A-Za-z0-9._-]*\.list\b/g
    ) || [];

  return [...new Set(matches)];
}


// ==============================
// 规则文件 URL
// ==============================

function buildRuleUrl(dirName, fileName) {
  return (
    `${RAW_PREFIX}/` +
    `${encodeURIComponent(dirName)}/` +
    `${encodeURIComponent(fileName)}`
  );
}


// ==============================
// 按文件类型生成按钮名称
// ==============================

function getButtonLabel(fileName, primaryFileName) {
  if (fileName === primaryFileName) {
    return '复制规则集';
  }

  if (/_Domain\.list$/i.test(fileName)) {
    return '复制域名集';
  }

  if (/_Resolve\.list$/i.test(fileName)) {
    return '复制解析集';
  }

  return `复制 ${fileName}`;
}


// ==============================
// 从 README 的 MASTER 链接中寻找实际 URL
// ==============================

function findMasterUrl(
  markdown,
  dirName,
  fileName
) {
  const escapedFileName =
    fileName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );

  const patterns = [
    new RegExp(
      `https://raw\\.githubusercontent\\.com/` +
      `${REPO_OWNER}/${REPO_NAME}/master/` +
      `${TARGET_PATH}/${dirName}/` +
      `${escapedFileName}`,
      'i'
    ),

    new RegExp(
      `https://cdn\\.jsdelivr\\.net/[^\\s)]+/` +
      `${escapedFileName}`,
      'i'
    )
  ];

  for (const pattern of patterns) {
    const match = markdown.match(pattern);

    if (match?.[0]) {
      return match[0].replace(/[),.;]+$/, '');
    }
  }

  return buildRuleUrl(
    dirName,
    fileName
  );
}


// ==============================
// 构建 buttons
// ==============================

function buildButtons(
  dirName,
  markdown,
  suggestion
) {
  /*
   * 核心原则：
   *
   * 1. 配置建议里明确出现哪些 .list
   *    就优先使用哪些文件。
   *
   * 2. 不再通过：
   *
   *    isCombined === true
   *
   *    然后机械生成：
   *
   *    ${dirName}_Domain.list
   *
   *    因为这会导致 Apple 这类规则判断错误。
   */

  let fileNames =
    extractListNames(suggestion);

  /*
   * 如果 README 没有配置建议，
   * 则默认使用 ${dirName}.list。
   */
  if (!fileNames.length) {
    fileNames = [
      `${dirName}.list`
    ];
  }

  /*
   * 如果配置建议中存在：
   *
   * Apple.list
   * Apple_Domain.list
   * Apple_Resolve.list
   *
   * 则保留 README 中出现的顺序。
   */

  const primaryFileName =
    fileNames.find(
      name => name === `${dirName}.list`
    ) ||
    fileNames[0];

  const buttons = fileNames.map(fileName => ({
    label: getButtonLabel(
      fileName,
      primaryFileName
    ),

    url: findMasterUrl(
      markdown,
      dirName,
      fileName
    )
  }));

  /*
   * 规则集主按钮必须存在。
   */
  if (
    !buttons.some(
      button =>
        button.url ===
        findMasterUrl(
          markdown,
          dirName,
          primaryFileName
        )
    )
  ) {
    buttons.unshift({
      label: '复制规则集',
      url: findMasterUrl(
        markdown,
        dirName,
        primaryFileName
      )
    });
  }

  /*
   * 只有配置建议里明确存在多个规则文件，
   * 才认为这是组合规则。
   */
  const isCombined =
    fileNames.length > 1 &&
    /共同使用/.test(suggestion);

  return {
    buttons,
    primaryFileName,
    isCombined
  };
}


// ==============================
// 单个规则解析
// ==============================

async function parseRule(relPath) {
  const dirName =
    getDirName(relPath);

  const readmeUrl =
    `https://raw.githubusercontent.com/` +
    `${REPO_OWNER}/${REPO_NAME}/master/` +
    `${relPath}`;

  try {
    const markdown =
      await fetchText(readmeUrl);

    /*
     * 规则名称：
     *
     * 只认 README 的一级标题。
     *
     * 例如：
     *
     * # 🧸 115
     * → 115
     *
     * # 🧸 Apple
     * → Apple
     */
    const name =
      parseTitle(
        markdown,
        dirName
      );

    /*
     * 注意：
     * 上游 README 实际使用：
     *
     * #### 配置建议
     *
     * 旧版本的：
     *
     * ###\s*配置建议
     *
     * 无法可靠匹配四级标题。
     */
    const suggestionSection =
      getSection(
        markdown,
        '配置建议'
      );

    const suggestion =
      cleanSuggestion(
        suggestionSection
      );

    const {
      buttons,
      isCombined
    } = buildButtons(
      dirName,
      markdown,
      suggestion
    );

    const primaryButton =
      buttons.find(
        button =>
          button.label === '复制规则集'
      ) || buttons[0];

    const rawURL =
      primaryButton?.url ||
      buildRuleUrl(
        dirName,
        `${dirName}.list`
      );

    /*
     * 最终输出直接使用 ShadowStore
     * 当前卡片系统需要的数据结构。
     */
    return {
      id: `rule_${dirName}`,

      name,

      category: 'rule',

      /*
       * 不再人为添加：
       *
       * 配置建议：
       *
       * 而是直接显示 README 中的实际建议。
       *
       * 例如：
       *
       * Apple.list、Apple_Domain.list 共同使用。
       * Apple_Resolve.list、Apple_Domain.list 共同使用。
       */
      description:
        suggestion ||
        '暂无配置建议',

      author: {
        name: REPO_OWNER,
        username: REPO_OWNER,
        url:
          `https://github.com/${REPO_OWNER}`
      },

      authorAvatar:
        `https://github.com/${REPO_OWNER}.png?size=64`,

      sourceName:
        REPO_NAME,

      /*
       * 这里非常重要：
       *
       * sourceURL 是 Shadowrocket
       * 规则总目录。
       *
       * 不能写成：
       *
       * /Shadowrocket/Apple
       * /Shadowrocket/115
       *
       * 否则卡片来源会变成具体子规则目录。
       */
      sourceURL:
        SOURCE_URL,

      /*
       * rawURL 才是当前具体规则文件。
       */
      rawURL,

      installURL: '',

      isDubious: false,

      isRepoCard: false,

      isCombined,

      buttons
    };

  } catch (error) {
    console.error(
      `解析异常 [${dirName}]:`,
      error.message
    );

    return null;
  }
}


// ==============================
// 输出数据完整性检查
// ==============================

function validateRule(item) {
  if (!item || typeof item !== 'object') {
    return false;
  }

  if (
    typeof item.id !== 'string' ||
    !item.id.startsWith('rule_')
  ) {
    return false;
  }

  if (
    typeof item.name !== 'string' ||
    !item.name.trim()
  ) {
    return false;
  }

  if (item.category !== 'rule') {
    return false;
  }

  if (
    typeof item.description !== 'string'
  ) {
    return false;
  }

  if (
    !item.author ||
    item.author.username !== REPO_OWNER
  ) {
    return false;
  }

  if (
    item.sourceURL !== SOURCE_URL
  ) {
    return false;
  }

  if (
    typeof item.rawURL !== 'string' ||
    !item.rawURL.startsWith(
      `${RAW_PREFIX}/`
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(item.buttons) ||
    item.buttons.length === 0
  ) {
    return false;
  }

  return item.buttons.every(
    button =>
      button &&
      typeof button.label === 'string' &&
      typeof button.url === 'string' &&
      /^https?:\/\//i.test(button.url)
  );
}


// ==============================
// 主程序
// ==============================

async function main() {
  console.log(
    '检索规则目录列表中...'
  );

  const paths =
    await fetchAllReadmePaths();

  console.log(
    `检索到 ${paths.length} 个规则目录`
  );

  /*
   * 防止 API 异常导致整个 rules.json
   * 被替换成极少量数据。
   */
  if (
    paths.length <
    CONFIG.MIN_VALID_RULES
  ) {
    throw new Error(
      `检索到的规则目录数量异常：` +
      `${paths.length}，低于安全阈值 ` +
      `${CONFIG.MIN_VALID_RULES}`
    );
  }

  const results = [];
  const failures = [];

  for (
    let i = 0;
    i < paths.length;
    i += CONFIG.BATCH_SIZE
  ) {
    const batch =
      paths.slice(
        i,
        i + CONFIG.BATCH_SIZE
      );

    const batchResults =
      await Promise.all(
        batch.map(
          async relPath => {
            const item =
              await parseRule(relPath);

            if (!item) {
              failures.push(relPath);
              return null;
            }

            return item;
          }
        )
      );

    results.push(
      ...batchResults.filter(Boolean)
    );

    console.log(
      `已处理: ` +
      `${Math.min(
        i + CONFIG.BATCH_SIZE,
        paths.length
      )} / ${paths.length}`
    );
  }

  /*
   * README 失败比例保护。
   */
  const failureRatio =
    failures.length /
    paths.length;

  if (
    failureRatio >
    CONFIG.MAX_FAILURE_RATIO
  ) {
    throw new Error(
      `README 解析失败比例过高：` +
      `${failures.length}/${paths.length} ` +
      `(${(failureRatio * 100).toFixed(1)}%)，` +
      `已中止写入 rules.json`
    );
  }

  /*
   * 输出结构检查。
   */
  const invalid =
    results.filter(
      item => !validateRule(item)
    );

  if (invalid.length > 0) {
    throw new Error(
      `生成的数据存在 ` +
      `${invalid.length} 条结构异常记录，` +
      `已中止写入 rules.json`
    );
  }

  /*
   * ID 唯一性检查。
   */
  const ids = new Set();
  const duplicates = [];

  for (const item of results) {
    if (ids.has(item.id)) {
      duplicates.push(item.id);
    }

    ids.add(item.id);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `检测到重复规则 ID：` +
      `${duplicates.join(', ')}` +
      `，已中止写入 rules.json`
    );
  }

  /*
   * 最终数量保护。
   */
  if (
    results.length <
    Math.floor(paths.length * 0.9)
  ) {
    throw new Error(
      `有效规则数量异常：` +
      `${results.length}/${paths.length}，` +
      `已中止写入 rules.json`
    );
  }

  const outputPath =
    path.resolve(
      'scripts/rules.json'
    );

  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      results,
      null,
      2
    ) + '\n',
    'utf-8'
  );

  console.log(
    `生成完毕！已写入 ${outputPath}，` +
    `有效规则数: ${results.length}，` +
    `失败: ${failures.length}`
  );
}


main().catch(error => {
  console.error(
    '规则同步失败:',
    error
  );

  process.exitCode = 1;
});
