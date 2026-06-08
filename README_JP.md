<div align="center">
  <h1>⚽ TACTIC-FP Annotator</h1>
  <p><strong>サッカー戦術意図アノテーションのためのプロフェッショナルな Web ツール環境。</strong><br/>
  TACTIC-Bench 研究フレームワーク向けに、高速なクリップレビュー、チーム別のラベル決定、ベンチマーク可能なデータセットエクスポートを実現します。</p>

  <p>
    <a href="README.md">🇬🇧 English</a> ·
    <a href="README_JP.md">🇯🇵 日本語</a>
  </p>

  <p>
    <a href="https://github.com/shafayatsaad"><img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub"/></a>
    <a href="https://www.linkedin.com/in/shafayatsaad"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn"/></a>
    <a href="https://shafayatsaad.vercel.app/"><img src="https://img.shields.io/badge/Portfolio-101010?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Portfolio"/></a>
  </p>

  <p>
    <img src="https://img.shields.io/badge/Next.js-14.2-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js 14"/>
    <img src="https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18"/>
    <img src="https://img.shields.io/badge/TypeScript-5.4-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/Tailwind-3.4-38B2AC?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind"/>
    <img src="https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python"/>
    <img src="https://img.shields.io/badge/ffmpeg-required-007808?style=flat-square&logo=ffmpeg&logoColor=white" alt="ffmpeg"/>
  </p>
</div>

---

## 📋 目次

