class Html2MdConverter {
  constructor() {
    this.isFeishu = false;
    this.settings = {};
    this.init();
  }

  init() {
    this.detectFeishu();
    this.setupMessageListener();
  }

  detectFeishu() {
    const url = window.location.href;
    this.isFeishu = url.includes('feishu.cn') || 
                     url.includes('larksuite.com') ||
                     document.querySelector('.feishu-doc') ||
                     document.querySelector('[data-feishu-doc]');
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'convertToMarkdown') {
        this.settings = request.settings || {};
        this.handleConvert(sendResponse);
        return true;
      }
    });
  }

  async handleConvert(sendResponse) {
    try {
      if (this.settings.smartScroll) {
        await this.smartScroll();
      }

      if (this.settings.feishuOptimization && this.isFeishu) {
        await this.expandFeishuContent();
      }

      const html = this.extractContent();
      const markdown = await this.convertToMarkdown(html);
      const title = this.getTitle();

      sendResponse({
        success: true,
        markdown: markdown,
        title: title
      });
    } catch (error) {
      console.error('转换错误:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  async smartScroll() {
    const scrollStep = 500;
    const scrollDelay = 200;
    const maxScrolls = 100;
    let scrollCount = 0;
    let lastHeight = document.body.scrollHeight;
    let noChangeCount = 0;

    while (scrollCount < maxScrolls && noChangeCount < 3) {
      window.scrollBy(0, scrollStep);
      await this.sleep(scrollDelay);
      
      const newHeight = document.body.scrollHeight;
      if (newHeight === lastHeight) {
        noChangeCount++;
      } else {
        noChangeCount = 0;
        lastHeight = newHeight;
      }
      scrollCount++;
    }

    window.scrollTo(0, 0);
    await this.sleep(100);
  }

  async expandFeishuContent() {
    const expandSelectors = [
      '.collapsible-block',
      '[data-collapsible]',
      '.toggle-block',
      '.expand-btn',
      '[aria-expanded="false"]'
    ];

    for (const selector of expandSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        try {
          el.click();
          await this.sleep(100);
        } catch (e) {
          // 忽略点击错误
        }
      }
    }

    const codeBlocks = document.querySelectorAll('.code-block, pre code');
    for (const block of codeBlocks) {
      const expandBtn = block.querySelector('.expand-btn, [class*="expand"]');
      if (expandBtn) {
        try {
          expandBtn.click();
          await this.sleep(100);
        } catch (e) {}
      }
    }
  }

  extractContent() {
    let content = null;

    if (this.isFeishu && this.settings.feishuOptimization) {
      content = this.extractFeishuContent();
    }

    if (!content) {
      content = this.extractWithReadability();
    }

    if (!content) {
      content = this.extractMainContent();
    }

    return content;
  }

  extractFeishuContent() {
    const selectors = [
      '.doc-content',
      '.article-content',
      '.page-content',
      '[data-doc-content]',
      '.feishu-doc-content',
      '.lark-doc-content',
      'main article',
      'article'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return this.cleanFeishuHtml(element.cloneNode(true));
      }
    }

    return null;
  }

  cleanFeishuHtml(element) {
    const unwantedSelectors = [
      '.comment',
      '.comments',
      '.toolbar',
      '.sidebar',
      '.navigation',
      '.toc',
      '.table-of-contents',
      '[class*="comment"]',
      '[class*="toolbar"]',
      '[class*="sidebar"]',
      'script',
      'style',
      'noscript'
    ];

    for (const selector of unwantedSelectors) {
      const elements = element.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    }

    return element.innerHTML;
  }

  extractWithReadability() {
    try {
      if (typeof Readability !== 'undefined') {
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone);
        const article = reader.parse();
        
        if (article && article.content) {
          return article.content;
        }
      }
    } catch (error) {
      console.error('Readability解析错误:', error);
    }
    return null;
  }

  extractMainContent() {
    const selectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '.main-content',
      '.post-content',
      '.article-content',
      '#content',
      '#main-content',
      'body'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.innerHTML;
      }
    }

    return document.body.innerHTML;
  }

  async convertToMarkdown(html) {
    let markdown = '';

    if (typeof TurndownService !== 'undefined') {
      markdown = this.convertWithTurndown(html);
    } else {
      markdown = this.simpleConvert(html);
    }

    if (!this.settings.includeImages) {
      markdown = markdown.replace(/!\[.*?\]\(.*?\)/g, '');
    }

    return this.postProcessMarkdown(markdown);
  }

  convertWithTurndown(html) {
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*'
    });

    turndownService.addRule('feishuCodeBlock', {
      filter: (node) => {
        return node.classList && (
          node.classList.contains('code-block') ||
          node.classList.contains('feishu-code')
        );
      },
      replacement: (content, node) => {
        const code = node.textContent || '';
        const lang = node.dataset?.lang || '';
        return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
      }
    });

    turndownService.addRule('feishuTable', {
      filter: 'table',
      replacement: (content, node) => {
        const rows = node.querySelectorAll('tr');
        if (rows.length === 0) return '';

        let table = '\n';
        const headerRow = rows[0];
        const headers = headerRow.querySelectorAll('th, td');
        
        table += '| ' + Array.from(headers).map(h => h.textContent.trim()).join(' | ') + ' |\n';
        table += '| ' + Array.from(headers).map(() => '---').join(' | ') + ' |\n';

        for (let i = 1; i < rows.length; i++) {
          const cells = rows[i].querySelectorAll('td');
          table += '| ' + Array.from(cells).map(c => c.textContent.trim()).join(' | ') + ' |\n';
        }

        return table + '\n';
      }
    });

    turndownService.addRule('feishuCallout', {
      filter: (node) => {
        return node.classList && (
          node.classList.contains('callout') ||
          node.classList.contains('info-block') ||
          node.classList.contains('warning-block')
        );
      },
      replacement: (content, node) => {
        const type = node.dataset?.type || 'info';
        const emoji = type === 'warning' ? '⚠️' : type === 'success' ? '✅' : '💡';
        return `\n> ${emoji} ${content.trim()}\n\n`;
      }
    });

    return turndownService.turndown(html);
  }

  simpleConvert(html) {
    let markdown = html;

    markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n');
    markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n');
    markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n');
    markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n');
    markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n');
    markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n');

    markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n');
    markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

    markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

    markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

    markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
    markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![image]($1)');

    markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gis, '\n```\n$1\n```\n');
    markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

    markdown = markdown.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match, content) => {
      return '\n' + content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n') + '\n';
    });
    markdown = markdown.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match, content) => {
      let index = 1;
      return '\n' + content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${index++}. $1\n`) + '\n';
    });

    markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (match, content) => {
      return '\n> ' + content.replace(/\n/g, '\n> ') + '\n\n';
    });

    markdown = markdown.replace(/<[^>]+>/g, '');
    markdown = markdown.replace(/&nbsp;/g, ' ');
    markdown = markdown.replace(/&amp;/g, '&');
    markdown = markdown.replace(/&lt;/g, '<');
    markdown = markdown.replace(/&gt;/g, '>');
    markdown = markdown.replace(/&quot;/g, '"');

    return markdown;
  }

  postProcessMarkdown(markdown) {
    markdown = markdown.replace(/\n{4,}/g, '\n\n\n');
    markdown = markdown.replace(/^[ \t]+/gm, '');
    markdown = markdown.replace(/[ \t]+$/gm, '');
    markdown = markdown.trim();

    if (this.isFeishu && this.settings.feishuOptimization) {
      markdown = this.optimizeFeishuMarkdown(markdown);
    }

    return markdown;
  }

  optimizeFeishuMarkdown(markdown) {
    markdown = markdown.replace(/\n{3,}/g, '\n\n');
    markdown = markdown.replace(/^(-|\*|\+) \s+/gm, '$1 ');
    markdown = markdown.replace(/```\s*\n/g, '```\n');
    return markdown;
  }

  getTitle() {
    let title = document.title;
    
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      title = ogTitle.content;
    }

    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) {
      title = h1.textContent.trim();
    }

    if (this.isFeishu) {
      const feishuTitle = document.querySelector('.doc-title, .article-title, [data-doc-title]');
      if (feishuTitle && feishuTitle.textContent.trim()) {
        title = feishuTitle.textContent.trim();
      }
    }

    return title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const converter = new Html2MdConverter();
