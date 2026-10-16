# Pixal3D 多视图角色工作流

Windows 0.7.0 / Android 0.4.0 支持正面、左侧、背面、右侧四个独立槽位。建模至少需要正面、背面和一个侧面；也可四张一起输入。使用 Pixal3D 原生多视图条件与专用权重，同时生成几何和 PBR 贴图。

## 安装

先按 [单图说明](PIXAL3D.md)安装视觉编码器及两个 VAE；多视图另需 `models/diffusion_models/pixal3d_multiview_int8_convrot.safetensors`，5,584,555,824 字节（5.20 GiB）。单图权重不能替代多视图权重。

```powershell
node scripts/install-pixal3d-models.mjs F:\ComfyUI-aki\ComfyUI\models --multiview
```

安装脚本复用已有编码器与 VAE，断点续传并核验 SHA256；不同内容的同名文件不会被覆盖。[固定版本和校验清单](../workflows/pixal3d-multiview-models.json)来自 [Comfy-Org 权重](https://huggingface.co/Comfy-Org/Pixal3D)，模型说明见 [Pixal3D 官方仓库](https://github.com/TencentARC/Pixal3D)。本机 ComfyUI 0.39.1 包含 `Pixal3DMultiViewConditioning` 等所需节点，其他环境在应用设置中检查缺失项。Android 只需连接已安装权重的电脑。

## 操作

1. 打开作品，开启“多视图角色设计 → 用于 Pixal3D 多视图建模”。在生成服务设置选择 Pixal3D，检查多视图专用模型就绪。
2. 在正面槽位上传设计图、选择已有图片，或填写角色描述后生成正面。人物照片可先用 Qwen 转为满意的 Q 版正面。
3. 左侧、背面可分别上传，也可点“参考正面生成”。这会用 Qwen 2.1 编辑：正面作为第一参考，其余已抠图的方向作为补充。右侧为可选输入。左侧图鼻尖朝画面左边，右侧相反；背面头部与身体均背对镜头。当前作品描述中的发型、背部衣服与配饰信息也会参与生成。
4. 每个方向点“自动抠图”，再“查看／修正”，恢复衣服、头发和配饰，擦掉背景与脚边阴影。已有透明图保留 alpha。保存手修会创建新版本，并将指向旧抠图的视图槽位改为新版本，原图、蒙版和旧版本保留。
5. 保持同一姿势、平视全身、类似头身比例。确认正面、背面、至少一个侧面都为已抠图版本后，点击“多视图生成 3D”。精度沿用工作区草模／标准／精细选择。
6. 在 3D 工作台旋转检查；保存换色、黏土调色方案和导出 GLB 的方式与单图相同。GLB 内嵌颜色、金属度／粗糙度与法线贴图，Blender 可直接导入；STL 仅保留几何。

应用按各张透明前景边界统一人物高度、居中和脚底位置，再合成同尺度黑底方图供模型读取。这些临时输入单独保存，原设计图和蒙版不会被改写。相机视角默认 20°，可在高级选项调整。

## 跨设备继续编辑

两端都更新至本版，使用原有 [作品同步](SYNC.md) 配对。设计图、蒙版、各方向选择、相机设置、带贴图模型及其输入版本记录会随作品双向同步。手动修正后同步，另一设备即可使用新抠图继续建模。

多视图设置作为一个整体合并；两端离线同时改不同方向也可能形成冲突副本，应用保留两份供选择，不按时间戳静默覆盖。生成中不允许同步。模型保存的是生成当时各图编号，后续替换槽位不会改写旧模型来源。

## 复现与验证

准备透明 PNG `front.png`、`back.png` 与 `left.png` 或 `right.png`：

```powershell
node scripts/pixal3d-multiview-evaluate.mjs <图片目录> standard
```

脚本统一取景、上传并生成 GLB；结果和完整 API 工作流保存在 `.runtime/multiview-evaluation/`。`QCHARACTER_TEST_SERVER` 可指定服务。独立模板 [pixal3d-multiview-pbr-api.json](../workflows/pixal3d-multiview-pbr-api.json)中的文件名为占位符，必须替换为已统一取景的黑底输入；直接使用原始不透明白底图不等价于应用流程。

本机验证记录与图片见 [multiview-validation](multiview-validation/README.md)。这些结果来自一个围裙女孩示例：多视图能提供明确的侧背面约束，不能保证所有照片的身份、细节或视图完全一致。Qwen 生成的侧背面是设计推测，应逐张确认；比例、姿势或配饰冲突仍可能导致重影、结构折中，需要重做视图或在 Blender 修形。不会自动分件或保证可打印。
