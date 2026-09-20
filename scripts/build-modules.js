/**
 * 自动识别并提取 README.md 里的“更多资源”小节
 */
function parseMoreResourcesFromReadme(markdownText) {
  console.log("📑 开始解析 README.md 中的“更多资源”小节...");
  const moreItems = [];
  if (!markdownText) return moreItems;

  const sectionMatch = markdownText.match(/(?:^|\n)#{1,4}\s*[^#\n]*?更多资源[\s\S]*?(?=\n#{1,3}\s+|$)/i);
  if (!sectionMatch) {
    console.warn("⚠️ 未找到匹配 '更多资源' 的章节");
    return moreItems;
  }

  const sectionContent = sectionMatch[0];
  const lines = sectionContent.split(/\r?\n/);

  // 匹配徽章格式：[![alt](badge_img)](target_url)
  const badgeRegex = /\[!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)\]\((https?:\/\/[^\s\)]+?)(?:\s+["'][^"']*["'])?\)/i;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    const bMatch = line.match(badgeRegex);

    if (bMatch) {
      const badgeAlt = bMatch[1].trim();
      const badgeImg = bMatch[2].trim();
      const resourceURL = bMatch[3].trim(); // 下一行徽章内的目标网址 -> 映射到卡片的访问链接按钮

      // 忽略自身仓库和手册
      if (
        resourceURL.includes("LOWERTOP/Shadowrocket-First") ||
        resourceURL.includes("lowertop.github.io/Shadowrocket")
      ) {
        continue;
      }

      // 从徽章中获取资源显示名
      let badgeMessage = "";
      try {
        const badgeUrlObj = new URL(badgeImg);
        badgeMessage = badgeUrlObj.searchParams.get("message") || "";
      } catch (e) {}

      // 获取前一行描述文字
      let descRawLine = "";
      for (let prev = i - 1; prev >= Math.max(0, i - 4); prev--) {
        const pLine = lines[prev].trim().replace(/^>+\s*/, "");
        if (pLine && !pLine.startsWith("#") && !pLine.includes("[![")) {
          descRawLine = pLine;
          break;
        }
      }

      let detectedAuthorName = "";
      let detectedAuthorURL = "";
      let detectedAuthorUsername = "";
      let detectedRepoName = "";
      let detectedRepoURL = "";
      let detectedModuleURL = "";
      let descText = "";

      if (descRawLine) {
        // 从前一行文字中提取所有超链接 [文字](URL)
        const allLinks = Array.from(descRawLine.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/gi));

        if (allLinks.length > 0) {
          // 首个链接必为作者信息
          const firstLink = allLinks[0];
          detectedAuthorName = firstLink[1].trim();
          detectedAuthorURL = firstLink[2].trim();

          try {
            const u = new URL(detectedAuthorURL);
            if (u.hostname.includes("github.com")) {
              const parts = u.pathname.split("/").filter(Boolean);
              detectedAuthorUsername = parts[0] || "";
            }
          } catch (e) {}

          // 遍历后续链接
          for (let k = 1; k < allLinks.length; k++) {
            const linkText = allLinks[k][1].trim();
            const linkHref = allLinks[k][2].trim();

            // 【关键修复】：必须严格校验 URL 是否为小火箭模块文件或安装协议！
            const isStrictModuleFile = /\.(?:sgmodule|srmodule|module)(?:$|[?#%])/i.test(linkHref);
            const isInstallScheme = linkHref.startsWith("shadowrocket://install");

            if (isStrictModuleFile || isInstallScheme) {
              if (!detectedModuleURL) {
                if (isInstallScheme) {
                  detectedModuleURL = linkHref;
                } else {
                  detectedModuleURL = `shadowrocket://install?module=${encodeURIComponent(linkHref)}`;
                }
              }
            } else if (linkHref.includes("github.com") && !detectedRepoURL) {
              // 普通 GitHub 链接归类为源仓库信息（例如 LoonKissSurge 仓库）
              detectedRepoName = linkText;
              detectedRepoURL = linkHref;
            }
          }
        }

        // 纯净化描述文字
        descText = cleanMarkdownText(descRawLine);
      }

      if (!detectedAuthorUsername) {
        try {
          const parsed = new URL(resourceURL);
          if (parsed.hostname.includes("github.com")) {
            const parts = parsed.pathname.split("/").filter(Boolean);
            if (parts[0]) {
              detectedAuthorUsername = parts[0];
              if (!detectedAuthorName) detectedAuthorName = parts[0];
              if (!detectedAuthorURL) detectedAuthorURL = `https://github.com/${parts[0]}`;
            }
          }
        } catch (e) {}
      }

      const finalAuthorName = detectedAuthorName || badgeMessage || "开源作者";
      const finalAuthorURL = detectedAuthorURL || resourceURL;
      const finalItemName = badgeMessage || finalAuthorName;
      const authorAvatar = detectedAuthorUsername ? `https://github.com/${encodeURIComponent(detectedAuthorUsername)}.png?size=64` : "";

      let sourceName = detectedRepoName || "外部资源";
      if (!detectedRepoName) {
        try {
          const u = new URL(resourceURL);
          if (u.hostname.includes("github.com")) {
            const parts = u.pathname.split("/").filter(Boolean);
            sourceName = parts[1] || parts[0] || "GitHub";
          } else {
            sourceName = u.hostname;
          }
        } catch (e) {}
      }

      moreItems.push({
        id: `more_auto_${moreItems.length}_${encodeURIComponent(finalItemName).slice(0, 16)}`,
        category: "more",
        name: finalItemName,
        description: descText || "Shadowrocket 开源社区精选扩展资源。",
        icon: authorAvatar,
        author: {
          name: finalAuthorName,
          url: finalAuthorURL,
          username: detectedAuthorUsername
        },
        authorAvatar: authorAvatar,
        sourceName: sourceName,
        sourceURL: detectedRepoURL || resourceURL,
        rawURL: resourceURL,
        installURL: resourceURL,
        primaryBtnText: "访问链接",
        preInstallURL: detectedModuleURL, // 只有严格匹配到 .sgmodule 等模块直链时才会赋值
        secondaryBtnText: detectedModuleURL ? "安装模块" : "", // 只有在有模块时才显示安装模块按钮
        isRepoCard: true,
        isDubious: false,
        _searchKeywords: [finalItemName, descText, sourceName, finalAuthorName, "更多资源"].join(" ").toLowerCase()
      });
    }
  }

  console.log(`✅ 成功解析出 ${moreItems.length} 个“更多资源”条目 (含 ${moreItems.filter(m => m.preInstallURL).length} 个带依赖模块安装)`);
  return moreItems;
}
