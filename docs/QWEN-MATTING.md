# 0.2.0：人物参考编辑与语义抠图

## 使用流程

1. 启动绘世 ComfyUI，打开 0.2.0 桌面应用并检查连接。
2. 切换“图片参考”，导入人物照片。默认方式为 **Qwen 2.1 · 人物参考编辑**，可使用中文补充修改要求。原照片和生成结果会分别保留。
3. 确认 Q 版设计，点击“自动抠图”或“先自动抠图”。应用用 BiRefNet 生成前景蒙版，保存蒙版及透明 PNG。已有有效透明通道的图片直接保留原透明通道，不再重新分割。
4. 在“透明轮廓、白底检查、前景蒙版、对照原图”之间切换，检查衣袖、发梢、配饰和脚边阴影。蒙版白色表示保留，黑色表示删除；透明 PNG 可以单独导出。
5. 对当前抠图结果满意后，点击“生成 3D”。应用只将前景按透明度合成到白底、居中留白，不再按像素颜色删除浅色衣服。

未抠图的原图不能直接提交 3D，旧版的颜色处理图也不能跳过这一步。需要手动修正时，可导入已经修好的透明 PNG，再点击“自动抠图”保留其透明通道。

## 当前模型配置

现有 `F:\ComfyUI-aki\ComfyUI` 已包含以下配套文件，应用没有下载新模型，也没有修改 ComfyUI 源码或 Python 环境：

| 用途 | 默认文件 |
| --- | --- |
| Qwen 2.1 生成/编辑模型 | `diffusion_models/qwen_image_2.1_int8_convrot.safetensors` |
| 视觉文本编码器 | `text_encoders/qwen3vl_8b_int8_convrot.safetensors` |
| 配套 VAE | `vae/qwen_image_2.1_vae_bf16.safetensors` |
| 语义抠图 | `background_removal/birefnet.safetensors` |

设置中可以选择已有的兼容 BF16/FP8 编码器或 BF16 生成模型。`qwen3.5_9b_qwen_image_2.1_pe_i2i` 是提示词增强模型，不是上述视觉编码器，不能互换。旧版 Qwen 2512 文生图模型、旧版 VAE 也不能作为 2.1 编辑组件使用。

图片模式使用 `TextEncodeQwenImage21`，同时传递视觉参考与 VAE 参考 latent；使用节点输出的空 latent 进行完整参考编辑，默认 25 步、约 768 像素参考面积、CFG 1、Euler/simple。没有把人物编辑伪装成 SDXL 降低重绘强度。文字模式继续使用 SDXL；SDXL 基础重绘仍可在设置中明确选用，不会在 Qwen 缺失时静默回退。

## 抠图处理

BiRefNet 原生 `RemoveBackground` 返回前景为白色的蒙版，通过 `MaskToImage` 保存。应用将其应用到原图 alpha，原始 RGB 像素不改动。没有使用容易反向的 `JoinImageWithAlpha` 掩码约定，也没有根据“白色/浅灰”判断衣服是否属于背景。

尺寸不一致、空蒙版、没有有效透明背景的结果会明确失败，防止错误结果继续进入 3D。低于 8/255 的极弱透明度在合成时归零，以免背景噪声扩大裁剪边界。已有透明通道单独保存，不重复相乘造成边缘变薄。

每个抠图版本关联来源图片和蒙版；3D 输入及模型继续关联对应抠图版本。旧作品、原图、模型与生成记录保留，旧设置自动补齐新配置。

## 验证与边界

真实验证记录位于 `qwen-validation/report.json` 和 `qwen-validation/desktop/report.json`；其中包含实际 ComfyUI 任务编号。照片来自 [ComfyUI 官方模板的公开测试素材](https://raw.githubusercontent.com/Comfy-Org/workflow_templates/main/input/portrait_model_denim.png)，没有扫描或使用用户的私人照片。

对上一版误删白色衣袖的同一张设计图，新的前景蒙版保留了衣袖，合成结果去掉了背景与地面阴影，并验证抠图前后 RGB 像素完全相同。Qwen 测试中发现编辑提示词列举“眼镜”会诱导模型添加配饰，已改为仅保留原图实际存在的配饰，复测样例不再额外添加眼镜。

这些是样例的实际观察，不代表身份相似度的数值评测。半身照片的下半身、不可见的服装和背面仍由模型推测，Qwen 可能改变五官或比例。BiRefNet 也可能在复杂背景、透明衣物或细小配饰上产生误差，因此保留了检查步骤。彩色 3D 纹理、精确分件、骨骼与可打印性不在本次改动中。

官方接口参考：[Qwen-Image 2.1](https://github.com/QwenLM/Qwen-Image-2.1)、[ComfyUI 编辑模板](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_qwen_image_2_1_image_edit.json)、[ComfyUI 原生 BiRefNet](https://huggingface.co/Comfy-Org/BiRefNet)。

## 开发验证

2026-10-15 本机验收结果：21 项自动测试、类型检查和生产构建通过；真实 GPU 完成人像参考编辑、语义抠图和标准 3D 生成；桌面验证通过四种预览、透明 PNG 导出及 GLB/STL/三视图导出。新生成的 188,416 面样例已由 Blender 5.1.1 实际导入，GLB 高度 0.08m、STL 高度 80mm。

0.2.0 免安装程序已分别验证旧版测试作品升级和全新启动。旧作品 3 个文件的 SHA256 保持不变，新配置自动补齐；新安装的内置示例使用 BiRefNet 透明前景和重新生成的 198,532 面模型。对应记录为 `package-upgrade-validation.json`、`package-fresh-validation.json`、`upgrade-preservation.json`，均位于 `qwen-validation/`。

后台桌面截图曾遇到 `UnknownVizError`，首轮失败记录已保留；最终验证在测试模式下关闭后台节流并使用捕获唤醒选项后通过。该设置仅用于自动验证，正式应用的窗口行为不受影响。

```powershell
npm run test
npm run build
node scripts/qwen-live-smoke.mjs
$env:QCHARACTER_SMOKE = 'qwen'
node_modules\electron\dist\electron.exe .
```

验证服务默认位于独立端口 8199，并禁用自定义节点。桌面测试数据保存在项目内 `.runtime/qwen-desktop`，与正式作品分开。`docs/VALIDATION.md` 记录的是 0.1.0 的历史验证，不应作为本次新功能的验证结果。
