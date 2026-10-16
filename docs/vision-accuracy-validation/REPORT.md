# 多视图透视与遮挡复核验证

2026-10-16；Windows 0.10.0 / Android 0.7.0（versionCode 8）。本次复用本机 `qwen3.6:35b-a3b` Q4_K_M、RTX 5090 32GB，没有换权重或训练模型。

## 行为变化

第一轮观察各方向发型、服装和配饰，第二轮结合原图与候选局部对照独立复核。输出结构差异、正常透视、遮挡／不可见、证据不足四类。只把证据满足条件的结构差异连接到重绘建议；其它分类可以定位和查看依据，不直接提供接受重绘按钮。所有结果仍待人工核对，不会自动修改图片或通过建模检查。

复核记录包含可见性、部件对应关系、比较依据、其它解释、数量单位、两张图证据、原始模型判定及降级原因。代码验证双方可见、同一部件、已排除其它解释、非仅二维轮廓、参照区域以及数量比较的一致性。高置信度不能越过这些条件。没有按“鞋子／口袋／配饰”等关键词直接隐藏错误。

version 2 报告、逐项决定、候选证据和任务历史双向同步；新版兼容 version 1 历史，旧应用拒绝导入 version 2，因此需要两端同时升级。更换视图仍会使报告过期。

## 同图对照与未解决问题

旧版适配器取自 v0.9.1 未修改文件，新版为本次最终适配器；使用相同图片字节和描述、相同已安装本地视觉模型。输入 SHA256、适配器 SHA256、耗时在 [旧版记录](baseline/summary.json) 和 [新版记录](final/summary.json)。这是人工标注的小样例回归，不能推算一般准确率。

| 样例 | 旧版重绘候选 | 新版重绘建议 | 人工判读 |
| --- | ---: | ---: | --- |
| 绿色围裙四视图 | 2 | 0 | 旧版混比鞋扣／鞋带细节，并把侧面遮住另一只鞋当成缺件；新版按透视处理。独立客户端另检出的侧面口袋位置候选也被复核驳回。 |
| 侧面只见一个发髻 | 2 | 0 | 旧版将发髻和眼睛可见数变化当差异；新版仍有一个证据矛盾的发髻候选，降为待人工核对，而非直接判完全一致。 |
| 同一可见上衣面板纽扣 2 → 3 | 1 | 1 | 保留真正的数量差异、两图证据与局部框。 |
| 侧面额外发髻 | 未跑旧版 | 0 | **未成为有效建议**：模型文字识别了新增发髻，但数量类型及参照区域不完整，保留为证据不足；需要人工选区。 |
| 裙装与裤装变化 | 未跑旧版 | 0 | **漏检**：模型将简化侧面下装解释为裙摆透视。此样例不能算通过。 |

两组正常视角样例中，旧版合计 4 条重绘候选，新版 0 条；一组真实纽扣差异仍检出。另两组正例未形成有效建议，不能声称提高了所有类别的召回。模型仍可能误读相机、隐藏部件或简单画稿，并生成重复待核对项；需看全图和证据，不能仅看红框数。新版 5 组直接推理约 7–15 秒，速度受模型缓存与设备负载影响；两轮通常比单轮慢。

## Windows 与 Android 运行验证

- 原生 Windows 客户端和签名 Android APK 分别通过独立 ComfyUI 测试服务执行真实两轮推理，未直接向客户端塞入假报告；详见 [Windows 报告](windows-review.json)、[Android 报告](android-review.json)。检测前后素材数相同，均待确认。
- 两端展示分类、展开证据、定位目标与参照区域；实际截图：[Windows 口袋复核](turnaround-ui.png)、[Android 纽扣证据](extra-buttons-ui.png)。Android 为 Android 16 模拟器，非实体手机验收。
- 手机接受纽扣建议后打开修正选区，素材数和任务数不增加；没有点击开始重绘，没有提交生成任务。[选区截图](android-confirm-selection.png)。原有重绘合成及画笔历史由回归测试覆盖，本次未重复运行昂贵的完整 Qwen 重绘／Pixal3D。
- 通过原生 HTTPS 同步服务完成两个新作品往返：Windows 的正常透视复核到手机、Android 的结构报告与接受决定到 Windows，逐字段相同。[同步证据](sync-validation.json)。无真实公网同步隧道。
- 绕过前端验证直接调用 Android 原生保存，拒绝 4 组不合法复核证据与引用；原报告不变。[原生校验](native-validation.json)。
- 原授权外网 ComfyUI 地址仍能通过固定证书连接，当前运行进程尚未加载新版策略。新版客户端在上传和提交前拒绝旧节点，保留已有报告；[版本提示实测](remote-version-gate.json)。**新版节点已安装到本机，日常 ComfyUI 需空闲重启后启用；本次未宣称新版公网推理通过。**

## 工程与复现

74 项 Node 测试、5 项 Python 适配器测试、TypeScript 构建、Android 签名 Release 构建和 lintDebug 通过。Windows 免安装包完成首次启动、示例、蒙版修正、内嵌贴图模型和黏土配方冒烟验证；见 [包验证](package/package-fresh-validation.json)。构建产物哈希见 [artifacts.json](artifacts.json) 与 Release 的 SHA256SUMS.txt。

使用旧版隔离作品库完成 [升级验证](package/package-upgrade-validation.json)，8 个素材文件及历史报告等字段保留。第一次升级冒烟脚本假定每个作品都有 3D 模型，对只有设计图的测试作品误报；已修正脚本仅在作品含模型时检查网格渲染，保留 [首次脚本结果](package/upgrade-harness-first-attempt.json)。首次安装测试仍完整验证示例模型渲染。Android 覆盖安装保留既有测试作品，沿用原 APK 签名证书。

在仓库根目录，使用已有 Pillow 的 ComfyUI Python 执行：

```powershell
& F:\ComfyUI-aki\py3112\python.exe tests/vision_adapter_test.py
& F:\ComfyUI-aki\py3112\python.exe scripts/vision-accuracy-fixtures.py
& F:\ComfyUI-aki\py3112\python.exe scripts/validate-vision-accuracy.py --output .runtime/vision-accuracy/my-new-run
```

最后一步会运行本机 Ollama，使用已安装模型，不下载权重；输出目录必须是新的以保留旧证据。测试图只写入隔离目录，不修改个人作品。节点安装与启用步骤见 [LOCAL-VISION.md](../LOCAL-VISION.md)。
