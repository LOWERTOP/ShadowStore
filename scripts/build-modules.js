/**
 * scripts/build-modules.js
 * ShadowStore 资源自动化同步与构建脚本
 * 负责拉取社区模块与 LOWERTOP/Shadowrocket-First 的配色列表，生成 modules.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const CACHE_FILE = path.join(__dirname, 'modules.json');
const SHADOWROCKET_FIRST_README = 'https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md';

// 社区模块数据源配置（按原项目定义）
const SOURCES = [
  {
    name: 'Shadowrocket-First',
    url: 'https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md',
    type: 'readme_modules'
  }
  // 如果你有其他的社区模块源配置，保留在数组中即可
];

/**
 * 封装通用 HTTPS GET 请求
 */
function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'ShadowStore-Build-Bot' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchText(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Request failed with status code ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * 从 Shadowrocket-First 的 README.md 中提取配色文件
 */
async function fetchColorThemes() {
  console.log('>>> 正在抓取并解析 Shadowrocket 配色列表...');
  try {
    const markdown = await fetchText(SHADOWROCKET_FIRST_README);
    const colorItems = [];

    // 定位到配色小节
    const colorSectionIndex = markdown.indexOf('## Shadowrocket 配色文件');
    if (colorSectionIndex === -1) {
      console.warn('未在 README.md 中找到 "## Shadowrocket 配色文件" 标识');
      return [];
    }

    const text = markdown.slice(colorSectionIndex);

    // 正则拆分各个配色小块：### [Shadowrocket xxx]
    const sections = text.split(/(?=###\s*\[Shadowrocket\s+[^\]]+\])/g);

    for (const sec of sections) {
      const titleMatch = sec.match(/###\s*\[Shadowrocket\s+([^\]]+)\]/);
      if (!titleMatch) continue;

      const colorKey = titleMatch[1].trim();

      // 提取副标题/描述（标题后紧跟的文本行）
      const lines = sec.split('\n').map(l => l.trim()).filter(Boolean);
      let desc = '';
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].startsWith('#') && !lines[i].startsWith('[!') && !lines[i].startsWith('shadowrocket://')) {
          desc = lines[i];
          break;
        }
      }

      // 提取预览图直链
      const imgMatch = sec.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
      const previewImg = imgMatch ? imgMatch[1].trim() : '';

      // 提取 shadowrocket://color? 安装协议
      // 处理 Markdown 换行或包含空格的情况
      const rawSchemeMatch = sec.match(/shadowrocket\s*:\s*\/\/\s*color\?[^\n\r\)]+/i);
      let installScheme = '';
      if (rawSchemeMatch) {
        installScheme = rawSchemeMatch[0].replace(/\s+/g, '');
      }

      if (colorKey && installScheme) {
        colorItems.push({
          id: `color_${colorKey.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
          name: `${colorKey} 配色`,
          category: 'color',
          description: desc ? `${desc}\n建议搭配小火箭相应底色模式使用。` : 'Shadowrocket 原创精选配色方案。',
          previewImg: previewImg,
          icon: 'https://github.com/LOWERTOP.png?size=64',
          author: {
            name: 'LOWERTOP',
            url: 'https://github.com/LOWERTOP',
            username: 'LOWERTOP'
          },
          authorAvatar: 'https://github.com/LOWERTOP.png?size=64',
          sourceName: 'Shadowrocket-First',
          sourceURL: 'https://github.com/LOWERTOP/Shadowrocket-First#shadowrocket-%E9%85%8D%E8%89%B2%E6%96%87%E4%BB%B6',
          rawURL: installScheme,
          installURL: installScheme,
          primaryBtnText: '安装配色',
          isRepoCard: false
        });
      }
    }

    console.log(`>>> 成功提取 ${colorItems.length} 个配色方案`);
    return colorItems;
  } catch (err) {
    console.error('抓取配色方案失败:', err.message);
    return [];
  }
}

/**
 * 抓取社区常规模块（兼容保留原有逻辑）
 */
async function fetchModules() {
  console.log('>>> 正在抓取社区模块列表...');
  // 此处为原有 modules 抓取逻辑，若直接依赖已有数据或原解析函数可在此承接
  let existingModules = [];
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const localData = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      // 过滤掉旧的 color 项，保留模块
      existingModules = localData.filter(item => item.category !== 'color');
    } catch (e) {
      existingModules = [];
    }
  }
  return existingModules;
}

/**
 * 主执行入口
 */
async function main() {
  try {
    const modules = await fetchModules();
    const colors = await fetchColorThemes();

    // 合并模块与配色
    const allResources = [...modules, ...colors];

    fs.writeFileSync(CACHE_FILE, JSON.stringify(allResources, null, 2), 'utf-8');
    console.log(`>>> 索引文件更新完成：共写入 ${allResources.length} 项资源 (含 ${colors.length} 个配色) 到 ${CACHE_FILE}`);
  } catch (error) {
    console.error('构建失败:', error);
    process.exit(1);
  }
}

main();