- [🎯 概要](#-概要)
- [✨ 主な機能](#-主な機能)
- [🖼️ UI プレビュー](#-ui-プレビュー)
- [🏗️ アーキテクチャ概要](#-アーキテクチャ概要)
- [🛠️ 技術スタック](#-技術スタック)
- [📁 プロジェクト構成](#-プロジェクト構成)
- [⚡ セットアップ](#-セットアップ)
- [🔌 API リファレンス](#-api-リファレンス)
- [🧬 パイプラインとデータワークフロー](#-パイプラインとデータワークフロー)
- [📐 アノテーションスキーマ](#-アノテーションスキーマ)
- [⌨️ キーボードショートカット](#-キーボードショートカット)
- [🏷️ TACTIC インテント一覧](#-tactic-インテント一覧)
- [📤 エクスポート形式](#-エクスポート形式)
- [🐞 トラブルシューティング](#-トラブルシューティング)
- [🗺️ ロードマップ](#-ロードマップ)
- [👥 メンテナー](#-メンテナー)
- [📝 設計メモ](#-設計メモ)

---

## 🎯 概要

**TACTIC-FP Annotator** は、サッカー（フットボール）の戦術意図を **クリップレベル** でアノテーションするための、モダンなフルスタック Web アプリケーションです。**TACTIC-FP / TACTIC-Bench** 研究フレームワーク向けに、クリーンでベンチマーク可能なラベルを生成するために設計されています。

このアノテーターは、実際の試合レビュー業務に即したワークフローを中心に構築されています。

- **18 秒** のクリップ再生と、中央の **10 秒間** ラベルウィンドウ（Python パイプラインから設定可能）。
- チーム A / チーム B の **同時・並行アノテーション** と、ポゼッションに基づくチーム判定ロジック。
- **戦術意図ラベル** と **除外ラベル**（DeadBall、ContestedPlay）の明確な分離。
- 攻撃 / 守備ラベルに対するポゼッションを強制するバリデーションルール。
- クリップマニフェストとモックトラジェクトリ `.npz` ファイルを生成するパイプライン。
- TACTIC-Bench 互換スキーマでの **JSON** および **CSV** エクスポート。

> 🎓 研究用の戦術データセット構築、スポーツ分析製品のプロトタイピング、モデル評価ベンチマークなど、あらゆる場面で、高速でキーボード中心の単一画面ワークフローを提供します。

---

## ✨ 主な機能

### 🎬 アノテーションワークフロー

- **3 ペインレイアウト** — 左：クリップエクスプローラー ／ 中央：動画プレーヤーとインテントグリッド ／ 右：アノテーションパネル。
- **18 秒クリップ / 10 秒中央ラベルウィンドウ** に、サブ秒単位の境界微調整、自動セグメント分割、手動分割・マージ・削除。
- **手動ポゼッションオーバーライド**（チーム A / チーム B / コントested / 自動追従）を UI で完全に可視化。
- **品質ゲート** — トラッキングされた選手数が 18/22 未満、または品質スコアが 0.8 未満の場合、送信をブロック。
- **セッション上限 50 件**、**20 件ごとの強制休憩** で集中力を維持。
- **Auto-Next** — 送信成功時に次のクリップへ自動遷移。

### 🏷️ 戦術意図語彙

- **14 ラベル** を **6 グループ** で構成：BuildUp · Attack · Press · Transition · SetPiece · Exclusion。
- 各ラベルに **1 文字のホットキー**（`1`〜`9`、`0`、`Q`、`W`、`R`、`T`）を割り当て、超高速入力を実現。
- **チーム間ポゼッションルール** — ボールを持っていないチームの攻撃インテントを自動的に無効化。
- **除外ショートカット** — DeadBall は両チームに自動入力し、ゲーム状態を `dead_ball: true` に切替。

### 🎥 動画プレーヤー

- ネイティブ HTML5 `<video>` にカスタム操作：再生 / 一時停止 / ミュート / フルスクリーン / ループ / 再生速度（0.25×〜2×）。
- `/api/videos/[...path]` による **Range リクエストストリーミング** で、シークと再開を高速化。
- `ffmpeg` による **MKV → MP4 自動変換**（remux 優先、トランスコード fallback）。
- **マークワークフロー**（`M` 開始 / `N` 終了 / `Enter` で作成）でアドホックなセグメント生成。
- **プレイヘッド位置で分割**（`X`）で 1 つのクリップを 2 つに分割。
- タイムラインの現在位置を **自動スクロール** して現在のラベルウィンドウを表示。

### 📊 パイプラインとデータ

- `pipeline.py` — `raw_videos/` から連続クリップウィンドウを生成し、`data/clip_manifest.json` と `data/trajectories/<match>/*.npz` を出力。
- `generate_manifest.py` — ヒューリスティックのヘルパー関数群：`extract_enhanced_features` / `compute_clip_quality` / `detect_possession_state` / `detect_intent_shift_points` / `propose_segments_from_shifts` / `determine_half` / `add_video_metadata`。
- UI からの **ワンクリックマニフェスト生成**（API 経由：`POST /api/pipeline/generate`）。

### 📤 エクスポートとインテグレーション

- **JSON** エクスポート（TACTIC-Bench スキーマ準拠の model-sample 形式）と **CSV** エクスポート（アノテーション単位のフラットカラム）。
- ブラウザ側ダウンロードとサーバ側保存（`data/exports/`）の双方をサポート。
- **Reset Session** でアノテーション・マニフェスト・エクスポート・変換済み MP4 をクリア（元動画は保持）。

### 🧑‍💻 開発者体験

- React `useState` + `useRef` による **100% クライアント側状態管理**（外部状態管理ライブラリ不要）。
- **安定したキーボードハンドラ** — 各キー操作は `useRef` 経由のコールバックにバインドされ、再レンダリングを跨いでもホットキーが機能。
- **キャンセル安全な動画ストリーミング** — `/api/videos/[...path]` ルートは AbortSignal 対応のカスタム `ReadableStream` を使用し、クライアント切断時に Node ストリームを破棄。タブクローズでサーバがクラッシュしない。
- `@/*` パスエイリアス（`src/*`）対応の TypeScript。

---

## 🖼️ UI プレビュー

UI はハイエンドのスポーツ分析ダッシュボードのように設計されています。

| 領域                                               | 内容                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **トップバー**（`Header`）                         | ブランドマーク・現在の試合 ID とセグメントカウンタ・**Match progress**（注釈済み / 予定）・`Load Video` アクション・ライブステータスピル・Dev Portfolio リンク                                                                                                                                                                                                                        |
| **左レール**（`ClipExplorer`）                     | 検索ボックス・All / Todo / Done フィルタ・スクロール可能なクリップリスト（アンカーイベントアイコン、ハーフクロック、ポゼッションドット、進捗状態付き）                                                                                                                                                                                                                                |
| **中央ステージ**（`VideoPlayer` + `IntentLabels`） | 16:9 動画・タイムラインプログレスバー（クリックでシーク）・再生コントロール（再生 / リプレイ / 速度 / ミュート / フルスクリーン / ループ）・マーク開始 / 終了ボタン・分割 & MKV→MP4 変換・ホットキー付きグループ化インテントグリッド                                                                                                                                                  |
| **右パネル**（`AnnotationPanel`）                  | チーム A / B カード（カラーボーダー付き）・**ボールポゼッション** セレクタ（A / B / Contested / Auto）・**ゲーム状態** エディタ（スコア / セットピース / デッドボール）・**Submit Annotation** フォーム（確信度スター、certainty、coverage %、Flag Review、Auto-Next、Skip、Submit）・品質インジケータ（22 トラッカードット）・クラス分布バー・JSON / CSV エクスポート・Reset Session |

> レイアウトは **迅速なレビュー**、**一貫したラベリング**、**コンテキストスイッチの最小化** に最適化されています。

---

## 🏗️ アーキテクチャ概要

TACTIC-FP Annotator は **単一プロセスのフルスタックアプリ** で、3 つの層が協調して動作します。

1. **フロントエンド** — Next.js App Router（RSC + クライアントコンポーネント）。アノテーション体験の全容は `src/components/AnnotatorClient.tsx` にあり、状態・キーボードハンドラ・永続化をまとめて管理。
2. **バックエンド** — `src/app/api/**` 配下の Next.js Route Handlers。manifest、アノテーション、動画ストリーミング、動画変換、パイプライン実行、エクスポートを網羅。
3. **パイプライン** — 2 つの Python スクリプト：
   - `pipeline.py` — `raw_videos/` を反復処理し、18 秒ウィンドウと 10 秒ラベルスパンを構築、manifest とトラジェクトリ `.npz` ファイルを出力。
   - `generate_manifest.py` — `pipeline.py` から利用されるヒューリスティックのヘルパー群（品質、ポゼッション、シフト点検出、ハーフ判定、メタデータ）。

### アーキテクチャ図

```mermaid
flowchart TD
  subgraph Source[入力レイヤー]
    RawVideos[試合動画<br/>.mp4 / .mkv / .avi / .mov / .webm]
    Trajectories[トラジェクトリデータ<br/>.npz, pipeline.py が出力]
  end

  subgraph Pipeline[パイプラインレイヤー · Python]
    ClipGen[pipeline.py<br/>--clip-duration 18 --annotation-window 10]
    Helpers[generate_manifest.py<br/>features · quality · possession · shifts]
  end

  subgraph Backend[バックエンドレイヤー · Next.js Route Handlers]
    ManifestAPI["/api/manifest (GET)"]
    AnnotAPI["/api/annotations (GET, POST)"]
    ResetAPI["/api/annotations/reset (POST)"]
    PipeAPI["/api/pipeline/generate (POST)"]
    VideoAPI["/api/videos/[...path] (GET, HEAD)"]
    ListAPI["/api/videos/list (GET)"]
    ConvertAPI["/api/videos/convert (POST)"]
    JSONAPI["/api/export/json (POST)"]
    CSVAPI["/api/export/csv (POST)"]
    Storage[(data/annotations.json<br/>data/clip_manifest.json<br/>data/exports/*<br/>data/trajectories/*)]
    FFmpeg[ffmpeg remux / transcode]
  end

  subgraph Frontend[UI レイヤー · React Client]
    App[AnnotatorClient + Header + ClipExplorer<br/>+ VideoPlayer + IntentLabels + AnnotationPanel]
  end

  RawVideos -->|scan + split| ClipGen
  ClipGen -->|uses| Helpers
  ClipGen -->|writes| Storage
  Trajectories -.->|reads| App

  App -->|fetch clips| ManifestAPI
  App -->|load / save annotations| AnnotAPI
  App -->|clear session| ResetAPI
  App -->|run pipeline| PipeAPI
  PipeAPI -->|spawn python3 pipeline.py| ClipGen
  App -->|list videos| ListAPI
  App -->|stream video (Range)| VideoAPI
  App -->|convert MKV → MP4| ConvertAPI
  ConvertAPI -->|spawn ffmpeg| FFmpeg
  FFmpeg -->|produces .mp4| Storage
  App -->|export JSON| JSONAPI
  App -->|export CSV| CSVAPI
  ManifestAPI --> Storage
  AnnotAPI --> Storage
  JSONAPI --> Storage
  CSVAPI --> Storage
```

---

## 🛠️ 技術スタック

| レイヤ                       | 技術                                             | バージョン |
| ---------------------------- | ------------------------------------------------ | ---------- |
| フロントエンドフレームワーク | Next.js（App Router）                            | 14.2.x     |
| UI ライブラリ                | React + React DOM                                | 18.3.x     |
| 言語                         | TypeScript                                       | 5.4.x      |
| スタイリング                 | Tailwind CSS + PostCSS + Autoprefixer            | 3.4.x      |
| アイコン                     | lucide-react                                     | 0.400+     |
| モーション                   | framer-motion                                    | 11.x       |
| クラスユーティリティ         | class-variance-authority · clsx · tailwind-merge | latest     |
| バックエンドランタイム       | Next.js Route Handlers（Node）                   | –          |
| パイプライン                 | Python 3.10+ with OpenCV（`cv2`）and NumPy       | –          |
| 動画ツール                   | `ffmpeg`（システムの `$PATH` 上のバイナリ）      | –          |
| Lint                         | ESLint + `eslint-config-next`                    | 8.57.x     |

---

## 📁 プロジェクト構成

```text
TACTIC-FP-Annotator/
├── package.json                      # ワークスペースルート：tactic-fp-nextjs に委譲
├── tech-spec.md                      # 内部技術仕様書
└── tactic-fp-nextjs/
    ├── package.json                  # すべてのランタイム / 開発依存関係
    ├── package-lock.json
    ├── tsconfig.json                 # TS 設定（paths: @/* → ./src/*）
    ├── next.config.js                # Next 14 設定（serverComponentsExternalPackages）
    ├── tailwind.config.ts            # Tailwind 3.4 content + フォント拡張
    ├── postcss.config.js             # Tailwind + autoprefixer パイプライン
    ├── next-env.d.ts
    ├── generate_manifest.py          # ヒューリスティックのヘルパー（features、quality、possession、shifts）
    ├── pipeline.py                   # メインパイプライン：raw_videos → clip_manifest.json + .npz
    ├── pipeline_validator.py         # マニフェスト用の任意のバリデーションヘルパー
    ├── favicon.png
    ├── README.md                     # 英語版 README
    ├── README_JP.md                  # ← このファイル
    ├── data/                         # 初回起動時に自動作成
    │   ├── clip_manifest.json        # pipeline.py が生成
    │   ├── annotations.json          # ライブアノテーションセッション
    │   ├── exports/                  # JSON/CSV エクスポート
    │   └── trajectories/             # <match_id>/*.npz（pipeline.py 由来）
    ├── raw_videos/                   # .mp4 / .mkv ファイルを配置
    └── src/
        ├── app/                      # Next.js App Router
        │   ├── layout.tsx            # ルートレイアウト、メタデータ、フォント
        │   ├── page.tsx              # <AnnotatorClient /> を組み立てる
        │   ├── globals.css           # Tailwind + カスタムユーティリティ
        │   ├── icon.png
        │   └── api/
        │       ├── manifest/route.ts             # GET — clip_manifest.json 読み出し
        │       ├── annotations/route.ts          # GET / POST — 読み込みと保存
        │       ├── annotations/reset/route.ts    # POST — セッションクリア
        │       ├── pipeline/generate/route.ts    # POST — pipeline.py を起動
        │       ├── videos/[[...path]]/route.ts   # GET / HEAD — range 対応動画ストリーム
        │       ├── videos/convert/route.ts       # POST — ffmpeg で MKV → MP4
        │       ├── export/json/route.ts          # POST — JSON エクスポート書き込み
        │       └── export/csv/route.ts           # POST — CSV エクスポート書き込み
        ├── components/
        │   ├── AnnotatorClient.tsx   # メインのクライアントラッパー（すべての状態 + キーボード）
        │   ├── Header.tsx            # トップバー
        │   ├── ClipExplorer.tsx      # 左サイドバー（リスト、検索、フィルタ）
        │   ├── VideoPlayer.tsx       # 中央の動画と操作
        │   ├── IntentLabels.tsx      # 14 ラベルの 6 グループグリッド
        │   └── AnnotationPanel.tsx   # 右パネル（チーム、ポゼッション、ゲーム状態、送信、エクスポート）
        └── lib/
            ├── constants.ts          # TACTIC_INTENTS、HOTKEY_MAP、Annotation/Clip 型
            ├── utils.ts              # cn、formatTime、formatMatchClock、normalizeClip
            └── server-utils.ts       # API ルート用 fs ヘルパー
```

---

## ⚡ セットアップ

### 1. 前提条件

| ツール            | 必須バージョン              | 用途                                   |
| ----------------- | --------------------------- | -------------------------------------- |
| **Node.js**       | 18.17+（LTS 推奨）          | Next.js 開発サーバ、ビルド、lint       |
| **npm**           | 9+（Node 18 同梱）          | 依存関係管理                           |
| **Python**        | 3.10+                       | `pipeline.py`、`generate_manifest.py`  |
| **ffmpeg**        | 4.4+（最新のビルド）        | MKV → MP4 変換、動画ストリーミング     |
| **opencv-python** | `pip install opencv-python` | パイプラインが動画メタデータを読み取る |
| **NumPy**         | `pip install numpy`         | トラジェクトリ生成                     |

> Next.js アプリ自体は Python や ffmpeg を必要としません。パイプライン実行や MKV 変換時のみ必要です。MP4 クリップだけを使うなら、それらなしでもブラウズとアノテーションは可能です。

#### OS 別 ffmpeg インストール

| OS                  | コマンド                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Windows**         | `winget install Gyan.FFmpeg` ・または [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) からダウンロードし `bin/` を `PATH` に追加 |
| **macOS**           | `brew install ffmpeg`                                                                                                            |
| **Ubuntu / Debian** | `sudo apt update && sudo apt install -y ffmpeg python3-opencv`                                                                   |
| **Fedora**          | `sudo dnf install -y ffmpeg python3-opencv`                                                                                      |
| **Arch**            | `sudo pacman -S ffmpeg opencv python-numpy`                                                                                      |

`ffmpeg -version` でビルド情報が出力されることを確認してください。

### 2. 依存関係のインストール

```bash
# ワークスペースルート（tactic-fp-nextjs/ に委譲）
npm install

# または Next.js プロジェクト内で
cd tactic-fp-nextjs
npm install

# Python パイプラインの依存（一度だけ）
pip install numpy opencv-python
```

### 3. 元試合動画を追加

`tactic-fp-nextjs/raw_videos/` に試合動画を配置します。対応拡張子：`.mp4`、`.mkv`、`.avi`、`.mov`、`.webm`。

```bash
tactic-fp-nextjs/raw_videos/
├── match_01.mp4
├── match_02.mkv
└── match_03.mp4
```

> ヒント：MKV しかない場合は、クリップを最初に選択した際に **MKV → MP4 変換** ボタンが表示されます。元の MKV は保持されます。

### 4. クリップマニフェストの生成

**方法 A — UI から：** アプリを開き、左サイドバーの **Generate Manifest** をクリックします。

**方法 B — API から：**

```bash
curl -X POST http://localhost:3000/api/pipeline/generate \
  -H "Content-Type: application/json" \
  -d '{"clip_duration": 18, "annotation_window": 10, "step_duration": 10}'
```

**方法 C — Python で直接（`tactic-fp-nextjs/` 内で）：**

```bash
python pipeline.py --input-dir raw_videos --clip-duration 18 --annotation-window 10 --step-duration 10
```

パイプラインは `data/clip_manifest.json` と `data/trajectories/<match_id>/*.npz` を書き出します。

### 5. 開発サーバの起動

```bash
# ワークスペースルート（ポート 5173、ホスト 127.0.0.1）
npm run dev

# または tactic-fp-nextjs/ 内で
npm run dev    # デフォルトポート 3000
```

ターミナルに表示される URL（通常 `http://localhost:3000` または `http://127.0.0.1:5173`）を開いてください。

### 6. 本番ビルド

```bash
npm run build
npm run start
```

### 7. Lint

```bash
npm run lint
```

### 8. セッションのリセット（任意）

右パネルの **Reset Session** を使うか、API を呼び出します：

```bash
curl -X POST http://localhost:3000/api/annotations/reset
```

これで `data/annotations.json`、`data/clip_manifest.json`、`data/exports/`、および `raw_videos/` 配下の `*_720p.mp4` ファイルがクリアされます。**元動画は保持されます。**

---

## 🔌 API リファレンス

すべてのルートは Next.js Route Handlers です。リクエスト/レスポンスボディの `Content-Type` は特に記載がない限り `application/json` です。

| メソッド | ルート                   | 概要                                                                       | リクエストボディ                                      | レスポンス                                                            |
| -------- | ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------- |
| `GET`    | `/api/manifest`          | `data/clip_manifest.json` を読む（`{clips: [...]}` 形式を自動フラット化）  | –                                                     | `Clip[]`                                                              |
| `GET`    | `/api/annotations`       | 現在の `data/annotations.json` セッションを読む                            | –                                                     | `{ schema_version, dataset, team_config, annotations: Annotation[] }` |
| `POST`   | `/api/annotations`       | アノテーションセッション全体を保存 / 置換                                  | `{ annotations, team_config }`                        | `{ success: true }`                                                   |
| `POST`   | `/api/annotations/reset` | セッションをクリア（アノテーション、マニフェスト、エクスポート、生成 MP4） | –                                                     | `{ success, cleared: string[] }`                                      |
| `POST`   | `/api/pipeline/generate` | ウィンドウ設定で `pipeline.py` を実行                                      | `{ clip_duration, annotation_window, step_duration }` | `{ success, output, manifest }`                                       |
| `GET`    | `/api/videos/list`       | `raw_videos/` 内の利用可能な動画ファイルを一覧                             | –                                                     | `{ videos: string[] }`                                                |
| `GET`    | `/api/videos/[...path]`  | 動画ファイルをストリーミング（`Range` リクエスト対応）                     | –                                                     | `video/<ext>` バイナリ、レンジは `206 Partial Content`                |
| `HEAD`   | `/api/videos/[...path]`  | 動画が到達可能か確認（変換済み MP4 の検出に使用）                          | –                                                     | ヘッダーのみ                                                          |
| `POST`   | `/api/videos/convert`    | `ffmpeg` でブラウザ対応の `*_720p.mp4` に変換                              | `{ source: "match_02.mkv" }`                          | `{ success, filename, message }`                                      |
| `POST`   | `/api/export/json`       | TACTIC-Bench JSON model-sample を `data/exports/` に書き出し               | `{ annotations, match_id? }`                          | `{ success, fileName }`                                               |
| `POST`   | `/api/export/csv`        | フラットな CSV を `data/exports/` に書き出し                               | `{ annotations, team_config }`                        | `{ success, fileName }`                                               |

> 動画ストリーミングは Range 対応：ルートは `Accept-Ranges: bytes` を返し、`Range: bytes=…` リクエストには `206 Partial Content` を返します。ストリーム本体は AbortSignal 対応のカスタム `ReadableStream` でラップされており、クライアント切断時に Node のファイルストリームを破棄します。タブを閉じてもサーバはクラッシュしません。

---

## 🧬 パイプラインとデータワークフロー

元動画からエクスポートデータセットまでの全体フロー：

```text
   raw_videos/*.mp4 ───► pipeline.py ──► data/clip_manifest.json
                                │
                                ├─► data/trajectories/<match>/*.npz
                                │
                                ▼
                       ブラウザ（AnnotatorClient）
                                │
                                ▼
                       data/annotations.json
                                │
                                ▼
                       data/exports/TACTIC_FP_Annotated_<match>.{json,csv}
```

### `pipeline.py` CLI フラグ

| フラグ                | デフォルト   | 選択肢 / 備考                                                 |
| --------------------- | ------------ | ------------------------------------------------------------- |
| `--input-dir`         | `raw_videos` | 元の試合動画を格納したフォルダ                                |
| `--clip-duration`     | `30`         | `10`、`18`、`30` 秒（ウィンドウ長）                           |
| `--annotation-window` | `6`          | 各クリップ内の中央ラベルウィンドウ秒数                        |
| `--step-duration`     | `7`          | 連続ウィンドウ間のステップ秒数                                |
| `--no-trajectories`   | off          | `.npz` ファイルの書き出しをスキップ（高速、マニフェストのみ） |

### `generate_manifest.py` のヘルパー関数

| 関数                                             | 概要                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `add_video_metadata(path)`                       | OpenCV で `{ width, height, fps, total_frames, duration_seconds, tier }` を取得           |
| `extract_enhanced_features(traj)`                | ボールの x/y/速度/高さ、チームスプレッド、プレス強度、パス連続長                          |
| `compute_clip_quality(traj)`                     | 品質スコア、問題リスト、各チームのトラッキングカバレッジ                                  |
| `detect_possession_state(traj)`                  | ボール近接性によるヒューリスティックなポゼッション → `{ type, team, confidence, method }` |
| `detect_intent_shift_points(traj, fps)`          | ポゼッション変化やフォーメーション緊密性の変化など、意図シフトを検出                      |
| `propose_segments_from_shifts(...)`              | シフト点をセグメントウィンドウと提案メタデータに変換                                      |
| `determine_half(timestamp, match_duration=5400)` | 前後半の分類と `game_clock` 文字列を生成                                                  |

### 出力形式

**`data/clip_manifest.json`** — 以下のようなフィールドを持つクリップオブジェクトの配列：

```jsonc
{
  "id": "match_01_0042_seg00",
  "match_id": "match_01",
  "path": "raw_videos/match_01.mp4",
  "start": 38.0,
  "end": 56.0,
  "annotation_start": 42.0,
  "annotation_end": 52.0,
  "annotation_window": 10.0,
  "half": 1,
  "game_clock": "00:42",
  "quality_score": 0.95,
  "quality_issues": [],
  "tracking_coverage": {
    "team_a_avg": 10.8,
    "team_b_avg": 10.6,
    "ball_frames": 248,
    "total_frames": 250,
  },
  "possession_state": {
    "type": "POSSESSION",
    "team": "A",
    "confidence": 0.8,
    "method": "proximity",
  },
  "team_perspective": {
    "team_a_color": "white",
    "team_b_color": "red",
    "team_a_attacking_direction": "right",
    "recommended_annotate_team": "A",
  },
  "anchor_event": {
    "type": "shot",
    "timestamp": 47.0,
    "description": "Shot on goal near match time 47s",
  },
  "segment_proposal": {
    "reason": "possession_change",
    "shift_frame": 96,
    "confidence": 0.9,
  },
}
```

**`data/trajectories/<match_id>/<match>_<start>_<end>.npz`** — `numpy.savez` で key `trajectory`、shape `(T, 23, 5)`：

| 軸   | 意味                                                         |
| ---- | ------------------------------------------------------------ |
| `T`  | ウィンドウのフレーム数                                       |
| `23` | 選手 0〜10（チーム A）、11〜21（チーム B）、22（ボール）     |
| `5`  | `x, y, vx, vy, height`（最後の次元は index 22 のボール高さ） |

---

## 📐 アノテーションスキーマ

UI から送信された各アノテーションは次の形になります（`src/lib/constants.ts` にミラー定義）：

```ts
interface Annotation {
  schema_version: "1.0.0";
  dataset: "TACTIC-Bench";
  clip_id: string;
  match_id: string;
  match_name: string;
  half: "1st" | "2nd";
  window_idx: number;

  game_state: {
    half: "1st" | "2nd" | "ET1" | "ET2";
    match_clock_sec: number;
    score_home: number;
    score_away: number;
    set_piece?: boolean;
    set_piece_type?: "corner" | "free_kick" | "throw_in" | "penalty";
    dead_ball?: boolean;
    dead_ball_reason?: string;
  };

  video_source: {
    video_path: string;
    seek_start_sec: number;
    label_start_sec: number;
    label_end_sec: number;
    seek_end_sec: number;
    fps: number;
    tensor_fps: number; // 10
    source_frame_count: number;
    tensor_frame_count: number; // = round(duration * 10)、[20, 2000] にクランプ
  };

  segment_metadata: {
    start_sec: number;
    end_sec: number;
    duration_sec: number;
    tensor_frames: number;
    preceding_event?: string;
    following_event?: string;
    coverage_estimate: number; // 0..1
    is_mixed_phase: boolean;
  };

  reconstruction: {
    npz_path: string;
    tensor_shape: [number, number, number]; // [T, 23, 4]
    tensor_fps: number;
    quality_pass: boolean;
    tracked_players: number;
    padding_mask: boolean[];
  };

  team_a: {
    team_id: "Team_A";
    team_name: string;
    jersey_color: string;
    is_home: boolean;
    is_primary: boolean; // = possession
    label: {
      intent_class: string | null;
      confidence: number; // 1..5
      certainty: "low" | "medium" | "high";
    };
    possession: boolean;
  };

  team_b: {
    /* team_a と同じ形、ミラー */
  };

  team_config?: { team_a: TeamConfig; team_b: TeamConfig };

  exclusion: "DeadBall" | "ContestedPlay" | null;

  annotation_meta: {
    annotator_id: string; // デフォルト: "coach_001"
    session_id: string; // 例: "sess_20260607"
    annotation_timestamp: string; // ISO 8601
    annotation_duration_sec: number;
    tool_version: string; // "tactic-annotator-v3.0"
  };

  agreement: {
    annotated_at: string; // ISO 8601
    flagged_review: boolean; // "Flag Review" チェックボックスを反映
    skipped: boolean;
  };

  model_split: { assigned_split: "train" | "val" | "test" };
}
```

### バリデーションルール

| ルール                                                                          | 場所                          | 効果                                |
| ------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------- |
| 両チームに `intent_class` が必要（`exclusion` 設定時を除く）                    | `saveAnnotation`              | 送信をブロックしステータスを表示    |
| `CounterAttack` は **両チーム** に割り当て不可                                  | `saveAnnotation`              | 送信をブロック                      |
| ポゼッションのないチームの攻撃インテントを無効化                                | `disabledIntentIdsA/B`        | ボタンをグレーアウト                |
| `DeadBall` → 両チームが `DeadBall` に、`game_state.dead_ball = true` に自動設定 | インテントクリック            | 自動入力                            |
| 品質ゲート失敗時は送信ブロック（<18/22 トラッキング、≤3 red、スコア <0.8）      | `saveAnnotation`              | ステータスメッセージ                |
| 20 アノテーションごとに強制休憩                                                 | `sessionBreakDue`             | "Resume After Break" ボタン         |
| 1 セッションあたり最大 50 アノテーション                                        | `saveAnnotation`              | "Export or reset before continuing" |
| 最小セグメント長 2.0 秒                                                         | `saveAnnotation`、split/merge | 閾値以下ではブロック                |

---

## ⌨️ キーボードショートカット

`<input>`、`<textarea>`、`<select>` にフォーカスがある時は無視されます。`Ctrl` / `Cmd` / `Alt` との組み合わせはブラウザに渡されます。

### 再生

| キー               | 操作               |
| ------------------ | ------------------ |
| `Space` または `K` | 再生 / 一時停止    |
| `J`                | −10 秒シーク       |
| `L`                | +10 秒シーク       |
| `←`                | −5 秒シーク        |
| `→`                | +5 秒シーク        |
| `Shift` + `←`      | −1 秒シーク        |
| `Shift` + `→`      | +1 秒シーク        |
| `[`                | 前のクリップ       |
| `]`                | 次のクリップ       |
| `U`                | ミュート / 解除    |
| `F`                | フルスクリーン切替 |

### チーム & アノテーション

| キー    | 操作                                                                 |
| ------- | -------------------------------------------------------------------- |
| `A`     | アクティブチームを A に切替                                          |
| `B`     | アクティブチームを B に切替                                          |
| `S`     | 現在のクリップをスキップ（`agreement.skipped = true` を保存）        |
| `Enter` | アノテーションを送信。両方のマークが設定されている時はセグメント作成 |

### マーク / 分割ワークフロー

| キー  | 操作                                                   |
| ----- | ------------------------------------------------------ |
| `M`   | 現在のプレイヘッドで開始マーク                         |
| `N`   | 現在のプレイヘッドで終了マーク（未設定なら両方マーク） |
| `X`   | 現在のプレイヘッドでクリップを分割                     |
| `Esc` | マークをキャンセル、ヘルプモーダルを閉じる             |

### インテントホットキー

アノテーション中にホットキーを押すと、**アクティブチーム** のインテントがトグルされます。

| ホットキー | インテント        | グループ   |
| ---------- | ----------------- | ---------- |
| `1`        | `BuildUp_Short`   | BuildUp    |
| `2`        | `BuildUp_Long`    | BuildUp    |
| `Q`        | `PossCirculation` | BuildUp    |
| `3`        | `CounterAttack`   | Attack     |
| `W`        | `DirectAttack`    | Attack     |
| `4`        | `HighPress`       | Press      |
| `5`        | `MidBlockPress`   | Press      |
| `6`        | `LowBlock`        | Press      |
| `7`        | `AttackingTrans`  | Transition |
| `8`        | `DefensiveTrans`  | Transition |
| `9`        | `SetPieceAttack`  | SetPiece   |
| `0`        | `SetPieceDefend`  | SetPiece   |
| `R`        | `DeadBall`        | Exclusion  |
| `T`        | `ContestedPlay`   | Exclusion  |

### ヘルプ

| キー                        | 操作                                        |
| --------------------------- | ------------------------------------------- |
| `?`（または `Shift` + `/`） | 画面上のヘルプ / ショートカットモーダル切替 |

---

## 🏷️ TACTIC インテント一覧

`src/lib/constants.ts` に定義された正確な順序の全 14 ラベル。UI はこれらの hex カラーをグループアクセントとチップに使用します。

| グループ       | カラー              | インテント ID | ラベル            | ホットキー | 戦術的役割                                                   |
| -------------- | ------------------- | ------------- | ----------------- | ---------- | ------------------------------------------------------------ |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 1             | `BuildUp_Short`   | `1`        | 自陣でのショートパス循環                                     |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 2             | `BuildUp_Long`    | `2`        | 守備からのロングボール展開                                   |
| **BuildUp**    | 🟢 Teal `#2dd4bf`   | 3             | `PossCirculation` | `Q`        | 忍耐強いサイドチェンジ保持                                   |
| **Attack**     | 🟣 Indigo `#818cf8` | 4             | `CounterAttack`   | `3`        | ボール奪取からの速攻                                         |
| **Attack**     | 🟣 Indigo `#818cf8` | 5             | `DirectAttack`    | `W`        | 中盤を経由せず前線へ直接                                     |
| **Press**      | 🔴 Rose `#fb7185`   | 6             | `HighPress`       | `4`        | 相手ハーフでのアグレッシブプレス                             |
| **Press**      | 🔴 Rose `#fb7185`   | 7             | `MidBlockPress`   | `5`        | 中盤でのプレス / ミッドブロック                              |
| **Press**      | 🔴 Rose `#fb7185`   | 8             | `LowBlock`        | `6`        | 深い位置での守備ブロック                                     |
| **Transition** | 🟪 Purple `#c084fc` | 9             | `AttackingTrans`  | `7`        | オフリバルン / 攻撃的トランジション                          |
| **Transition** | 🟪 Purple `#c084fc` | 10            | `DefensiveTrans`  | `8`        | カウンタープレス / 守備的トランジション                      |
| **SetPiece**   | 🩷 Pink `#f472b6`   | 11            | `SetPieceAttack`  | `9`        | 攻撃セットピース（CK、FK 等）                                |
| **SetPiece**   | 🩷 Pink `#f472b6`   | 12            | `SetPieceDefend`  | `0`        | セットピース守備                                             |
| **Exclusion**  | ⚪ Slate `#94a3b8`  | 13            | `DeadBall`        | `R`        | プレーが停止 — `exclusion` に保存（`intent_class` ではない） |
| **Exclusion**  | ⚪ Slate `#94a3b8`  | 14            | `ContestedPlay`   | `T`        | ポゼッション不明瞭でラベル不可 — `exclusion` に保存          |

### ポゼッション連動ラベルルール

- **攻撃インテント**（`BuildUp_*`、`PossCirculation`、`CounterAttack`、`DirectAttack`、`SetPieceAttack`、`AttackingTrans`）はラベリングするチームがポゼッションを持つ必要があります。
- **守備インテント**（`HighPress`、`MidBlockPress`、`LowBlock`、`SetPieceDefend`、`DefensiveTrans`）はラベリングするチームが **非ポゼッション** である必要があります。
- `CounterAttack` は **どちらか一方のチーム** のみに割り当て可能（両チーム同時不可）。
- `ContestedPlay` と `DeadBall` は `exclusion` フィールドに入り、各チームの `intent_class` は `null` に設定されます。

---

## 📤 エクスポート形式

アノテーターは 2 つのエクスポート形式をサポートします。どちらのファイルも **サーバ側** で `data/exports/` に書き出され、ブラウザ側でもダウンロードされます。

### JSON — `TACTIC_FP_Annotated_<match_id>.json`

TACTIC-Bench「model-sample」形式（セグメントごとに 1 レコード）：

```jsonc
[
  {
    "segment_id": "match_01_0042_seg00",
    "match_id": "match_01",
    "half": "1st",
    "start_sec": 42.0,
    "end_sec": 52.0,
    "duration_sec": 10.0,
    "coverage_estimate": 0.95,
    "reconstruction": {
      "npz_path": "data/trajectories/match_01/match_01_0042_0052.npz",
      "tensor_shape": [100, 23, 4],
      "tensor_fps": 10,
      "quality_pass": true,
      "tracked_players": 22,
      "padding_mask": [1, 1, 1, "…"],
    },
    "team_a": {
      "label": {
        "intent_class": "BuildUp_Short",
        "confidence": 4,
        "certainty": "high",
      },
      "is_primary": true,
      "possession": true,
    },
    "team_b": {
      "label": {
        "intent_class": "HighPress",
        "confidence": 4,
        "certainty": "high",
      },
      "is_primary": false,
      "possession": false,
    },
    "exclusion": null,
    "model_split": "train",
  },
]
```

純粋な除外クリップの場合は `{ segment_id, match_id, half, start_sec, end_sec, duration_sec, coverage_estimate, reconstruction, exclusion, model_split }` に折りたたまれます（`team_a` / `team_b` は無し）。

### CSV — `TACTIC_FP_Annotated_<match_id>.csv`

スプレッドシート互換のフラットファイル。1 行 1 アノテーションで、以下のカラムが順に並びます：

```
clip_id, match_id, match_name, half, window_idx,
video_path, seek_start_sec, label_start_sec, label_end_sec, seek_end_sec,
team_a_id, team_a_name, team_a_jersey_color,
team_a_intent, team_a_confidence, team_a_possession,
team_b_id, team_b_name, team_b_jersey_color,
team_b_intent, team_b_confidence, team_b_possession,
exclusion, flagged_review, skipped, annotated_at
```

値は RFC-4180 準拠でクォート（カンマ、引用符、改行をエスケープ）。ブール値は `true` / `false`、欠損値は空文字。

### デフォルトチームアイデンティティ（右パネルで編集可能）

| フィールド     | チーム A           | チーム B           |
| -------------- | ------------------ | ------------------ |
| `team_id`      | `Team_A`           | `Team_B`           |
| `name`         | `Team A`（編集可） | `Team B`（編集可） |
| `jersey_color` | `#ef233c`（赤）    | `#3b82f6`（青）    |
| `is_home`      | `true`             | `false`            |

---

## 🐞 トラブルシューティング

| 症状                                                         | 推定原因                                        | 対処                                                                                                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Generate Manifest** 実行時に `Error: spawn python3 ENOENT` | `python3` が `$PATH` に無い                     | Python 3.10+ をインストールし、シェルで `python3 --version` が動作することを確認。ルートは 500 時に `python` に自動フォールバックしますが、両方失敗時はパイプラインが起動できません。 |
| MKV 変換時に `ffmpeg not found`                              | `ffmpeg` バイナリが未インストール               | 上記の OS 別インストール表を参照。`ffmpeg -version` で確認。                                                                                                                          |
| 動画が再生されない / "MKV needs a browser-ready MP4"         | ブラウザが `<video>` で MKV をデコードできない  | プレーヤーの **Convert to MP4** ボタンをクリックするか、API を実行：`curl -X POST .../api/videos/convert -d '{"source":"match_02.mkv"}'`。                                            |
| `npm run dev` で `EADDRINUSE`                                | 別プロセスがポート 3000 / 5173 を占有           | 該当プロセスを停止、または `PORT=3001 npm run dev`（Next.js は `PORT` を読み取る）。                                                                                                  |
| 送信時に "Quality gate failed" でブロック                    | トラッキング 18/22 未満、または品質スコア < 0.8 | ソース動画を改善するか、レビュー用にクリップをマーク、`Skip` で `ContestedPlay` として記録。                                                                                          |
| "Session hard cap reached at 50 clips"                       | 1 セッションに 50 件のアノテーション            | **JSON** または **CSV** でエクスポート後、**Reset Session** で続行。                                                                                                                  |
| クリップ切替時にサーバがクラッシュ                           | 古い Node の `Readable.toWeb` バグの可能性      | 既に対応済み — ルートは AbortSignal 対応のカスタム `ReadableStream` を使用。それでも再現する場合は Node 18.17+ であることを確認。                                                     |
| リフレッシュ後にアノテーションが残らない                     | `data/annotations.json` に書き込み権限が無い    | `data/` ディレクトリのファイルシステム権限を確認。                                                                                                                                    |
| `Cannot find module '@/lib/...'`                             | TS パスエイリアスが解決されない                 | `tsconfig.json` に `"paths": { "@/*": ["./src/*"] }` があるか確認し、エディタの TS サーバを再起動。                                                                                   |
| `Module not found: Can't resolve 'child_process'`            | `child_process` はサーバ側でのみ動作            | ルートは Route Handler（サーバ）で動作。ブラウザで表示される場合は、サーバモジュールを誤ってクライアントコンポーネントにインポートしています。                                        |

---

## 🗺️ ロードマップ

- [ ] レビュワーロールとクリップ単位の割り当てによるマルチユーザ協調
- [ ] アノテータ間一致度スコアリング（Cohen's κ、Krippendorff's α）
- [ ] モデル支援サジェストモード（LLM / VLM がクリップフレームからインテントを提案）
- [ ] 複数試合を 1 アーカイブにバッチエクスポート
- [ ] 専用 QA ワークフロー（監査キュー、オーバーライド、サインオフ）
- [ ] トラッカー品質診断パネル（選手単位のカバレッジヒートマップ）
- [ ] 設定可能な 6 グループ / 14 ラベルのタクソノミー（YAML 差し替え）
- [ ] ワンクリック Docker Compose（Next.js + パイプライン + MinIO）
- [ ] 共有セッション用 WebSocket ライブアノテーションフィード

---

## 👥 メンテナー

<div align="center">
<table>
<tr>
<td align="center">
  <a href="https://github.com/shafayatsaad">
    <img src="https://github.com/shafayatsaad.png" width="120px" style="border-radius: 50%;" alt="Shafayat Saad" />
    <br />
    <strong>Shafayat Saad</strong>
  </a>
  <br />
  <sub>プロジェクトリード · サッカー分析 & AI</sub>
  <br /><br />
  <a href="https://www.linkedin.com/in/shafayatsaad">
    <img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" />
  </a>
  <a href="https://shafayatsaad.vercel.app/">
    <img src="https://img.shields.io/badge/Portfolio-101010?style=flat-square&logo=google-chrome&logoColor=white" />
  </a>
  <a href="https://github.com/shafayatsaad">
    <img src="https://img.shields.io/badge/GitHub-181717?style=flat-square&logo=github&logoColor=white" />
  </a>
</td>
</tr>
</table>
</div>

---

## 📝 設計メモ

- **`DeadBall` と `ContestedPlay`** はトップレベルの `exclusion` フィールドに保存され、`team_a.label.intent_class` や `team_b.label.intent_class` には入りません。これは設計上の選択で、下流のモデル学習が除外を別分類ヘッドとして扱えるようにします。
- **攻撃インテントは `possession: true` を強制**、守備インテントは `possession: false` を強制。違反は送信時にブロックされ、ステータスピルに表示されます。
- **アノテーション上限 = 50**、**強制休憩 = 20 ごと**、**最小セグメント長 = 2.0 秒**、**品質ゲート = ≥ 18/22 トラッキング + スコア ≥ 0.8**。これらの定数は `src/components/AnnotatorClient.tsx` にあり、簡単に調整できます。
- **`reconstruction.padding_mask`** は 0/1 の配列で、トレーナーにテンソル位置が実データかゼロパディングかを伝えます。`tensor_frames` から生成され（`[20, 2000]` にクランプ）。
- **`Clip` と `Annotation` 型（`src/lib/constants.ts`）** が単一の真実の源です。スキーマを拡張する際は同期させてください。Python パイプラインと API ルートは同じフィールド名でシリアライズします。
- **より詳細な設計ノートは [`tech-spec.md`](../tech-spec.md) を参照**（コンポーネント一覧、フック契約、アニメーションテーブル、状態構造）。

---

<div align="center">
  <sub>Built with Next.js · React · TypeScript · Tailwind · Python · ffmpeg · and a lot of match footage.</sub>
  <br />
  <sub>© TACTIC-FP Annotator · Licensed under the project's repository license.</sub>
</div>
