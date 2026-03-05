# DLOSy20 - ソフトウェア技術ドキュメント

## 技術スタック

| レイヤー     | 技術              | 備考                                                    |
| ------------ | ----------------- | ------------------------------------------------------- |
| マークアップ | HTML5             | セマンティック構造、単一ページ                          |
| スタイリング | Vanilla CSS       | CSS変数でデザインシステム管理                           |
| ロジック     | JavaScript (ES6+) | クラスベース、フレームワーク不使用                      |
| 音声処理     | Web Audio API     | OscillatorNode / BufferSource / BiquadFilter / GainNode |
| フォント     | Google Fonts      | Orbitron (Display) / Share Tech Mono (Mono)             |
| 開発サーバー | npx serve         | Node.jsベースの静的サーバー                             |

> [!NOTE]
> フレームワーク（React/Vue等）やバンドラー（Vite/Webpack等）は使用していません。
> すべてのJSファイルは `<script>` タグで直接読み込まれます。

---

## ソフトウェア構成図

### ファイル構造

```
DLOSy20/
├── index.html                 ← エントリーポイント（レイアウト定義）
├── styles/
│   └── main.css               ← 全スタイル定義（CSS変数 + コンポーネント）
├── js/
│   ├── audio-engine.js        ← Web Audio API 音声エンジン
│   ├── ui-components.js       ← ノブ・鍵盤・ボタン UI
│   ├── step-sequencer.js      ← 16ステップシーケンサー
│   ├── drum-machine.js        ← ドラムマシン (BD/SD/CHH/OHH)
│   ├── vco-loop.js            ← VCO Loop 曲線エディタ
│   ├── drawing-mode.js        ← Drawing Mode 描画→波形変換
│   └── app.js                 ← メイン初期化スクリプト
└── Doc/
    └── architecture.md        ← 本ドキュメント
```

### モジュール依存関係

```mermaid
graph TD
    subgraph "index.html"
        HTML["HTML レイアウト"]
        CSS["styles/main.css"]
    end

    subgraph "Audio Layer"
        AE["audio-engine.js<br/>(AudioContext / Master)"]
    end

    subgraph "Sequencer Layer"
        SS["step-sequencer.js<br/>(16 Step / 再生制御)"]
        DM["drum-machine.js<br/>(BD/SD/CHH/OHH)"]
    end

    subgraph "Synth Extensions"
        VCO["vco-loop.js<br/>(曲線エディタ / 連続パラメータ)"]
        DRAW["drawing-mode.js<br/>(Canvas描画 → LR波形)"]
    end

    subgraph "UI Layer"
        UI["ui-components.js<br/>(ノブ / 鍵盤 / ボタン)"]
    end

    APP["app.js<br/>(初期化)"]

    APP --> AE
    APP --> UI
    APP --> SS
    APP --> DM
    APP --> VCO
    APP --> DRAW

    UI -->|"playNote / setParam"| AE
    UI -->|"recordStep"| SS

    SS -->|"playFreq / playFreqWithDrawing"| AE
    SS -->|"playStep"| DM
    SS -->|"onStepTick"| VCO

    DM -->|"playBD/SD/CHH/OHH"| AE

    VCO -->|"startOsc / applyAtPosition"| AE
    VCO -->|"Drawing波形バッファ"| DRAW

    DRAW -->|"playFreqWithDrawing"| AE
    DRAW -->|"refreshDrawingOsc"| VCO
```

### 音声ルーティング

```mermaid
graph LR
    subgraph "音源 A: Step Sequencer"
        OSC_A["Oscillator<br/>(Sine/Tri/Sqr/Saw)"]
        BUF_A["BufferSource<br/>(Drawing波形 L/R)"]
    end

    subgraph "音源 B: VCO Loop"
        OSC_B["Oscillator / BufferSource"]
    end

    subgraph "サブ: Drums"
        BD["Bass Drum"]
        SD["Snare"]
        HH["HiHat"]
    end

    subgraph "エフェクト"
        FLT["BiquadFilter<br/>(LPF)"]
        DLY["Delay + Feedback"]
    end

    MASTER["Master Gain"]
    OUT["AudioContext.destination<br/>(スピーカー / DAW)"]

    OSC_A --> FLT
    BUF_A --> FLT
    FLT --> MASTER
    FLT --> DLY --> MASTER

    OSC_B --> MASTER

    BD --> MASTER
    SD --> MASTER
    HH --> MASTER

    MASTER --> OUT
```

---

## 開発サーバー起動手順

### 前提条件

- **Node.js** (v16以上) がインストール済みであること

### コマンド

```powershell
# プロジェクトフォルダで実行
cd c:\Freefile\PROJECT\2026\02_DLOSyV2603\2_prj\DLOSy20
npx -y serve@latest ./
```

起動後、以下のURLにアクセス：

```
http://localhost:3000
```

> [!TIP]
> `npx -y` により `serve` パッケージを自動インストール＆実行します。
> ポートが使用中の場合は `3001` 等の別ポートが自動割り当てされます。

### 停止

ターミナルで `Ctrl + C` を押してサーバーを停止します。

### 代替手段（Python）

```powershell
cd c:\Freefile\PROJECT\2026\02_DLOSyV2603\2_prj\DLOSy20
python -m http.server 3000
```

---

## 主要モジュール概要

| モジュール          | 責務                                            | グローバル変数名 |
| ------------------- | ----------------------------------------------- | ---------------- |
| `audio-engine.js`   | AudioContext管理、シンセ/ドラム発音、エフェクト | `audioEngine`    |
| `ui-components.js`  | ノブ操作、鍵盤UI、PCキーボード入力マッピング    | `uiComponents`   |
| `step-sequencer.js` | 16ステップの記録/再生/テンポ/スイング制御       | `stepSequencer`  |
| `drum-machine.js`   | 4トラック(BD/SD/CHH/OHH)のパターン管理          | `drumMachine`    |
| `vco-loop.js`       | 8パラメータの曲線エディタ、連続オシレーター     | `vcoLoop`        |
| `drawing-mode.js`   | Canvas描画→LR波形変換、4スロット管理            | `drawingMode`    |
| `app.js`            | 全モジュールの初期化、AudioContext起動          | —                |
