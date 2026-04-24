# 作業ログ

## 2026-04-24 22:16 (JST)
### プライバシーポリシーの更新
- `privacy_policy.md`: 
  - AI要約およびGemini APIに関する記述を削除。
  - すべてのデータ処理がローカル（ブラウザ内）で完結し、外部送信を行わないことを明記。

## 2026-04-24 22:10 (JST)
### 設定メニュー（Gemini APIキー設定）の完全削除
- `sidepanel.html`:
  - ナビゲーションバーから「設定」ボタンを削除。
  - `settingsContainer`（APIキー入力やモデル選択）を完全に削除。
- `sidepanel.js`:
  - `setupSettings` 関数およびその初期化呼び出しを削除。
  - `switchTab` 内の設定パネル制御ロジックを削除。
  - 不要になったAPIキー保存・モデル確認ロジックを削除。

## 2026-04-24 22:05 (JST)
### AI要約機能の削除とページテキスト取得ツールへの変更
- `sidepanel.html`:
  - ツール名を「AIページ要約」から「ページテキスト取得」に変更。
  - 「要約する」ボタンおよびモード選択（標準/箇条書き等）を削除。
  - 「テキストをMD形式で取得」ボタンをメインアクションに変更。
  - プレースホルダーテキストを更新。
- `sidepanel.js`:
  - `sendTextToGemini` などのAI要約ロジックを完全に削除。
  - `setupSummaryTool` を更新し、ボタンクリック時にテキストを取得してテキストエリアに表示するように変更。
  - クリップボードへのコピー機能は維持。

## 2026-04-24 21:40 (JST)
### AI音声入力機能の削除
- `manifest.json`: `audioCapture` 権限の削除、説明文の更新。
- `privacy_policy.md`: マイク入力・音声データに関する記述を削除（日本語・英語）。
- `sidepanel.html`: AI音声入力ツールのUIセクション（ボタン、ステータス、プレビュー、設定項目など）を完全に削除。
- `sidepanel.js`: 
  - 音声入力に関連する変数（`mediaRecorder`, `audioChunks`等）を削除。
  - `setupVoiceTool`, `blobToBase64`, `sendToGemini` (音声版) を削除。
  - `setupOutputTabs` を要約ツール専用に修正し、DOM参照エラーを解決。
  - 機能一覧のテキストから「AI音声入力」を削除。
  - 初期化処理から `setupVoiceTool` の呼び出しを削除。
