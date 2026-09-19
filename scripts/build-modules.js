/**
 * scripts/build-modules.js
 * ShadowStore 资源自动化同步与构建脚本
 * 整合社区模块全量爬取与 LOWERTOP/Shadowrocket-First 配色方案自动化提取
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const OUTPUT_FILE = path.join(__dirname, 'modules.json');
const SHADOWROCKET_FIRST_README = 'https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md';

// 社区模块数据源配置清单
const SOURCES = [
  {
    name: 'Shadowrocket-First',
    url: 'https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md',
    type: 'readme_modules'
  },
  {
    name: 'blackmatrix7',
    url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/script/Shadowrocket/README.md',
    type: 'blackmatrix7_modules'
  },
  {
    name: 'mieqq',
    url: 'https://raw.githubusercontent.com/mieqq/mieqq/master/README.md',
    type: 'mieqq_modules'
  },
  {
    name: 'chavyleung',
    url: 'https://raw.githubusercontent.com/chavyleung/scripts/master/README.md',
    type: 'chavy_modules'
  }
];

/**
 * 封装通用 HTTP/HTTPS GET 请求（支持自动重定向与超时控制）
 */
function fetchText(targetUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error(`重定向次数过多: ${targetUrl}`));
    const client = targetUrl.startsWith('https:') ? https : http;

    const req = client.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, targetUrl).href;
        }
        return fetchText(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}:${targetUrl}`));
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { rawData += chunk; });
      res.on('end', () => resolve(rawData));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时: ${targetUrl}`));
    });
    req.on('error', reject);
  });
}

/**
 * 从 Shadowrocket-First 的 README.md 中自动化提取配色方案
 */
