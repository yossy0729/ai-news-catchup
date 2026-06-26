# AI News Catchup

AIコンサルタントが毎日5分でAIの主要動向を把握するためのUI/UXプロトタイプです。

> このREADMEは実装の説明書です。「何を目指すか」の要件は [requirements.md](./requirements.md) に集約します。

## MVPの前提

- 一次情報のみを採用する
- 海外ニュースも日本語で要約する
- 記事カードは要点と影響を示し、クリックで一次情報へ移動する
- 各カテゴリは最大3件まで表示する
- 当日更新がないカテゴリは空欄または前回分として表示し、新着には `New` を付ける

## 現在の画面設計

- 上部: 今日の更新状況、New件数、一次情報件数、未更新カテゴリ数
- 中段: 今日見るべき重要ニュースをスコア順に表示
- 左側: 採用する情報源の優先順位
- 下段: タブ切り替えでカテゴリ別ニュースを確認

## 起動方法

ニュースデータは `data/news.json` から読み込みます。ブラウザでHTMLを直接開くとJSON読み込みがブロックされる場合があるため、ローカルサーバー経由で確認します。

```powershell
node serve.js
```

その後、ブラウザで `http://localhost:4173/` を開きます。

## 開発用コマンド

```powershell
node scripts/validate-data.js
node scripts/collect-news.js
node scripts/prune-candidates.js
node scripts/prepare-review.js
node scripts/summarize-review.js
node scripts/promote-review.js
node scripts/collect-sota.js
node scripts/daily-update.js
```

`collect-news.js` は標準では収集計画の表示、`--collect` ではドライラン、`--write` では候補キューへの保存を行います。外部ソースへの疎通確認を行う場合は次のように実行します。

```powershell
node scripts/collect-news.js --check
```

HTMLで読める一次情報ソースを巡回し、日次候補を作る場合は次を使います。

```powershell
node scripts/collect-news.js --collect
node scripts/collect-news.js --write
```

候補キューの期限切れ確認は標準ではドライランです。実際に反映する場合は `--write` を付けます。

```powershell
node scripts/prune-candidates.js --write
```

候補URLからタイトル、meta description、本文抜粋を取得し、レビュー用データを作る場合は次を使います。標準ではドライランです。

```powershell
node scripts/prepare-review.js --write
```

レビュー済み候補を暫定ニュースカードとして `data/news.json` に反映する場合は次を使います。標準ではドライランです。

```powershell
node scripts/promote-review.js
node scripts/promote-review.js --write --replace --accept
```

`--replace` は既存のサンプル記事を消して、レビュー候補由来の記事だけでダッシュボードを作り直します。`--accept` は反映した候補を `accepted` に変更します。古い記事を日次ニュースへ混ぜないため、標準では公開日が30日より古い候補を除外します。

## データ構造

- `generatedDate`: ダッシュボードの基準日
- `categories`: 表示カテゴリ
- `items`: 各カテゴリのニュース。最大3件まで画面に表示
- `priority`: 今日の重要ニュースの並び順に使うスコア
- `scoreBasis`: `priority` の根拠説明。MVPではルールベースです
- `new`: 新着表示の有無

右肩の数値は、記事内容をLLMが精査した絶対評価ではなく、MVP用のルールベース重要度です。主に一次情報の信頼度、ソース優先度、鮮度、カテゴリ、AI関連キーワードを加点して算出します。今後は、社会的影響、技術重要度、規制インパクト、研究価値をLLM補助で再評価する想定です。

## 一次情報ソース

自動収集対象は `data/sources.json` で管理します。MVPではAIエンジニア/リサーチャーが直接参照する一次情報と、論文・モデル・コードへの正規入口になるソースを優先します。個人ブログ、SNS、二次メディア、ニュースアグリゲータ、非公式リポジトリは除外します。

Yahoo Newsなどの二次ニュースは、話題の存在を知るには便利ですが、原典、技術詳細、モデルカード、論文、コード、規制文書へ深掘りしづらいため、MVPの収集対象には含めません。

有料記事、ログイン必須ページ、クローリング回避を突破しないと読めないページもMVPでは除外します。必要になった場合は、公式API、RSS、明示的に許可された取得方法、または手動レビューで扱います。

ソース定義の主な項目:

- `id`: ソースの安定ID
- `url`: 収集対象ページ
- `region`: `japan` または `global`
- `language`: 主言語
- `sourceType`: `government`, `regulator`, `company_newsroom`, `official_blog`, `research_institute`, `paper_index`, `official_github`, `standards_body`
- `fetchMethod`: `html`, `rss`, `api`, `github`, `manual_review`
- `categories`: 紐づけるニュースカテゴリID
- `priority`: 収集・評価時の優先度。小さいほど優先
- `enabled`: 収集対象に含めるかどうか

