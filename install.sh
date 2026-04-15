#!/bin/bash

echo "正在下载所需的库文件..."

# 创建lib目录
mkdir -p lib

# 下载 Readability.js
echo "下载 Readability.js..."
curl -L "https://raw.githubusercontent.com/mozilla/readability/master/Readability.js" -o lib/readability.js

# 下载 Turndown.js
echo "下载 Turndown.js..."
curl -L "https://unpkg.com/turndown/dist/turndown.js" -o lib/turndown.js

# 创建图标目录
mkdir -p icons

echo "创建图标文件..."

# 创建简单的SVG图标
cat > icons/icon16.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
  <rect width="16" height="16" rx="3" fill="url(#grad)"/>
  <text x="8" y="12" font-family="Arial, sans-serif" font-size="10" font-weight="bold" fill="white" text-anchor="middle">MD</text>
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
</svg>
EOF

cat > icons/icon48.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="8" fill="url(#grad)"/>
  <text x="24" y="32" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="white" text-anchor="middle">MD</text>
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
</svg>
EOF

cat > icons/icon128.svg << 'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="20" fill="url(#grad)"/>
  <text x="64" y="85" font-family="Arial, sans-serif" font-size="50" font-weight="bold" fill="white" text-anchor="middle">MD</text>
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea"/>
      <stop offset="100%" style="stop-color:#764ba2"/>
    </linearGradient>
  </defs>
</svg>
EOF

echo ""
echo "✅ 库文件下载完成！"
echo ""
echo "📁 项目结构："
echo "  html2md/"
echo "  ├── manifest.json"
echo "  ├── popup/"
echo "  │   ├── popup.html"
echo "  │   ├── popup.css"
echo "  │   └── popup.js"
echo "  ├── content/"
echo "  │   ├── content.js"
echo "  │   └── content.css"
echo "  ├── background/"
echo "  │   └── background.js"
echo "  ├── lib/"
echo "  │   ├── readability.js"
echo "  │   └── turndown.js"
echo "  └── icons/"
echo "      ├── icon16.svg"
echo "      ├── icon48.svg"
echo "      └── icon128.svg"
echo ""
echo "⚠️  注意：Chrome扩展需要PNG格式的图标。"
echo "请将SVG图标转换为PNG格式，或使用其他图标。"
echo ""
echo "🚀 安装步骤："
echo "1. 打开 Chrome 浏览器，访问 chrome://extensions/"
echo "2. 开启右上角的「开发者模式」"
echo "3. 点击「加载已解压的扩展程序」"
echo "4. 选择 html2md 文件夹"
echo ""
