# 重启后：新版融合、修补痕迹复核与 Android 原外网实测

2026-10-17。沿用公开发布的 Windows 0.11.0 / Android 0.8.0，应用代码与安装包未改动。日常 ComfyUI 0.39.1 已加载 `repair-aware-v3`；本次全部视觉检查与重绘均使用重启后的日常服务，未使用独立测试服务。

**完整交互及原外网链路已跑通；视觉准确度仍有限。** 初始修补痕迹能正确分类，真正多出的纽扣能提示。重绘后的复检仍发生误数，被降为证据不足，必须查看原图后再确认，不能当成自动检查完全正确。

## 连接与样例

| 平台 | 应用 | 实际生成／复核服务 | 新策略 |
|---|---|---|---|
| Windows | 0.11.0 | `http://127.0.0.1:8188` | `repair-aware-v3` |
| Android | 0.8.0 签名 APK，Android 36 x86_64 模拟器 | `https://frp-rib.com:35961` | `repair-aware-v3` |

Android 沿用此前授权的精确证书指纹 `02:2A:5F:0B:7B:62:F7:34:6B:D6:76:D2:C0:49:EC:08:56:1F:D4:B3:0B:2F:27:6B:D4:6E:61:56:C5:30:05:A6`，没有关闭 TLS 校验或新增证书授权。检查、当前图与历史上传、排队、接收报告、生成及下载均通过原外网地址的原生网络层。离线对照另从本机读取服务器正式输出，未代替手机的实际下载。

[Windows 能力](windows-capability.json) · [Android 能力与证书](android-capability.json) · [安装包及节点来源](provenance.json)。本地 APK／EXE 的 SHA256 与 GitHub Release 元数据一致，已安装节点文件与发布源码一致。

使用独立命名的合成测试作品：棕色双发髻、绿色上衣、卡其色裤子；正面两颗黄色纽扣，目标左侧三颗。另一份作品使用上轮留下的绿色圆形修补痕迹，并附修正前图和实际选区。它们验证颜色、部件数量和流程，不是实际人物照片或服装／发型总体准确率基准。本次没有下载模型或更换已安装的本地视觉模型 `qwen3.6:35b-a3b`。

## 初检、区域与确认

| 样例 | Windows | Android 原外网 |
|---|---|---|
| 绿色修补圆圈及对应历史 | `repair_artifact / surface_trace`，零结构重绘建议 | 同样归为修补痕迹，零结构重绘建议 |
| 同位置真正的第三颗黄色纽扣 | 保留 2 对 3 的结构数量差异 | 同样保留 2 对 3 的结构数量差异 |

初检由界面按钮触发，完成后报告仍未确认，没有新生成图片。展开全部复核证据和修正历史，点击“查看对应区域”，验证定位覆盖层与原图显示尺寸一致，修正前／当前／选区三张缩略图均加载。原始报告见 [Windows 痕迹](windows-artifact-initial.json)、[Android 痕迹](android-artifact-initial.json)、[Windows 数量](windows-buttons-initial.json)、[Android 数量](android-buttons-initial.json)。

痕迹样例在测试端核对后显式点击全局确认；确认前阻止使用这组视图直接继续建模，确认后保存确认状态，没有新增任务或素材。见 [Windows 确认](windows-artifact-confirmation.json)、[Android 确认](android-artifact-confirmation.json)。

数量样例点击“确认建议并调整选区”仅保存接受状态、打开编辑器，没有提交生成或新增素材。随后撤销初始定位框，用 72 像素笔刷涂选中间纽扣，测试撤销后不可提交、重做后恢复，再点击“开始局部重绘”。Windows 使用鼠标事件，Android 使用触屏事件。模型初始框较宽，实际涂选后才提交，未直接把整件上衣交给重绘。

[Windows 选区／确认](windows-approval.json) · [Android 选区／确认](android-approval.json) · [Windows 定位尺寸](windows-region-geometry.json) · [Android 定位尺寸](android-region-geometry.json)。

## 真实重绘与边缘融合

两端各提交一次 Qwen 2.1、25 步、denoise 1 的真实生成。正式 RGB 来自未提前合成的候选，自动抠图参考服务端稳定合成图，客户端只融合一次。服务器正式输出与 Android 实际下载的原始设计图字节完全相同。

