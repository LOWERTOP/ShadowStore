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
  const mainListRegex = new RegExp(`(https?:\\/\\/[^\\s)\\]"'<>]+\\/${dirName}\\.list)`, 'i');
  const mainListMatch = text.match(mainListRegex);
  const mainRuleUrl = mainListMatch ? mainListMatch[1].trim() : `${RAW_PREFIX}/${dirName}/${dirName}.list`;

  buttons.push({
    label: '复制规则集',
    url: mainRuleUrl
  });

  // 提取域名集直链（_Domain.list）
  const isCombined = /共同使用/.test(suggestionRaw) && /_Domain\.list/.test(suggestionRaw);
  if (isCombined) {
    const domainListRegex = new RegExp(`(https?:\\/\\/[^\\s)\\]"'<>]+\\/${dirName}_Domain\\.list)`, 'i');
    const domainListMatch = text.match(domainListRegex);
    const domainRuleUrl = domainListMatch ? domainListMatch[1].trim() : `${RAW_PREFIX}/${dirName}/${dirName}_Domain.list`;

    buttons.push({
      label: '复制域名集',
      url: domainRuleUrl
    });
  }

  // 4. 提取图标
  const iconMatch = text.match(/!\[.*?\]\((https?:\/\/.*?\.(?:png\vert{}jpg\vert{}jpeg\vert{}svg\vert{}webp).*?)\)/i);
  let icon = iconMatch ? iconMatch[1].trim() : '';

  return {
    id: dirName,
    title,
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
