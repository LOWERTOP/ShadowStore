import fs from 'fs';
import path from 'path';

const REPO_OWNER = 'blackmatrix7';
const REPO_NAME = 'ios_rule_script';
const TARGET_PATH = 'rule/Shadowrocket';
const RAW_PREFIX = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${TARGET_PATH}`;

// 规则同步安全阈值：单次同步失败比例超过此值时，直接终止构建。
// 宁可本次不更新，也不要生成残缺的 rules.json。
const MAX_FAILURE_RATIO = 0.10;

// 延时辅助函数
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function getHeaders() {
  const headers = {
    'User-Agent': 'ShadowStore-Sync-Bot',
    'Accept': 'application/vnd.github.v3+json'
  };

  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

// 通过 Git Trees API 获取所有包含 README.md 的规则目录
async function fetchAllReadmeNodes() {
  const treeUrl =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/master?recursive=1`;

  const res = await fetch(treeUrl, {
    headers: getHeaders()
  });

  if (!res.ok) {
    throw new Error(
      `Git Trees API 响应失败: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();

  // GitHub Tree API 在数据量过大时可能返回截断结果。
  // 截断意味着当前树并不完整，绝不能继续生成 rules.json。
  if (data?.truncated === true) {
    throw new Error(
      'Git Trees API 返回了 truncated=true，规则目录列表不完整，已中止本次同步'
    );
  }

  const nodes = (data.tree || []).filter(item =>
    item &&
    item.path &&
    item.path.startsWith(`${TARGET_PATH}/`) &&
    item.path.endsWith('/README.md')
  );

  if (!nodes.length) {
    throw new Error('Git Trees API 未找到任何有效规则 README.md');
  }

  return nodes;
}

// 解析单个规则 README.md 并组装为与 modules 完全兼容的数据结构
async function parseRuleItem(itemNode) {
  const parts = itemNode.path.split('/');
  const dirName = parts[2];

  const readmeUrl =
    `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${itemNode.path}`;

  try {
    const res = await fetch(readmeUrl);

    if (!res.ok) {
      console.warn(
        `读取规则 ${dirName} README 失败: ${res.status} ${res.statusText}`
      );
      return null;
    }

    const text = await res.text();

    // 提取规则名称
    const nameMatch = text.match(/^#\s+[^\w\s]*\s*(.+)$/m);
    const title = nameMatch ? nameMatch[1].trim() : dirName;

    // 提取配置建议内容
    const configMatch = text.match(/###\s*配置建议([\s\S]*?)(?=###|$)/);
    const suggestionRaw = configMatch
      ? configMatch[1].trim()
      : '';

    const cleanSuggestion = suggestionRaw
      .replace(/^[-*]\s*/gm, '')
      .trim();

    // 判断是否为共同使用
    const isCombined =
      /共同使用/.test(suggestionRaw) &&
      /_Domain\.list/.test(suggestionRaw);

    // 提取 MASTER 分支直链
    const masterLinkMatch = text.match(
      /\*MASTER分支\s*\(每日更新\)\*[\s\r\n]+(?:\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s\r\n]+))/
    );

    let mainUrl = '';

    if (masterLinkMatch) {
      mainUrl =
        masterLinkMatch[2] ||
        masterLinkMatch[3] ||
        masterLinkMatch[1] ||
        '';
    } else {
      mainUrl =
        `${RAW_PREFIX}/${dirName}/${dirName}.list`;
    }

    mainUrl = mainUrl.trim();

    const buttons = [
      {
        label: '复制规则集',
        url: mainUrl
      }
    ];

    if (isCombined) {
      buttons.push({
        label: '复制域名集',
        url: `${RAW_PREFIX}/${dirName}/${dirName}_Domain.list`
      });
    }

    // 与现有模块字段完全对齐，确保 category、搜索和首字母直接可用
    return {
      id: `rule_${dirName}`,
      name: title,
      category: 'rule',
      description: cleanSuggestion
        ? `配置建议：\n${cleanSuggestion}`
        : '配置建议：单独使用。',
      author: {
        name: 'blackmatrix7',
        url: 'https://github.com/blackmatrix7',
        username: 'blackmatrix7'
      },
      authorAvatar:
        'https://github.com/blackmatrix7.png?size=64',
      sourceName: 'ios_rule_script',
      sourceURL:
        `https://github.com/${REPO_OWNER}/${REPO_NAME}/tree/master/${TARGET_PATH}/${dirName}`,
      rawURL: mainUrl,
      installURL: '',
      isDubious: false,
      isRepoCard: false,
      isCombined,
      buttons
    };
  } catch (err) {
    console.warn(
      `解析规则 ${dirName} 异常:`,
      err.message
    );
    return null;
  }
}

async function main() {
  console.log(
    '正在获取 blackmatrix7 规则库树状列表...'
  );

  const nodes = await fetchAllReadmeNodes();

  console.log(
    `检测到 ${nodes.length} 个规则目录`
  );

  const results = [];

  const BATCH_SIZE = 15;

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(
      i,
      i + BATCH_SIZE
    );

    const batchData = await Promise.all(
      batch.map(node => parseRuleItem(node))
    );

    results.push(
      ...batchData.filter(Boolean)
    );

    const processed = Math.min(
      i + BATCH_SIZE,
      nodes.length
    );

    console.log(
      `进度: ${processed} / ${nodes.length}`
    );

    // 每批次请求完成后缓冲延时 300ms，
    // 防止触发外部源的高频限流
    if (processed < nodes.length) {
      await wait(300);
    }
  }

  const failedCount =
    nodes.length - results.length;

  const failureRatio =
    nodes.length > 0
      ? failedCount / nodes.length
      : 1;

  console.log(
    `规则解析结果: 成功 ${results.length}，失败 ${failedCount}，失败率 ${(failureRatio * 100).toFixed(2)}%`
  );

  // 核心安全机制：
  // 如果本次规则解析失败比例超过阈值，
  // 直接终止，不写入新的 rules.json。
  if (failureRatio > MAX_FAILURE_RATIO) {
    throw new Error(
      `规则同步异常：失败 ${failedCount}/${nodes.length}，失败率 ${(failureRatio * 100).toFixed(2)}% 超过允许阈值 ${(MAX_FAILURE_RATIO * 100).toFixed(0)}%，已中止写入，保留现有 rules.json`
    );
  }

  // 即使失败率未超过阈值，也必须确保最终数据不是空集。
  if (!results.length) {
    throw new Error(
      '规则同步失败：未生成任何有效规则，已中止写入'
    );
  }

  results.sort((a, b) =>
    a.name.localeCompare(
      b.name,
      'zh-Hans-CN'
    )
  );

  const outputPath =
    path.resolve('scripts/rules.json');

  fs.writeFileSync(
    outputPath,
    JSON.stringify(results, null, 2),
    'utf-8'
  );

  console.log(
    `生成完毕！数据已写入 ${outputPath}，共 ${results.length} 项有效规则`
  );
}

main().catch(err => {
  console.error(
    '规则生成失败:',
    err
  );

  process.exit(1);
});
