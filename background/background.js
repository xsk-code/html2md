class BackgroundService {
  constructor() {
    this.init();
  }

  init() {
    this.setupMessageListener();
    this.setupInstallListener();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'downloadMarkdown') {
        this.handleDownload(request, sendResponse);
        return true;
      }
      
      if (request.action === 'getSettings') {
        this.handleGetSettings(sendResponse);
        return true;
      }
      
      if (request.action === 'saveSettings') {
        this.handleSaveSettings(request.settings, sendResponse);
        return true;
      }
    });
  }

  setupInstallListener() {
    chrome.runtime.onInstalled.addListener((details) => {
      if (details.reason === 'install') {
        this.setDefaultSettings();
        this.showWelcomePage();
      } else if (details.reason === 'update') {
        this.migrateSettings(details.previousVersion);
      }
    });
  }

  setDefaultSettings() {
    const defaultSettings = {
      includeImages: true,
      smartScroll: true,
      feishuOptimization: true,
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-'
    };
    
    chrome.storage.local.set(defaultSettings);
  }

  showWelcomePage() {
    chrome.tabs.create({
      url: 'https://github.com/yourusername/html2md#readme'
    });
  }

  migrateSettings(previousVersion) {
    // 处理版本迁移
  }

  handleDownload(request, sendResponse) {
    try {
      const { markdown, title } = request;
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      
      chrome.downloads.download({
        url: url,
        filename: `${safeTitle}.md`,
        saveAs: true
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message
          });
        } else {
          sendResponse({
            success: true,
            downloadId: downloadId
          });
        }
        URL.revokeObjectURL(url);
      });
    } catch (error) {
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  handleGetSettings(sendResponse) {
    chrome.storage.local.get(null, (settings) => {
      sendResponse({
        success: true,
        settings: settings
      });
    });
  }

  handleSaveSettings(settings, sendResponse) {
    chrome.storage.local.set(settings, () => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error: chrome.runtime.lastError.message
        });
      } else {
        sendResponse({
          success: true
        });
      }
    });
  }
}

const backgroundService = new BackgroundService();
