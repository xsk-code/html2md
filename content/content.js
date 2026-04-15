class Html2MdConverter {
  constructor() {
    this.isFeishu = false;
    this.settings = {};
    this.debug = true;
    this.collectedContent = [];
    this.init();
  }

  log(message, data = null) {
    if (this.debug) {
      if (data) {
        console.log(`[Html2Md] ${message}`, data);
      } else {
        console.log(`[Html2Md] ${message}`);
      }
    }
  }

  init() {
    this.detectFeishu();
    this.setupMessageListener();
    this.log('Converter initialized');
  }

  detectFeishu() {
    const url = window.location.href;
    this.isFeishu = url.includes('feishu.cn') || 
                     url.includes('larksuite.com') ||
                     url.includes('bytedance.net');
    
    if (this.isFeishu) {
      this.log('检测到飞书文档页面');
    }
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.log('收到消息:', request);
      
      if (request.action === 'ping') {
        this.log('响应 ping');
        sendResponse({ success: true, status: 'ready' });
        return true;
      }
      
      if (request.action === 'convertToMarkdown') {
        this.settings = request.settings || {};
        this.log('收到转换请求', this.settings);
        this.handleConvert(sendResponse);
        return true;
      }
    });
  }

  async handleConvert(sendResponse) {
    try {
      this.collectedContent = [];
      
      if (this.settings.smartScroll) {
        this.log('开始智能滚动...');
        
        if (this.isFeishu && this.settings.feishuOptimization) {
          this.log('使用飞书专用滚动策略...');
          await this.feishuSmartScroll();
        } else {
          await this.smartScroll();
        }
        
        this.log('智能滚动完成');
      }

      if (this.settings.feishuOptimization && this.isFeishu) {
        this.log('开始飞书文档优化...');
        await this.expandFeishuContent();
        this.log('飞书文档优化完成');
      }

      this.log('开始提取内容...');
      let html = null;
      
      if (this.collectedContent.length > 0) {
        this.log(`使用收集的内容，共 ${this.collectedContent.length} 段`);
        html = this.collectedContent.join('\n');
      }
      
      if (!html || html.length < 500) {
        html = this.extractContent();
      }
      
      this.log(`内容提取完成，HTML长度: ${html?.length || 0}`);

      if (!html || html.length < 100) {
        this.log('警告：提取的内容过少，尝试备用方法');
        const fallbackHtml = this.extractAllVisibleText();
        if (fallbackHtml && fallbackHtml.length > (html?.length || 0)) {
          this.log('使用备用方法提取内容');
          const markdown = this.simpleConvert(fallbackHtml);
          const title = this.getTitle();
          
          sendResponse({
            success: true,
            markdown: markdown,
            title: title
          });
          return;
        }
      }

      this.log('开始转换为Markdown...');
      const markdown = await this.convertToMarkdown(html);
      this.log(`转换完成，Markdown长度: ${markdown.length}`);

      const title = this.getTitle();

      sendResponse({
        success: true,
        markdown: markdown,
        title: title
      });
    } catch (error) {
      this.log('转换错误:', error);
      console.error('转换错误:', error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  findFeishuScrollContainer() {
    this.log('查找飞书滚动容器...');
    
    const possibleSelectors = [
      '[class*="scroll"]',
      '[class*="virtual"]',
      '[class*="list"]',
      '[class*="container"]',
      '[class*="wrapper"]',
      '[class*="content"]',
      '[class*="renderer"]',
      '[class*="docx"]',
      'main',
      'article'
    ];

    const candidates = [];
    
    for (const selector of possibleSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const overflow = style.overflow;
        const height = el.offsetHeight;
        const scrollHeight = el.scrollHeight;
        
        if ((overflowY === 'auto' || overflowY === 'scroll' || 
             overflow === 'auto' || overflow === 'scroll') &&
            scrollHeight > height) {
          candidates.push({
            element: el,
            selector: selector,
            scrollHeight: scrollHeight,
            offsetHeight: height,
            textLength: el.textContent?.length || 0
          });
        }
      }
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.scrollHeight - a.scrollHeight);
      this.log(`找到 ${candidates.length} 个候选滚动容器`, candidates.map(c => ({
        selector: c.selector,
        scrollHeight: c.scrollHeight,
        textLength: c.textLength
      })));
      return candidates[0].element;
    }

    this.log('未找到明确的滚动容器，尝试查找内容区域');
    
    const allElements = document.querySelectorAll('*');
    let bestContainer = null;
    let bestScore = 0;

    for (const el of allElements) {
      const textLength = el.textContent?.length || 0;
      const childCount = el.children?.length || 0;
      const className = (el.className || '').toString().toLowerCase();
      
      let score = textLength;
      
      if (className.includes('content') || className.includes('doc') || 
          className.includes('renderer') || className.includes('docx')) {
        score *= 2;
      }
      
      if (className.includes('scroll') || className.includes('virtual')) {
        score *= 1.5;
      }
      
      if (score > bestScore && textLength > 100) {
        bestScore = score;
        bestContainer = el;
      }
    }

    if (bestContainer) {
      this.log(`找到最佳内容容器，文本长度: ${bestContainer.textContent?.length}`);
      return bestContainer;
    }

    this.log('使用document.body作为滚动容器');
    return document.body;
  }

  async feishuSmartScroll() {
    const container = this.findFeishuScrollContainer();
    
    if (!container) {
      this.log('未找到滚动容器，使用默认滚动');
      await this.smartScroll();
      return;
    }

    this.log('开始飞书专用滚动...');
    
    const scrollStep = 300;
    const scrollDelay = 400;
    const maxScrolls = 300;
    let scrollCount = 0;
    let lastScrollTop = -1;
    let noChangeCount = 0;
    let collectedTexts = new Set();

    const initialContent = this.extractTextFromElement(container);
    if (initialContent.length > 0) {
      collectedTexts.add(initialContent);
      this.collectedContent.push(initialContent);
      this.log(`初始内容长度: ${initialContent.length}`);
    }

    while (scrollCount < maxScrolls && noChangeCount < 8) {
      const currentScrollTop = container.scrollTop || window.scrollY;
      
      if (currentScrollTop === lastScrollTop) {
        noChangeCount++;
        this.log(`滚动位置未变化，连续次数: ${noChangeCount}`);
      } else {
        noChangeCount = 0;
        lastScrollTop = currentScrollTop;
        
        const currentContent = this.extractTextFromElement(container);
        if (currentContent.length > 0 && !collectedTexts.has(currentContent)) {
          collectedTexts.add(currentContent);
          this.collectedContent.push(currentContent);
          this.log(`收集新内容，当前共 ${this.collectedContent.length} 段`);
        }
      }

      if (container === document.body) {
        window.scrollBy(0, scrollStep);
      } else {
        container.scrollTop += scrollStep;
      }
      
      await this.sleep(scrollDelay);
      scrollCount++;
    }

    this.log(`飞书滚动完成，共滚动 ${scrollCount} 次，收集 ${this.collectedContent.length} 段内容`);
    
    if (container === document.body) {
      window.scrollTo(0, 0);
    } else {
      container.scrollTop = 0;
    }
    
    await this.sleep(200);
  }

  extractTextFromElement(element) {
    if (!element) return '';
    
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'iframe', 'svg'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          const text = node.textContent.trim();
          if (text.length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node.textContent.trim());
    }

    return textNodes.join('\n');
  }

  async smartScroll() {
    const scrollStep = 800;
    const scrollDelay = 300;
    const maxScrolls = 200;
    let scrollCount = 0;
    let lastHeight = this.getDocumentHeight();
    let noChangeCount = 0;
    let consecutiveSameHeight = 0;

    this.log(`初始文档高度: ${lastHeight}`);

    while (scrollCount < maxScrolls && consecutiveSameHeight < 5) {
      window.scrollBy(0, scrollStep);
      await this.sleep(scrollDelay);
      
      const newHeight = this.getDocumentHeight();
      
      if (newHeight === lastHeight) {
        noChangeCount++;
        consecutiveSameHeight++;
        this.log(`高度未变化，连续次数: ${consecutiveSameHeight}`);
      } else {
        noChangeCount = 0;
        consecutiveSameHeight = 0;
        lastHeight = newHeight;
        this.log(`文档高度增加到: ${newHeight}`);
      }
      scrollCount++;
    }

    this.log(`滚动完成，共滚动 ${scrollCount} 次`);
    
    window.scrollTo(0, 0);
    await this.sleep(200);
  }

  getDocumentHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
  }

  async expandFeishuContent() {
    this.log('开始展开飞书折叠内容...');

    const expandSelectors = [
      '[class*="collapsible"]',
      '[class*="toggle"]',
      '[class*="expand"]',
      '[aria-expanded="false"]',
      '[data-toggle]',
      '[data-collapsible]'
    ];

    let expandedCount = 0;

    for (const selector of expandSelectors) {
      const elements = document.querySelectorAll(selector);
      this.log(`找到 ${elements.length} 个元素匹配选择器: ${selector}`);
      
      for (const el of elements) {
        try {
          const isExpanded = el.getAttribute('aria-expanded') === 'true';
          if (!isExpanded) {
            el.click();
            expandedCount++;
            await this.sleep(50);
          }
        } catch (e) {
          // 忽略点击错误
        }
      }
    }

    this.log(`共展开 ${expandedCount} 个折叠内容`);

    const codeExpandSelectors = [
      '[class*="code-block"] [class*="expand"]',
      'pre [class*="expand"]',
      '[class*="code"] [class*="more"]'
    ];

    for (const selector of codeExpandSelectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        try {
          el.click();
          await this.sleep(50);
        } catch (e) {}
      }
    }

    await this.sleep(200);
  }

  extractContent() {
    let content = null;

    if (this.isFeishu && this.settings.feishuOptimization) {
      this.log('尝试提取飞书文档内容...');
      content = this.extractFeishuContent();
      if (content) {
        this.log(`飞书内容提取成功，长度: ${content.length}`);
      }
    }

    if (!content || content.length < 500) {
      this.log('尝试使用Readability提取...');
      content = this.extractWithReadability();
      if (content) {
        this.log(`Readability提取成功，长度: ${content.length}`);
      }
    }

    if (!content || content.length < 500) {
      this.log('尝试提取主要内容区域...');
      content = this.extractMainContent();
      if (content) {
        this.log(`主要内容提取成功，长度: ${content.length}`);
      }
    }

    if (!content || content.length < 500) {
      this.log('尝试提取所有可见文本...');
      content = this.extractAllVisibleText();
      if (content) {
        this.log(`可见文本提取成功，长度: ${content.length}`);
      }
    }

    return content;
  }

  extractFeishuContent() {
    const feishuSelectors = [
      '[class*="docx"] [class*="content"]',
      '[class*="doc-content"]',
      '[class*="article-content"]',
      '[class*="page-content"]',
      '[data-doc-content]',
      '[class*="feishu-doc"]',
      '[class*="lark-doc"]',
      '[class*="editor"] [class*="content"]',
      '[class*="renderer"] [class*="content"]',
      'main [class*="content"]',
      'article',
      'main'
    ];

    this.log('尝试飞书选择器...');

    for (const selector of feishuSelectors) {
      const elements = document.querySelectorAll(selector);
      this.log(`选择器 "${selector}" 找到 ${elements.length} 个元素`);
      
      for (const element of elements) {
        const html = element.innerHTML;
        if (html && html.length > 200) {
          this.log(`使用选择器 "${selector}"，内容长度: ${html.length}`);
          return this.cleanFeishuHtml(element.cloneNode(true));
        }
      }
    }

    const allElements = document.querySelectorAll('*');
    let bestElement = null;
    let bestScore = 0;

    for (const el of allElements) {
      const textLength = el.textContent?.length || 0;
      const childCount = el.children?.length || 0;
      const tagName = el.tagName?.toLowerCase() || '';
      
      let score = textLength;
      
      if (['div', 'section', 'main', 'article'].includes(tagName)) {
        score *= 1.5;
      }
      
      if (el.className && typeof el.className === 'string') {
        const className = el.className.toLowerCase();
        if (className.includes('content') || className.includes('doc') || className.includes('article')) {
          score *= 2;
        }
        if (className.includes('sidebar') || className.includes('nav') || className.includes('header')) {
          score *= 0.1;
        }
      }
      
      if (score > bestScore && textLength > 100) {
        bestScore = score;
        bestElement = el;
      }
    }

    if (bestElement) {
      this.log(`找到最佳元素，标签: ${bestElement.tagName}, 文本长度: ${bestElement.textContent?.length}`);
      return this.cleanFeishuHtml(bestElement.cloneNode(true));
    }

    return null;
  }

  cleanFeishuHtml(element) {
    const unwantedSelectors = [
      '[class*="comment"]',
      '[class*="toolbar"]',
      '[class*="sidebar"]',
      '[class*="navigation"]',
      '[class*="toc"]',
      '[class*="table-of-contents"]',
      '[class*="header"]',
      '[class*="footer"]',
      '[class*="menu"]',
      '[class*="nav"]',
      'script',
      'style',
      'noscript',
      'iframe',
      'svg'
    ];

    for (const selector of unwantedSelectors) {
      try {
        const elements = element.querySelectorAll(selector);
        elements.forEach(el => {
          try {
            el.remove();
          } catch (e) {}
        });
      } catch (e) {}
    }

    return element.innerHTML;
  }

  extractWithReadability() {
    try {
      if (typeof Readability !== 'undefined') {
        this.log('使用Readability解析...');
        const documentClone = document.cloneNode(true);
        const reader = new Readability(documentClone);
        const article = reader.parse();
        
        if (article && article.content) {
          this.log(`Readability解析成功，内容长度: ${article.content.length}`);
          return article.content;
        }
      } else {
        this.log('Readability未定义');
      }
    } catch (error) {
      this.log('Readability解析错误:', error);
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
        const html = element.innerHTML;
        if (html && html.length > 100) {
          this.log(`使用选择器 "${selector}" 提取内容`);
          return html;
        }
      }
    }

    return document.body.innerHTML;
  }

  extractAllVisibleText() {
    this.log('提取所有可见文本...');
    
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') {
            return NodeFilter.FILTER_REJECT;
          }
          
          const tagName = parent.tagName.toLowerCase();
          if (['script', 'style', 'noscript', 'iframe', 'svg'].includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }
          
          const text = node.textContent.trim();
          if (text.length === 0) {
            return NodeFilter.FILTER_REJECT;
          }
          
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node.textContent.trim());
    }

    this.log(`找到 ${textNodes.length} 个文本节点`);
    
    const html = textNodes.map(text => `<p>${text}</p>`).join('');
    return html;
  }

  async convertToMarkdown(html) {
    let markdown = '';

    if (typeof TurndownService !== 'undefined') {
      this.log('使用Turndown转换...');
      markdown = this.convertWithTurndown(html);
    } else {
      this.log('Turndown未定义，使用简单转换');
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
      emDelimiter: '*',
      strongDelimiter: '**'
    });

    turndownService.addRule('feishuCodeBlock', {
      filter: (node) => {
        if (!node.classList) return false;
        const className = node.className.toString().toLowerCase();
        return className.includes('code-block') || 
               className.includes('feishu-code') ||
               className.includes('code-block');
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
        if (!node.classList) return false;
        const className = node.className.toString().toLowerCase();
        return className.includes('callout') ||
               className.includes('info-block') ||
               className.includes('warning-block') ||
               className.includes('highlight');
      },
      replacement: (content, node) => {
        const type = node.dataset?.type || 'info';
        const emoji = type === 'warning' ? '⚠️' : type === 'success' ? '✅' : '💡';
        return `\n> ${emoji} ${content.trim()}\n\n`;
      }
    });

    turndownService.addRule('preserveLineBreaks', {
      filter: ['br'],
      replacement: () => '\n'
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
    markdown = markdown.replace(/<div[^>]*>(.*?)<\/div>/gi, '\n$1\n');

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
    markdown = markdown.replace(/\n{2,}(-|\*|\+) /g, '\n$1 ');
    return markdown;
  }

  getTitle() {
    let title = document.title;
    
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      title = ogTitle.content;
    }

    const metaTitle = document.querySelector('meta[name="title"]');
    if (metaTitle) {
      title = metaTitle.content;
    }

    const h1 = document.querySelector('h1');
    if (h1 && h1.textContent.trim()) {
      title = h1.textContent.trim();
    }

    if (this.isFeishu) {
      const feishuTitleSelectors = [
        '[class*="doc-title"]',
        '[class*="article-title"]',
        '[data-doc-title]',
        '[class*="title"] [class*="content"]',
        'h1'
      ];
      
      for (const selector of feishuTitleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          title = el.textContent.trim();
          break;
        }
      }
    }

    return title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const converter = new Html2MdConverter();