新しいソースを追加するときは、一次情報であること、対象カテゴリが明確であること、継続的に更新される公式ページであることを確認してから追加します。

## SOTAウォッチ（研究分野の最新性能）

「指標・ベンチ」タブのSOTAウォッチは、全研究分野の最新SOTA（最高性能）を自動収集して表示します。

- データ源は **paperswithcode.co の公式JSON API**（`/api/v1`）。公式サイトはJS描画でスクレイピング不可・WebFetchも403だが、ブラウザのUser-Agentを付ければJSONで取得できます。
- 取得は `node scripts/collect-sota.js`（プレビュー）/ `--write`（`data/sota.json` 生成）。`daily-update.js` に組み込み済みで毎朝自動更新されます。外部API依存のため、失敗してもニュース更新は止めません。
- 全分野を保持しつつ、画面の既定は `data/sota-presets.json` の「前線プリセット」。タブでエリア別・全分野、検索で日本語キーワード横断ができます（`data/sota-labels.json` が日本語名・検索語を持つ）。
- 各分野は評価件数が最多のデータセットを代表ベンチに採用。ただし件数最多が古い/マイナーなベンチを拾う分野は `data/sota-datasets.json` で代表ベンチを手動指定します（例: 世界知識=GPQA Diamond、数学=AIME 2025、推論=BBH、検索=BEIR）。1位は API の `best_rank` を使うため指標の向き判定に依存しません。指標の向き（↑高いほど良い/↓低いほど良い）は1位・2位スコアの大小から自動判定します。
- 1位が交代したときだけ前回値を `prev*` へ退避するので、`data/sota.json` を版管理することで推移が自然に蓄積します。
- 出典は Paper / Code / 掲載元（PwC や SWE-bench 等）。PwC未登録の分野は数値を出さずリンクのみ掲載します（誤値で信頼を損なわないため）。
- **公式ソースによる上書き**: PwCに無い/代表ベンチが弱い分野は、公式リーダーボードの値で上書きします。設定は `data/sota-official.json`（`slug` と `fetcher`、PwCに無い分野は `addIfMissing` で新規追加）、取得処理は `collect-sota.js` の `officialFetchers`。現状の上書き:
  - `coding-agents` → **SWE-bench Verified**（公式GitHub。PwCのHumanEvalは飽和のため差し替え）
  - `automatic-speech-recognition` → **Open ASR Leaderboard**（HuggingFace公式CSV）
  - `llm-arena`（新規分野）→ **LMArena / Chatbot Arena Text**（公式org lmarena/arena-catalog のJSON）
  - `image-generation` → **LMArena Image**、`image-understanding` → **LMArena Vision**（同 arena-catalog）
  - 新しい公式ソースは `officialFetchers` に関数を1つ足し、`sota-official.json` に1行追加するだけです。動きの速い注目分野に絞って上書きし、更新の遅い古典分野はPwCのまま運用します。

関連ファイル: `data/sota.json`（生成物・履歴保持）/ `data/sota-labels.json`（日本語辞書）/ `data/sota-presets.json`（前線プリセット）/ `data/sota-official.json`（公式上書き）。`data/cache/` はAPIキャッシュで版管理対象外です。

## キーワード検索

画面上の検索欄では、まず保存済みニュースのタイトル、要約、影響、ソース種別、日付を対象に検索します。

`公式ソース検索` ボタンを押すと、ローカルサーバーの `/api/search` 経由で `data/sources.json` の許可済み公式ソースを検索します。MVPではHTML取得できるソースのリンク候補を抽出し、`manual_review`、API、GitHub専用ソースは無理に取得しません。

検索結果は `候補を保存` ボタンで `data/candidates.json` に保存できます。保存した候補は、次の要約・分類・重要度スコアリング処理の入力になります。

候補は恒久ソースではなく、一時的な記事候補キューです。`status` は `candidate`, `accepted`, `rejected`, `expired` のいずれかです。再検索で同じURLを保存しても、`accepted` や `rejected` を勝手に `candidate` へ戻しません。

`scripts/prune-candidates.js` は、標準設定で14日以上見つかっていない `candidate` を `expired` にし、30日以上古い `expired` を削除対象にします。

`scripts/prepare-review.js` は `candidate` のURLへアクセスし、タイトル、description、本文抜粋、推定カテゴリ、推定インパクト、初期重要度を `data/review.json` に保存します。この段階ではAI要約ではなく、採用判断のための前処理です。

