# DLOSy20 - ソフトウェア技術ドキュメント

## 技術スタック

| レイヤー     | 技術              | 備考                                                    |
| ------------ | ----------------- | ------------------------------------------------------- |
| マークアップ | HTML5             | セマンティック構造、単一ページ                          |
| スタイリング | Vanilla CSS       | CSS変数でデザインシステム管理                           |
| ロジック     | JavaScript (ES6+) | クラスベース、フレームワーク不使用                      |
| 音声処理     | Web Audio API     | OscillatorNode / BufferSource / BiquadFilter / GainNode |
| 外部連携     | Web MIDI API      | MIDI OUT (外部機器/DAW制御)                             |
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
│   ├── step-sequencer.js      ← 16/32ステップシーケンサー（シームレス切替）
│   ├── drum-machine.js        ← ドラムマシン (6 tracks: BD/SD/CHH/OHH/CLP/RIM)
│   ├── adsr-editor.js         ← ADSR曲線ビジュアルエディタ
│   ├── midi-out.js            ← MIDI OUT (Web MIDI API)
│   ├── vco-loop.js            ← VCO Loop 曲線エディタ
│   ├── drawing-mode.js        ← Drawing Mode 描画→波形変換（8スロット）
│   ├── unim-search.js         ← Unim Unicode検索 → Drawing Mode連携
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
        AE["audio-engine.js<br/>(AudioContext / ADSR)"]
    end

    subgraph "Sequencer Layer"
        SS["step-sequencer.js<br/>(16/32 Step / 再生制御)"]
        DM["drum-machine.js<br/>(6 Tracks / Pattern)"]
    end

    subgraph "Synth Extensions"
        ADSR["adsr-editor.js<br/>(ビジュアルADSR管理)"]
        VCO["vco-loop.js<br/>(曲線エディタ / 連続パラメータ)"]
        DRAW["drawing-mode.js<br/>(Canvas描画 → LR波形)"]
    end

    subgraph "External Integration"
        MIDI["midi-out.js<br/>(Web MIDI API)"]
        UNIM["unim-search.js<br/>(Unim API → Drawing Mode)"]
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
    APP --> ADSR
    APP --> MIDI
    APP --> UNIM

    UI --> AE
    UI --> SS

    SS --> AE
    SS --> DM
    SS --> VCO

    DM --> AE
    DM --> MIDI

    ADSR --> AE

    VCO --> AE
    UNIM --> DRAW
    VCO --> DRAW

    DRAW --> AE
    DRAW --> VCO
```

### 音声ルーティング

```mermaid
graph LR
    subgraph "音源 A: Step Sequencer"
        OSC_A["Oscillator / BufferSource"]
    end

    subgraph "音源 B: VCO Loop"
        OSC_B["Oscillator / BufferSource"]
    end

    subgraph "サブ: Drums (6ch)"
        DRUMS["BD/SD/CHH/OHH/CLP/RIM"]
    end

    subgraph "エフェクト"
        ADSR_ENV["ADSR Envelope"]
        FLT["BiquadFilter (LPF)"]
        DLY["Delay + Feedback"]
    end

    MASTER["Master Gain"]
    OUT["Destination"]

    OSC_A --> ADSR_ENV --> FLT
    OSC_B --> MASTER
    DRUMS --> MASTER

    FLT --> MASTER
    FLT --> DLY --> MASTER
    MASTER --> OUT
```

---

## MIDI 仕様 (MIDI OUT)

Korg Volca Drum 対応のチャンネル分離方式で、各ドラムパートが個別の MIDI チャンネルで送信されます。

| DLOSy20 パート | MIDI Ch | Volca Drum Part |
| -------------- | ------- | --------------- |
| **BD**         | Ch 1    | Part 1          |
| **SD**         | Ch 2    | Part 2          |
| **CHH**        | Ch 3    | Part 3          |
| **OHH**        | Ch 4    | Part 4          |
| **CLP**        | Ch 5    | Part 5          |
| **RIM**        | Ch 6    | Part 6          |

- **ノート番号**: 60（固定。Volca Drum はノート番号を無視）
- **ベロシティ**: 100
- **Note Off**: 50ms 後に自動送信
- **接続**: ブラウザ経由での MIDI デバイス列挙・選択が可能

> [!NOTE]
> Web MIDI API は HTTPS または localhost でのみ動作します（Chrome推奨）。

---

## 開発サーバー起動手順

### 前提条件

- **Node.js** (v16以上) がインストール済みであること

### コマンド

```powershell
npx -y serve@latest ./
```

起動後、 `http://localhost:3000` にアクセス。

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

| モジュール          | 責務                                    | グローバル変数名 |
| ------------------- | --------------------------------------- | ---------------- |
| `audio-engine.js`   | AudioContext管理、シンセ/ドラム音源作成 | `audioEngine`    |
| `adsr-editor.js`    | エンベロープ曲線のビジュアル編集        | `adsrEditor`     |
| `step-sequencer.js` | 16/32ステップの記録・同期再生           | `stepSequencer`  |
| `drum-machine.js`   | 6トラックのドラムパターン・一括制御     | `drumMachine`    |
| `midi-out.js`       | Web MIDI API を介した外部出力管理       | `midiOut`        |
| `vco-loop.js`       | 8パラメータ曲線エディタ                 | `vcoLoop`        |
| `drawing-mode.js`   | Canvas描画→LR波形変換（8スロット）      | `drawingMode`    |
| `unim-search.js`    | Unim API検索 → Drawing Modeスロット反映 | `unimSearch`     |
| `app.js`            | 全モジュールの初期化                    | —                |

---

## Unim グリフ検索 (unim-search.js)

外部API (`https://s.baku89.com/unim/api/v1`) を介してUnicode文字のグリフ（SVGパス）を検索し、Drawing Modeのスロットに反映する。

### 検索モード (searchBy)

| モード | 説明                         | APIパラメータ |
| ------ | ---------------------------- | ------------- |
| Char   | 文字そのもので検索           | `?char=世`    |
| Code   | Unicode 16進数指定           | `?code=4E16`  |
| Index  | データベースインデックス番号 | `?index=123`  |

### フィルタモード (filterBy)

| モード | 説明                                           |
| ------ | ---------------------------------------------- |
| Code   | Unicode順（前後の文字）                        |
| pHash  | 画像ハッシュによる形状類似                     |
| CNN    | AI（畳み込みニューラルネット）による視覚的類似 |
| Name   | Unicode名称の文字列類似                        |

### 動作フロー

1. 検索欄に文字を入力 → **Enter** で検索実行
2. APIレスポンスをキャッシュ（フィルタ切替時は再fetchなし）
3. 結果グリッドにSVGサムネイル表示
4. **左クリック**: 現在のDrawスロットに上書き → 自動で次のスロットに進行 (1→2→…→8→1)
5. **右クリック**: 選択したグリフで再検索
