# プライバシーポリシー (Privacy Policy)

**最終更新日: 2026年4月17日**

「Tab & Bookmark Panel」（以下「本拡張機能」）は、ユーザーのプライバシーを尊重し、機密情報の保護に努めています。本ポリシーでは、本拡張機能が取り扱うユーザーデータについて説明します。

## 1. データの収集と利用
本拡張機能は、以下の目的のために必要最低限のユーザーデータにアクセスしますが、**外部のサーバー（開発者を含む）にデータを収集・保存することはありません。**

- **マイク入力 (audioCapture)**: AIボイス入力機能を使用する際、音声データを一時的に取得し、テキスト変換のために Gemini API (Google) へ送信します。
- **ページコンテンツ (scripting)**: 「AIページ要約」機能を使用する際、アクティブなタブのテキストデータを取得し、要約のために Gemini API (Google) へ送信します。
- **タブおよびブックマーク情報**: 拡張機能内のパネルで表示・操作するためにアクセスしますが、これらはローカル環境でのみ動作し、外部には送信されません。

## 2. データの送信先
本拡張機能で取得されたデータは、ユーザーが入力した API キーを使用して、直接 Google の提供する **Gemini API** サービスへ送信されます。データは暗号化された通信（HTTPS）を通じて送信されます。

## 3. データの保持
本拡張機能は、ユーザーのいかなる個人情報も保存・保持しません。APIキーなどの設定情報は、ブラウザの同期ストレージ（chrome.storage.sync/local）に保存され、ユーザー自身のGoogleアカウント間で共有される場合がありますが、開発者がこれにアクセスすることはありません。

## 4. 同意
本拡張機能を利用することにより、利用者は本プライバシーポリシーに同意したものとみなされます。

---

# Privacy Policy (English Version)

**Last Updated: April 17, 2026**

"Tab & Bookmark Panel" (the "Extension") respects your privacy and is committed to protecting sensitive information. This policy describes how the Extension handles user data.

## 1. Data Collection and Usage
The Extension accesses the minimum required user data for the following purposes but **does not collect or store data on any external servers (including the developer's).**

- **Audio Capture**: When using the AI Voice Input feature, audio data is temporarily captured and sent to the Gemini API (Google) for speech-to-text conversion.
- **Page Content (scripting)**: When using the "AI Page Summary" feature, text data from the active tab is captured and sent to the Gemini API (Google) for summarization.
- **Tabs and Bookmarks**: Accessed for display and management within the Extension panel. This data stays local and is never transmitted externally.

## 2. Data Transmission
Data retrieved by the Extension is sent directly to the **Gemini API** service provided by Google using the API key provided by the user. All data is transmitted via secure, encrypted communication (HTTPS).

## 3. Data Retention
The Extension does not save or retain any personal information. Configuration data, such as API keys, is stored in the browser's synchronized storage (chrome.storage.sync/local). The developer cannot access this data.

## 4. Consent
By using the Extension, you consent to this Privacy Policy.
