import fs from 'fs';
import path from 'path';

const REPO_OWNER = 'blackmatrix7';
const REPO_NAME = 'ios_rule_script';
const TARGET_PATH = 'rule/Shadowrocket';
const RAW_PREFIX = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${TARGET_PATH}`;

async function fetchAllReadmePaths() {
  const treeUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/master?recursive=1`;
  const headers = process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {};
  const res = await fetch(treeUrl, { headers });
  if (!res.ok) {
    throw new Error(`Git Trees API 请求失败: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();

  return data.tree
    .filter(item => item.path.startsWith(`${TARGET_PATH}/`) && item.path.endsWith('/README.md'))
    .map(item => item.path);
}

async function parseRule(relPath) {
  const parts = relPath.split('/');
  const dirName = parts[2];
  const readmeUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/master/${relPath}`;

  try {
    const res = await fetch(readmeUrl);
    if (!res.ok) return null;
    const text = await res.text();

    const nameMatch = text.match(/^#\s+[^\w\s]*\s*(.+)$/m);
    const title = nameMatch ? nameMatch[1].trim() : dirName;

    const configMatch = text.match(/###\s*配置建议([\s\S]*?)(?=###|$)/);
    const suggestionRaw = configMatch ? configMatch[1].trim() : '';
    const cleanSuggestion = suggestionRaw.replace(/^[-*]\s*/gm, '').trim();

    const isCombined = /共同使用/.test(suggestionRaw) && /_Domain\.list/.test(suggestionRaw);

    const masterLinkMatch = text.match(/\*MASTER分支\s*\(每日更新\)\*[\s\r\n]+(?:\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s\r\n]+))/);
    let mainUrl = '';
    if (masterLinkMatch) {
      mainUrl = masterLinkMatch[2] || masterLinkMatch[3] || masterLinkMatch[1];
    } else {
      mainUrl = `${RAW_PREFIX}/${dirName}/${dirName}.list`;
    }

    const buttons = [
      {
        label: '复制规则集',
        url: mainUrl.trim()
      }
    ];

    if (isCombined) {
      buttons.push({
        label: '复制域名集',
        url: `${RAW_PREFIX}/${dirName}/${dirName}_Domain.list`
      });
    }

    return {
      id: dirName,
      title,
      suggestion: cleanSuggestion,
      isCombined,
      buttons
    };
  } catch (err) {
    console.error(`解析异常 [${dirName}]:`, err.message);
    return null;
  }
}

async function main() {
  console.log('检索规则目录列表中...');
  const paths = await fetchAllReadmePaths();
  console.log(`检索到 ${paths.length} 个规则目录`);

  const results = [];
  const BATCH_SIZE = 15;

  for (let i = 0; i < paths.length; i += BATCH_SIZE) {
    const batch = paths.slice(i, i + BATCH_SIZE);
    const batchData = await Promise.all(batch.map(p => parseRule(p)));
    results.push(...batchData.filter(Boolean));
    console.log(`已处理: ${Math.min(i + BATCH_SIZE, paths.length)} / ${paths.length}`);
  }

  const outputPath = path.resolve('scripts/rules.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`生成完毕！已写入 ${outputPath}，有效规则数: ${results.length}`);
}

main();
