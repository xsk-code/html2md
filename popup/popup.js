class PopupController {
  constructor() {
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadSettings();
  }

  bindEvents() {
    const convertBtn = document.getElementById('convertBtn');
    const copyBtn = document.getElementById('copyBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const previewBtn = document.getElementById('previewBtn');

    convertBtn.addEventListener('click', () => this.handleConvert());
    copyBtn.addEventListener('click', () => this.handleCopy());
    downloadBtn.addEventListener('click', () => this.handleDownload());
    previewBtn.addEventListener('click', () => this.handlePreview());

    ['includeImages', 'smartScroll', 'feishuOptimization'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('change', () => this.saveSettings());
    });
  }

  loadSettings() {
    chrome.storage.local.get(['includeImages', 'smartScroll', 'feishuOptimization'], (result) => {
      document.getElementById('includeImages').checked = result.includeImages !== false;
      document.getElementById('smartScroll').checked = result.smartScroll !== false;
      document.getElementById('feishuOptimization').checked = result.feishuOptimization !== false;
    });
  }

  saveSettings() {
    const settings = {
      includeImages: document.getElementById('includeImages').checked,
      smartScroll: document.getElementById('smartScroll').checked,
      feishuOptimization: document.getElementById('feishuOptimization').checked
    };
    chrome.storage.local.set(settings);
  }

  showStatus(text, icon = '⏳') {
    const status = document.getElementById('status');
    const statusText = document.querySelector('.status-text');
    const statusIcon = document.querySelector('.status-icon');
    
    status.style.display = 'flex';
    statusText.textContent = text;
    statusIcon.textContent = icon;
  }

  hideStatus() {
    document.getElementById('status').style.display = 'none';
  }

  showProgress(percent) {
    const progress = document.getElementById('progress');
    const progressFill = document.getElementById('progressFill');
    const progressText = document.getElementById('progressText');
    
    progress.style.display = 'block';
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
  }

  hideProgress() {
    document.getElementById('progress').style.display = 'none';
  }

  showResult(wordCount, imageCount) {
    const result = document.getElementById('result');
    const wordCountEl = document.getElementById('wordCount');
    const imageCountEl = document.getElementById('imageCount');
    
    result.style.display = 'block';
    wordCountEl.textContent = `字数: ${wordCount}`;
    imageCountEl.textContent = `图片: ${imageCount}`;
    
    document.getElementById('previewBtn').style.display = 'flex';
  }

  hideResult() {
    document.getElementById('result').style.display = 'none';
    document.getElementById('previewBtn').style.display = 'none';
  }

  setButtonLoading(loading) {
    const convertBtn = document.getElementById('convertBtn');
    convertBtn.disabled = loading;
    convertBtn.innerHTML = loading 
      ? '<span class="btn-icon">⏳</span> 处理中...'
      : '<span class="btn-icon">🔄</span> 转换为Markdown';
  }

  async ensureContentScriptInjected(tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return true;
    } catch (error) {
      console.log('Content script not found, injecting...');
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['lib/readability.js', 'lib/turndown.js', 'content/content.js']
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      } catch (injectError) {
        console.error('Failed to inject content script:', injectError);
        return false;
      }
    }
  }

  async handleConvert() {
    this.setButtonLoading(true);
    this.hideResult();
    this.showStatus('正在获取页面内容...');
    this.showProgress(10);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        throw new Error('无法获取当前标签页');
      }

      if (tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('edge://')) {
        throw new Error('无法在浏览器内部页面使用此功能');
      }

      this.showStatus('正在检查页面状态...');
      this.showProgress(15);

      const injected = await this.ensureContentScriptInjected(tab.id);
      if (!injected) {
        throw new Error('无法注入脚本到当前页面，请刷新页面后重试');
      }
      
      const settings = {
        includeImages: document.getElementById('includeImages').checked,
        smartScroll: document.getElementById('smartScroll').checked,
        feishuOptimization: document.getElementById('feishuOptimization').checked
      };

      this.showStatus('正在发送转换请求...');
      this.showProgress(20);

      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'convertToMarkdown',
        settings: settings
      });

      if (response && response.success) {
        this.showStatus('转换完成！', '✅');
        this.showProgress(100);
        
        const wordCount = response.markdown.length;
        const imageCount = (response.markdown.match(/!\[.*?\]\(.*?\)/g) || []).length;
        
        this.showResult(wordCount, imageCount);
        
        chrome.storage.local.set({ 
          lastMarkdown: response.markdown,
          lastTitle: response.title || 'document'
        });
        
        setTimeout(() => {
          this.hideStatus();
          this.hideProgress();
        }, 1500);
      } else {
        throw new Error(response?.error || '转换失败');
      }
    } catch (error) {
      console.error('转换错误:', error);
      this.showStatus(`错误: ${error.message}`, '❌');
      this.hideProgress();
      
      setTimeout(() => {
        this.hideStatus();
      }, 5000);
    } finally {
      this.setButtonLoading(false);
    }
  }

  async handleCopy() {
    try {
      const result = await chrome.storage.local.get(['lastMarkdown']);
      if (result.lastMarkdown) {
        await navigator.clipboard.writeText(result.lastMarkdown);
        this.showToast('已复制到剪贴板');
      }
    } catch (error) {
      console.error('复制错误:', error);
      this.showToast('复制失败');
    }
  }

  async handleDownload() {
    try {
      const result = await chrome.storage.local.get(['lastMarkdown', 'lastTitle']);
      if (result.lastMarkdown) {
        const title = result.lastTitle || 'document';
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
        const blob = new Blob([result.lastMarkdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
          url: url,
          filename: `${safeTitle}.md`,
          saveAs: true
        });
      }
    } catch (error) {
      console.error('下载错误:', error);
      this.showToast('下载失败');
    }
  }

  async handlePreview() {
    try {
      const result = await chrome.storage.local.get(['lastMarkdown', 'lastTitle']);
      if (result.lastMarkdown) {
        const previewHtml = this.generatePreviewHtml(result.lastMarkdown, result.lastTitle);
        const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        chrome.tabs.create({ url: url });
      }
    } catch (error) {
      console.error('预览错误:', error);
      this.showToast('预览失败');
    }
  }

  generatePreviewHtml(markdown, title) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Markdown Preview'}</title>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.8;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
      background: #fafafa;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.05);
    }
    h1, h2, h3, h4, h5, h6 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }
    h1 { font-size: 2em; border-bottom: 2px solid #667eea; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; border-bottom: 1px solid #e8e8e8; padding-bottom: 0.3em; }
    h3 { font-size: 1.25em; }
    p { margin-bottom: 1em; }
    ul, ol { margin-left: 2em; margin-bottom: 1em; }
    li { margin-bottom: 0.3em; }
    blockquote {
      border-left: 4px solid #667eea;
      padding-left: 1em;
      margin: 1em 0;
      color: #666;
      background: #f8f9fa;
      padding: 1em;
      border-radius: 0 4px 4px 0;
    }
    code {
      background: #f5f5f5;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.9em;
    }
    pre {
      background: #282c34;
      color: #abb2bf;
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
      margin: 1em 0;
    }
    pre code {
      background: none;
      padding: 0;
      color: inherit;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #e8e8e8;
      padding: 0.8em;
      text-align: left;
    }
    th {
      background: #f8f9fa;
      font-weight: 600;
    }
    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      margin: 1em 0;
    }
    a {
      color: #667eea;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    hr {
      border: none;
      border-top: 1px solid #e8e8e8;
      margin: 2em 0;
    }
  </style>
</head>
<body>
  <div class="container" id="content"></div>
  <script>
    document.getElementById('content').innerHTML = marked.parse(\`${markdown.replace(/`/g, '\\`')}\`);
  </script>
</body>
</html>`;
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #333;
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      z-index: 1000;
      animation: fadeIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