`scripts/promote-review.js` は、レビュー項目をダッシュボード記事へ変換する際に、source type、カテゴリ、description、本文抜粋から要約文を生成します。現時点ではルールベース要約です。LLM要約を入れる前のMVPとして、主題、要点、確認すべき影響が読み取れる文章に整形します。

OpenAI APIキーを `OPENAI_API_KEY` に設定している場合は、LLM要約も使えます。APIキーがない場合はスキップされ、通常のルールベース要約だけで動作します。

```powershell
node scripts/summarize-review.js --write --limit=10
node scripts/promote-review.js --write --replace --accept
```

日次更新にLLM要約を組み込む場合は次を使います。

```powershell
node scripts/daily-update.js --llm-summary --llm-limit=10
```

常時有効化する場合は、Windows環境変数 `AI_NEWS_LLM_SUMMARY=1` と `OPENAI_API_KEY` を設定します。モデルは標準で `gpt-4o-mini` を使います。変更する場合は `OPENAI_MODEL` を指定します。

将来的には同じ入力欄を使って、`data/sources.json` の公式ソース群に対して次の処理を行います。

- キーワードに関連する記事候補を公式ソースから取得
- 原典リンク、論文、モデルカード、公式GitHubを優先して抽出
- 関連度、鮮度、技術重要度、規制インパクトで再ランキング
- 通常のデイリーニュースとは別に「検索結果」として表示

## 日次更新フロー

現時点のMVPでは、次の1コマンドで「一次情報ソース巡回 → 候補化 → レビュー前処理 → ダッシュボード反映 → データ検証」まで実行できます。

```powershell
node scripts/daily-update.js
```

事前確認だけ行う場合は、データを書き換えないドライランを使います。

```powershell
node scripts/daily-update.js --dry-run
```

内部的には次の処理を順番に実行します。

```powershell
node scripts/collect-news.js --write
node scripts/prepare-review.js --write --limit=20
node scripts/promote-review.js --write --replace --accept
node scripts/validate-data.js
```

実行ログは `logs/daily-update-YYYY-MM-DD.log` に保存されます。件数を調整する場合は、たとえば `--review-limit=30`、`--per-source=5`、`--max-candidates=80` を指定します。

`promote-review.js` は、前回採用済みの記事も表示対象に残します。新規記事が少ない日は既存記事を維持し、公開日が古すぎる候補は日次ニュースへ混ぜない設計です。

画面上の `今すぐ取得` ボタンからも同じ日次更新を手動実行できます。通常はWindowsタスクスケジューラで毎朝自動実行し、手元で確認したいときだけボタンを使います。

キャッチーな二次ニュースは、見出しそのものではなく背後の一次情報を拾う方針です。たとえば「あるAI企業が米政府に停止させられた」という話題であれば、ニュースサイトではなくDOJ、FTC、Commerce、BIS、裁判所、企業公式発表などを優先して確認します。MVPでは米政府系の一次情報ソースも `data/sources.json` に追加しています。

## Windows自動実行

毎朝7時に日次更新を実行するタスクを登録する場合は、PowerShellで次を実行します。

```powershell
.\scripts\install-daily-task.ps1
```

時刻を変える場合は `-At` を指定します。

```powershell
.\scripts\install-daily-task.ps1 -At 08:30
```

登録直後に1回実行する場合は `-RunNow` を付けます。

```powershell
.\scripts\install-daily-task.ps1 -RunNow
```

解除する場合は次を使います。

```powershell
.\scripts\uninstall-daily-task.ps1
```

このタスクは現在のWindowsユーザーで、ログオン中に実行されます。更新結果は `logs/daily-update-YYYY-MM-DD.log` で確認できます。

## カテゴリ設計

ユーザー指定の6カテゴリを維持しつつ、日々のAIリテラシー維持に不足しやすい横断カテゴリを追加しています。

- 国内AI活用・成果事例
- 国内AI研究・国産AI
- 国内AI倫理・法規制
- 海外AI活用・成果事例
- 海外AI研究・モデル
- 海外AI倫理・法規制
- 新モデル・プロダクト
- AIセキュリティ・悪用対策
- ビジネス・投資・M&A
- 半導体・クラウド・電力

## 次に決めるべきこと

- 10カテゴリをこのまま維持するか、タブ内で統合表示するか
- 重要ニュースのスコア算定をルールベースにするか、LLM補助にするか
- 自動収集対象の一次情報ドメインをどこまで固定するか
- 前回分の保持期間を何日にするか
- 管理者による除外・固定表示・再要約の編集機能を入れるか
