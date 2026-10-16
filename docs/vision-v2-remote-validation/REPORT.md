# 新版复核与原外网完整流程实测

2026-10-17（北京时间）。日常 ComfyUI 重启后已经加载 `visibility-v2`，本次使用原本机服务和原外网地址，未使用 8198／8199 测试服务。最终验证版本：Windows 0.10.1、Android 0.7.1（versionCode 9）。

## 连接与范围

- Windows 连接 `http://127.0.0.1:8188`，ComfyUI 0.39.1；[实际连接记录](windows-connection.json)。
- Android 通过原地址 `https://frp-rib.com:35961` 执行检查、图片上传、重绘提交、结果下载和复检；[连接记录](android-connection.json)、[任务与像素证据](verification.json)。沿用原授权证书，SHA256 为 `02:2A:5F:0B:7B:62:F7:34:6B:D6:76:D2:C0:49:EC:08:56:1F:D4:B3:0B:2F:27:6B:D4:6E:61:56:C5:30:05:A6`，没有取消证书校验或换成局域网地址。
- Android 为 Android 16 x86_64 模拟器，使用签名 APK 覆盖升级，保留原连接和测试作品；没有实体手机验收。使用新增隔离测试作品，没有修改个人作品。
- 本次只运行到重绘后复核与确认，没有重新生成 Pixal3D 网格。Windows 包内示例 GLB、贴图、调色与蒙版编辑另有 [包冒烟记录](package/package-fresh-validation.json)。

## 实测发现与修复

0.10.0 / Android 0.7.0 可以正常完成工作流，但旧重绘强度 0.7 在本次小纽扣选区里保留了原结构：中间黄色像素仍分别有 849／856 个，旧版复检也继续报告数量差异。不能仅因任务完成就判定修正成功。[首次像素记录](low-noise-attempt/verification.json) · [首次 Android 复检](low-noise-attempt/android-recheck.json)。

在相同原图、选区和随机种子的本机对照中，仅提高选区重绘强度至 1 后，中间黄色区域归零，局部仍有轻微修补边缘。[对照结果](probe-full-noise.json) · [参数核对](probe-provenance.json) · [对照图](probe-full-noise.png)。因此修复两端共用的工作流为选区完整重新采样；保留原噪声蒙版、服务端选区合成和客户端 RGBA 合成，未修改 ComfyUI 节点或模型权重。其余实验保留为证据，未把它们的工作流一起带入产品。

0.10.1 / Android 0.7.1 通过应用重新执行了下面的全部步骤，不是把对照图直接放入作品。本次视觉节点内容与 0.10.0 相同，**已经完成本次重启的用户只需更新客户端，无需再重启 ComfyUI**。

## 最终流程结果

| 环节 | Windows | Android 原外网 |
| --- | --- | --- |
| 正常四视图复核 | 无重绘建议，保留透视解释 | 无重绘建议，保留透视解释 |
| 正面 2 颗／目标 3 颗纽扣 | 检出 1 项数量差异 | 检出 1 项数量差异 |
| 区域标记 | 目标红框、正面蓝框，覆盖层尺寸对齐 | 相同，手机换行后仍对齐 |
| 确认建议 | 只打开选区，不增加素材或生成任务 | 相同 |
| 调整选区 | 撤销原建议框、画笔涂选中间纽扣、撤销／重做均生效 | 使用实际触屏事件，行为相同 |
| 点击开始局部重绘 | Qwen 生成＋自动抠图＋保存新版本 | 经原 HTTPS 地址提交、下载并保存 |
| 重绘后旧报告 | 自动过期；3D 提交在本地被阻止，无 prompt_id | 相同 |
| 新版本复检 | 无结构建议，仍待界面确认 | 识别为 2 颗黄色纽扣，同时报告浅色圆形修补痕迹 |
| 最终确认 | 界面确认后报告状态 confirmed | 对修补痕迹填写接受说明、逐项处理，再确认；状态 confirmed |

Android 的最后一条提示没有被静默删除。测试通过界面填写了“不是第三颗纽扣；作为黏土制作参考接受轻微痕迹，精细图可继续修整”的说明，再确认结果。因此 **Android 复检不是模型零差异，也不能用本次结果声称消除了所有误报**。[Android 复检原文](android-recheck.json) · [最终决定与说明](android-final.json) · [界面处理](android-manual-disposition.png)。

## 独立像素核验

两端均为 640 × 800 的原始目标图，最终结果由应用保存后重新读取。按照实际保存的灰阶选区逐像素比较 RGBA；软选区中任何非零像素都计为选区内。

| 核验 | Windows | Android |
| --- | ---: | ---: |
| 选区外像素 | 507,742 | 507,536 |
| 选区外发生变化 | **0** | **0** |
| 选区内发生变化 | 3,928 | 4,092 |
| 中间黄色像素：前 → 后 | 849 → **0** | 856 → **0** |
| 上方纽扣黄色像素：前 → 后 | 861 → 861 | 861 → 861 |
| 下方纽扣黄色像素：前 → 后 | 861 → 861 | 861 → 861 |
| 整图 alpha 通道 | 相同 | 相同 |

黄色统计仅是该受控色块样例的独立检查，不能替代通用视觉识别。原图、前景、修正选区、新版本和历史报告都保留；新视图槽位指向新结果。最终确认没有新增素材或生成任务。

查看：[Windows 前](windows-before.png)／[选区](windows-mask.png)／[后](windows-after.png)；[Android 前](android-before.png)／[选区](android-mask.png)／[后](android-after.png)。透明背景在部分图片查看器中会显示为黑色。[图片哈希](image-hashes.json)。

## 界面与工程验证

- [Windows 正常透视](windows-normal-perspective.png)、[区域标记](windows-selected-region.png)、[调整后选区](windows-confirmed-selection.png)、[新版本复检](windows-rechecked.png)。
- [Android 正常透视](android-normal-perspective.png)、[区域标记](android-selected-region.png)、[确认后画笔选区](android-confirmed-selection.png)、[修补痕迹提示](android-rechecked.png)。
- [Windows 确认与画笔状态](windows-approval.json)、[Android 确认与画笔状态](android-approval.json)；[Windows 标记几何](windows-region-geometry.json)、[Android 标记几何](android-region-geometry.json)。
- 74 项 Node 测试、5 项 Python 适配器测试、TypeScript 构建、签名 Android Release 构建和 lintDebug 通过。Windows 0.10.1 免安装包首次运行验证通过。
- APK 沿用原签名证书，SHA256 `a138e795eb2b921ebdf3a42481c88c71514015e8b131324d9f32432a6d1cd8b6`。发布文件见 [artifacts.json](artifacts.json) 与 Release 的 SHA256SUMS.txt。
- 两端页面重新加载后，确认报告、说明、素材和历史保持不变，均无活动任务；见 [持久化核对](persistence.json)。

模型仍可能留下接缝、纹理或轮廓痕迹，也可能把它们当成新部件。本次修复的是小选区删除结构时重绘不足的问题，不能保证所有描述都一次修正成功。重绘后应继续核对；本次未改变用户确认、重新检测和视图过期的规则。
