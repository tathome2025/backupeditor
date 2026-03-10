# ToneLab

類 Lightroom 的網上版相片編輯 demo，定位是可直接放上 GitHub 並部署到 EdgeOne Pages 的純前端靜態站。

## 功能

- 上傳 JPG / PNG
- Crop / Rotate / Resize
- 亮度、對比、飽和度、色溫調整
- 5 個 preset
- 匯出 JPG / PNG

## 架構

- `index.html`
  - 靜態站入口，EdgeOne 直接以 repo 根目錄作為輸出目錄。
- `static/app.js`
  - 核心編輯器邏輯，全部在瀏覽器內以 Canvas 處理。
- `static/app.css`
  - 介面樣式。
- `edgeone.json`
  - 指定 EdgeOne Pages 使用 repo 根目錄作為輸出目錄。
- `app.py`
  - 僅作本機 Flask 預覽用，不是正式部署依賴。

## 本機預覽

### 方式 1：直接用 Python 靜態伺服器

```bash
python3 -m http.server 8080
```

打開 [http://localhost:8080](http://localhost:8080)

### 方式 2：用 Flask 預覽

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

打開 [http://localhost:5000](http://localhost:5000)

## 部署到 GitHub + EdgeOne Pages

1. 把整個 repo push 到 GitHub。
2. 在 EdgeOne Pages 建立新專案並選擇 GitHub 倉庫。
3. Build / Deploy 設定使用：
   - Output Directory: `.`
   - Build Command: 留空
   - Install Command: 留空
4. 完成後，之後每次 push 都會自動重新部署。

`edgeone.json` 已經把輸出目錄固定為 repo 根目錄，減少控制台手動設定出錯的機會。

## 部署判斷

這個 demo 目前不需要後端 API，也不需要圖片上傳到伺服器，因此最合理的 EdgeOne 架構是：

- GitHub 作為原始碼來源
- EdgeOne Pages 作靜態託管
- 瀏覽器端 Canvas 完成所有圖片編輯與匯出

不建議把這個版本部署成 Flask 服務，因為那只會增加部署複雜度，而且對功能沒有收益。

## 之後若要擴充

如果你之後想加真正偏 Lightroom 的能力，可以再補：

- 歷史記錄 / undo redo
- 曲線工具
- HSL 分色調整
- 模板儲存
- 雲端圖片儲存
- EdgeOne Functions / Node Functions 做後端任務
