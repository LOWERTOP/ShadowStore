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

        const buttons = [{ label: '复制规则集', url: mainUrl.trim() }];
        if (isCombined) {
            buttons.push({ label: '复制域名集', url: `${RAW_PREFIX}/${dirName}/${dirName}_Domain.list` });
        }
        return { id: dirName, title, suggestion: cleanSuggestion, isCombined, buttons };
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

    const newRulesCount = results.length;
    const outputPath = path.resolve('scripts/rules.json');
    const tempPath = outputPath + '.tmp';

    // 1. 读取旧数据用于熔断对比
    let oldRulesCount = 0;
    if (fs.existsSync(outputPath)) {
        try {
            const oldData = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
            oldRulesCount = Array.isArray(oldData) ? oldData.length : 0;
        } catch (e) {
            console.warn('⚠️ 读取旧规则文件解析失败，跳过历史对比。');
        }
    }

    // 2. 🛡️ 数量熔断机制（防止上游规则异常导致批量清空）
    const MIN_ABSOLUTE_LIMIT = 50;
    if (newRulesCount < MIN_ABSOLUTE_LIMIT) {
        console.error(`❌ [熔断警报] 有效规则数 (${newRulesCount}) 低于硬底线 (${MIN_ABSOLUTE_LIMIT})，中止写入！`);
        process.exit(1);
    }
    if (oldRulesCount > 0 && newRulesCount < oldRulesCount * 0.7) {
        console.error(`❌ [熔断警报] 规则数较上次剧烈下降！上次: ${oldRulesCount}, 本次: ${newRulesCount}（低于 70% 阈值），中止写入！`);
        process.exit(1);
    }

    // 3. 📝 原子写盘机制（防止写文件时中断导致文件损坏）
    const fileContent = JSON.stringify(results, null, 2);
    fs.writeFileSync(tempPath, fileContent, 'utf-8');

    // 二次校验临时文件能否正常解析
    const parsedCheck = JSON.parse(fs.readFileSync(tempPath, 'utf-8'));
    if (!parsedCheck || parsedCheck.length === 0) {
        console.error('❌ 原子写入校验失败：生成的数据解析为空！');
        process.exit(1);
    }

    // 瞬间替换正式文件
    fs.renameSync(tempPath, outputPath);
    console.log(`✅ 生成完毕！已原子写入 ${outputPath}，有效规则数: ${newRulesCount}`);
}

main();