| 指标 | Windows | Android 原外网 |
|---|---:|---:|
| 尺寸 | 640 × 800 | 640 × 800 |
| 选区外像素 | 507,742 | 507,536 |
| 选区外 RGBA 改变 | **0** | **0** |
| 选区内改变像素 | 3,913 | 4,088 |
| 中间黄色像素，修正前 → 后 | 861 → **0** | 861 → **0** |
| 上方黄色像素，修正前 → 后 | 861 → 861 | 861 → 861 |
| 下方黄色像素，修正前 → 后 | 861 → 861 | 861 → 861 |

本轮两端均移除多余纽扣，上下两颗保留。新版本替换左侧槽位，原图、实际选区与前景蒙版保留。旧检测随视图变更过期；测试通过生成入口请求继续建模时被阻止，未向 ComfyUI 提交 3D 任务。没有实际生成新的 3D 模型。

### 同候选颜色对照

固定本次各自的生成候选、选区和 alpha，比较直接单次蒙版混合与实际新版融合，未换种子重抽样。指标为中心 (320,540) 半径 24–37 像素绿色布料环带的 RGB 每通道平均绝对偏差，环带 2,504 像素，排除原黄色纽扣。Android 使用浏览器实际解码的输入像素计算基线。

| 平台 | 直接单次蒙版混合 | 新版实际结果 | 色差降低 |
|---|---:|---:|---:|
| Windows | 4.779 | 2.513 | 47.4% |
| Android | 2.481 | 1.402 | 43.5% |

本次基线是直接单次混合，与上一份报告的旧版双次混合基线不同。两端种子不同，不将平台之间的数字当作性能或效果差异。结果与共享融合函数计算值在 alpha 及不透明区域 RGB 上一致，没有发现再次重复融合。圆形色差仍可见；这些样例不保证复杂纹理、照片或所有选区都会获得相同改善。

[逐像素指标及任务编号](verification.json) · [Windows 原始候选](windows-candidate.png) · [Android 原始候选](android-candidate.png)。

| 平台 | 修正前 | 实际修正后 |
|---|---|---|
| Windows | ![Windows 修正前](windows-before.png) | ![Windows 修正后](windows-after.png) |
| Android | ![Android 修正前](android-before.png) | ![Android 修正后](android-after.png) |

## 重绘后的复检：保留误判，显式核对

两端均重新点击视觉检查，通过各自原服务取得 version 3 报告。新报告绑定新图、其直接父图和本次实际选区，仍未自动确认。

两份复检把实际两颗黄色纽扣误读成三颗，原始总结仍称存在结构差异；模型缺少正面对应区域，最终检查被降为 `uncertain`，零可执行结构重绘建议。它们**不是视觉判断完全正确的结果**，不能只看“零建议”或模型自评。已核对送入 ComfyUI 的当前图与实际新 PNG 逐字节一致，排除上传旧图；图片和像素统计确认中间黄色为零，绿色修补轮廓仍有残留。见 [Windows 复检](windows-recheck.json)、[Android 复检](android-recheck.json)。

测试端依据查看图片及像素检查结果，显式点击“已核对标记及不确定项，确认本次检测”。未改写模型报告的观察、总结或分类，没有自动再次重绘，没有新增图片或任务。刷新界面后，确认状态、历史报告、父图与选区引用均保留。见 [Windows 明确确认](windows-manual-confirmation.json)、[Android 明确确认](android-manual-confirmation.json)、[Windows 重载](windows-persistence.json)、[Android 重载](android-persistence.json)。

因此，本次确认外网链路、边缘融合、历史标记、确认后重绘和显式复检流程可用，同时保留视觉误数这一准确度限制。实际作品仍需对照新图检查，不建议依据自动总结直接执行下一次修正。

## 复核证据

本次没有修改应用代码、安装包或运行中的节点，不需要再次重启 ComfyUI。此前验证目录保留，新增本报告与原始任务、PNG、界面截图及确认记录。手机设置仍为原外网地址和原精确证书授权。Android 为模拟器 APK 实测，未做 ARM64 真机验收。

在已安装项目依赖的仓库中，可离线检查保存的 PNG、选区外像素、纽扣颜色、融合指标及证据哈希：

```powershell
node docs/repair-blend-remote-validation/check-evidence.mjs
```

[证据 SHA256 清单](evidence-manifest.json) · [Windows 复检界面](windows-rechecked.png) · [Android 外网复检界面](android-rechecked.png)。
