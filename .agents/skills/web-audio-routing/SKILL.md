---
name: Web Audio API Routing Guidelines
description: Rules for correctly routing Web Audio API nodes in DLOSy20, particularly for Stereo separation and Filter application, to avoid previous regressions.
---

# Web Audio API Routing Guidelines for DLOSy20

このスキルファイルは、過去に何度も発生した「フィルターが突然効かなくなる」「オシロスコープに波形が正しく反映されない（LRミックスダウンされる）」といったリグレッション（デグレ）を防ぐための、DLOSy20における音声ルーティングのコアルールを構造化・明文化したものです。
以降の開発においては、このガイドラインを必ず遵守してください。

## 1. フィルター（CUTOFF / RES）の確実な経由

シンセサイザーの各モジュール（VCO Loopなど）で発音処理を行う際、オシレーターの種類（通常波形とDRAW波形など）を問わず、最終的な出力（Master Gain等）に至る前に**必ずBiquadFilterを経由**させなければなりません。

- ❌ **誤った実装 (バイパスしてしまう)**:
  DRAWモードの波形に切り替えた際、分岐処理内で `panL.connect(this.gain)` のように直接Gainに繋いでしまう。これにより、CUTOFFとRESが無視されてしまいます。
- ⭕ **正しい実装**:
  `panL.connect(this.filter); panR.connect(this.filter); this.filter.connect(this.gain);` のように、必ず `this.filter` をチェインに挟むこと。

## 2. DRAWモードにおけるステレオ分離（L/Rセパレーション）

オシロスコープ（XYモード）で図形を正しく描画するためには、Lチャンネル（X軸）とRチャンネル（Y軸）の音声信号が完全に分離されている必要があります。Web Audio APIの仕様上、安易に処理すると音像がミックスダウンされ、図形が崩れます。

- ❌ **誤った実装 (ステレオダウンミックスの罠)**:
  `ctx.createBuffer(2, length, sampleRate)` のように1つのステレオバッファを作成し、それを `ChannelSplitterNode` 等を使ってパンニングすると、内部仕様によってLRが干渉し合い、完全なディスクリートステレオになりません。
- ⭕ **正しい実装 (Dual Mono方式)**:
  X軸用とY軸用の波形データを、**完全に独立した2つのモノラルバッファ**（`ctx.createBuffer(1, length, sampleRate)`）として確保し、それぞれ別々のオシレーター（`oscL`, `oscR`）で再生すること。その後、それぞれに対して `StereoPannerNode`（-1 と +1）を適用してから合成（またはフィルターへ入力）します。

## 3. 音声ノードパスの確認方法

新しい機能を追加したり、音源の切り替えロジック（例：`switchDrawBuffer` や `startOsc`）を修正したりする際は、必ず頭の中でオーディオグラフを再構築し、「オシレーター → （エフェクト/フィルター） → パン/ゲイン → マスター」のパスが一直線に繋がっているかを確認してください。
ルーティングの全体像は `Doc/architecture.md` の「音声ルーティング」図も参照のこと。