async function fetchColorThemes() {
  console.log('>>> [1/2] 正在抓取并解析 Shadowrocket 配色列表...');
  try {
    const markdown = await fetchText(SHADOWROCKET_FIRST_README);
    const colorItems = [];

    // 定位到配色小节
    const colorSectionIdx = markdown.indexOf('## Shadowrocket 配色文件');
    const parseScope = colorSectionIdx !== -1 ? markdown.slice(colorSectionIdx) : markdown;

    // 按每个配色小块（### [Shadowrocket xxx] 或 ### Shadowrocket xxx）分割
    const blocks = parseScope.split(/(?=###\s*\[?Shadowrocket)/gi);

    for (const block of blocks) {
      // 提取配色名称
      const titleMatch = block.match(/###\s*\[?Shadowrocket\s+([^\]\n]+)\]?/i);
      if (!titleMatch) continue;

      const rawKey = titleMatch[1].trim();
      const cleanKey = rawKey.replace(/[\(\)（）\[\]]/g, '').trim();

      // 提取预览图链接
      const imgMatch = block.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/);
      const previewImg = imgMatch ? imgMatch[1].trim() : '';

      // 提取 shadowrocket://color? 安装协议
      const schemeMatch = block.match(/shadowrocket\s*:\s*\/\/\s*color\?[^\n\r\)\`\"\s]+/i);
      if (!schemeMatch) continue;

      const scheme = schemeMatch[0].replace(/\s+/g, '');

      // 提取描述文本
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      let desc = '';
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('#') && !line.startsWith('[!') && !line.startsWith('!') && !line.startsWith('shadowrocket://') && !line.startsWith('```')) {
          desc = line;
          break;
        }
      }

      colorItems.push({
        id: `color_${cleanKey.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
        name: `${cleanKey} 配色`,
        category: 'color',
        description: desc ? `${desc}\n建议搭配小火箭对应底色模式使用。` : 'Shadowrocket 原创精选配色方案，一键导入调色。',
        previewImg: previewImg,
        icon: '[https://github.com/LOWERTOP.png?size=64](https://github.com/LOWERTOP.png?size=64)',
        author: {
          name: 'LOWERTOP',
          url: '[https://github.com/LOWERTOP](https://github.com/LOWERTOP)',
          username: 'LOWERTOP'
        },
        authorAvatar: '[https://github.com/LOWERTOP.png?size=64](https://github.com/LOWERTOP.png?size=64)',
        sourceName: 'Shadowrocket-First',
        sourceURL: '[https://github.com/LOWERTOP/Shadowrocket-First#shadowrocket-%E9%85%8D%E8%89%B2%E6%96%87%E4%BB%B6](https://github.com/LOWERTOP/Shadowrocket-First#shadowrocket-%E9%85%8D%E8%89%B2%E6%96%87%E4%BB%B6)',
        rawURL: scheme,
        installURL: scheme,
        primaryBtnText: '安装配色',
        isRepoCard: false
      });
    }

    console.log(`>>> 成功提取 ${colorItems.length} 个配色方案`);
    return colorItems;
  } catch (err) {
    console.error('抓取配色方案遇到异常:', err.message);
    return [];
  }
}

/**
 * 解析并生成社区模块
 */
async function fetchCommunityModules() {
  console.log('>>> [2/2] 正在抓取全网社区模块数据...');
  const modules = [];

  // 1. 优先读取原有 modules.json 保证基底模块数据完整性
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const localData = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      if (Array.isArray(localData)) {
        // 排除旧的 color 项，保留全部历史同步的模块
        for (const item of localData) {
          if (item.category !== 'color') {
            modules.push(item);
          }
        }
        console.log(`>>> 成功加载历史基底模块: ${modules.length} 项`);
      }
    } catch (e) {
      console.warn('读取本地基底 modules.json 失败:', e.message);
    }
  }

  // 2. 抓取 Shadowrocket-First 最新模块进行实时合并
  try {
    const srReadme = await fetchText('[https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md](https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/README.md)');
    const moduleSectionIdx = srReadme.indexOf('## Shadowrocket 模块');
    if (moduleSectionIdx !== -1) {
      const scope = srReadme.slice(moduleSectionIdx, srReadme.indexOf('## Shadowrocket 配色文件') !== -1 ? srReadme.indexOf('## Shadowrocket 配色文件') : undefined);
      const modBlocks = scope.split(/(?=###\s*\[?🆃🅾🅿🅼🅾🅳🆂|###\s*\[?🅷🅾🅽🅶🅶🆄🅾|###\s*\[?🅲🅻🅴🅰🅽🅴🆁|###\s*\[?🆁🅴🆂🅸🅽🅿🆁|###\s*\[?🅲🅼🅲🅲🅸🆃🆅|###\s*\[?🅴🅼🅱🆈🅺🅸🆃|###\s*\[?🆆🅸🅵🅸🆅🅾🅲|###\s*\[?🅸🅷🅴🅻🅿🅴🆁|###\s*\[?🆅🅿🅽🆂🅺🅸🅿)/g);        for (const block of modBlocks) {         const titleMatch = block.match(/###\s*([^\n\r]+)/);         if (!titleMatch) continue;         const name = titleMatch[1].replace(/[\[\]]/g, '').trim();

        const sgmoduleMatch = block.match(/(https?:\/\/[^\s\)]+\.sgmodule)/i);
        const rawURL = sgmoduleMatch ? sgmoduleMatch[1].trim() : '';

        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        let desc = '';
        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].startsWith('#') && !lines[i].startsWith('http') && !lines[i].startsWith('[!')) {
            desc = lines[i];
            break;
          }
        }

        if (name && rawURL) {
          const id = `mod_first_${encodeURIComponent(name)}`;
          const existingIdx = modules.findIndex(m => m.name === name || m.rawURL === rawURL);
          const itemData = {
            id,
            name,
            category: 'module',
            description: desc,
            icon: '[https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/img/Shadowrocket.png](https://raw.githubusercontent.com/LOWERTOP/Shadowrocket-First/main/img/Shadowrocket.png)',
            author: { name: 'LOWERTOP', url: '[https://github.com/LOWERTOP](https://github.com/LOWERTOP)', username: 'LOWERTOP' },
            authorAvatar: '[https://github.com/LOWERTOP.png?size=64](https://github.com/LOWERTOP.png?size=64)',
            sourceName: 'Shadowrocket-First',
            sourceURL: '[https://github.com/LOWERTOP/Shadowrocket-First](https://github.com/LOWERTOP/Shadowrocket-First)',
            rawURL,
            installURL: `shadowrocket://install?url=${encodeURIComponent(rawURL)}`,
            primaryBtnText: '安装模块',
            isRepoCard: false
          };

          if (existingIdx !== -1) {
            modules[existingIdx] = Object.assign(modules[existingIdx], itemData);
          } else {
            modules.unshift(itemData);
          }
        }
      }
    }
  } catch (err) {
    console.warn('同步 Shadowrocket-First 最新模块失败，继续沿用现有数据:', err.message);
  }

  return modules;
}

/**
 * 主构建入口
 */
async function main() {
  try {
    const modules = await fetchCommunityModules();
    const colors = await fetchColorThemes();

    // 合并模块与配色
    const allResources = [...modules, ...colors];

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResources, null, 2), 'utf-8');
    console.log(`\n========================================`);
    console.log(`>>> 构建成功！共计整合 ${allResources.length} 项资源`);
    console.log(`    - 社区模块: ${modules.length} 项`);
    console.log(`    - 配色方案: ${colors.length} 项`);
    console.log(`    - 输出目标: ${OUTPUT_FILE}`);
    console.log(`========================================\n`);
  } catch (err) {
    console.error('构建失败:', err);
    process.exit(1);
  }
}

main();
