# SEO PULSE

公開URLを1件取得し、Google公式ドキュメントとAhrefs・Semrushの公開ガイドを根拠に、HTML上で確認できるSEO課題とCMSを判定するローカルWebサービスです。

## 起動

```bash
npm install
npm run dev
```

`http://127.0.0.1:5173` を開きます。

本番ビルド:

```bash
npm run build
npm start
```

`http://127.0.0.1:8787` を開きます。

## 診断範囲

- HTTP応答、HTTPS、robots.txt、meta robots、X-Robots-Tag
- title、meta description、canonical、主見出し
- viewport、画像alt、クロール可能なリンク、アンカーテキスト
- JSON-LDの構文、hreflang、HTMLの言語指定
- WordPress、Shopify、Wix、Squarespace、Webflow、Drupal、Joomla!、Ghost、HubSpot CMSの公開シグネチャ

スコアは固定されたコア項目だけで計算し、判定不能項目は判定率を併記して除外します。canonical・構造化データ・hreflangなど任意機能の有無では加点しません。各判定は「Google要件」「Google推奨」「業界推奨」「要確認」を区別して表示します。

1ページの公開HTMLを対象とする独自診断です。検索順位、実際のインデックス登録、被リンク、JavaScriptレンダリング後のDOM、サイト全体の重複は判定しません。

## セキュリティ

URL取得はHTTP(S)に限定し、公開グローバルIP以外を拒否します。DNS確認、IP固定接続、リダイレクト先の再検証、総時間・容量・同時実行・回数の上限を設けています。

### Cloudflare Access

Cloudflare Zero TrustでSelf-hosted applicationに`apps.neuralix.org`を登録し、AllowポリシーのEmailsに利用者本人のメールアドレスだけを指定します。Access画面のApplication Audience（AUD）とTeam domainを環境変数へ設定してください。

```env
CF_ACCESS_ENABLED=true
CF_ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com
CF_ACCESS_AUD=Access画面のAUDタグ
CF_ACCESS_ALLOWED_EMAILS=本人のメールアドレス
```

有効時はCloudflareのJWT署名・発行元・AUD・メールアドレスをサーバー側でも検証します。`/api/health`だけは死活監視用に認証対象外です。

## Render Freeへの配置

リポジトリ直下の`render.yaml`をBlueprintとして読み込むと、Node.js Web Service、ビルド、起動、ヘルスチェックが設定されます。作成時にCloudflare AccessのTeam domain、AUD、許可メールアドレスをRenderの環境変数へ入力してください。
