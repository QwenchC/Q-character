# 实现结构

## 用户流程

文字或人物图片 → Q 版全身设计图 → 用户选择设计图 → 前景整理 → 混元 3D 几何生成 → 实时预览 → GLB/STL/三视图。

两个生成阶段独立保存，用户能反复修改设计图，不必每次重跑 3D。已有 Q 版图片和已有 3D 模型均有直接导入入口。

## 代码边界

- `src/App.tsx`：角色设计、作品库、任务状态、连接设置与导出入口。
- `src/Viewer.tsx`：Three.js 正交相机、旋转/缩放、原始材质与显示用泥模材质、模型缩放导出、三视图。
- `electron/preload.cjs`：窄接口桥接，不暴露文件系统或任意 IPC。
- `electron/main.mjs`：窗口、文件选择、受限素材协议、单任务生命周期、ComfyUI 结果归档。
- `electron/comfy.mjs`：服务验证、图片上传、队列提交、进度事件、历史轮询和定向取消。
- `electron/workflows.mjs`：SDXL 文生图/基础图生图、Qwen 2.1 参考编辑、BiRefNet 语义抠图与混元 3D 原生工作流构建；按服务端节点和配套模型枚举验证后提交。
- `electron/background.mjs`：正向前景蒙版应用、已有透明度保留、白底合成与居中留白。已移除基于颜色的背景删除算法。
- `src/CutoutPreview.tsx`：透明轮廓、白底、蒙版与原图切换。未经抠图的图片不能直接提交 3D。
- `src/MaskEditor.tsx`：本地蒙版修正对话框、坐标缩放平移、画笔、预览与保存错误恢复。编辑从抠图 alpha 初始化，颜色始终取对应原图；仅更新画笔经过的蒙版区域。
- `src/mask-paint.ts`：独立的连续笔画、软边缘、裁切与有限内存撤销重做，供自动测试直接使用。
- `src/QwenSettings.tsx`：编辑组件和 BiRefNet 配置及就绪状态。
- `src/ColorWorkbench.tsx`：模型上色入口、参考图、主色编辑、基础黏土和调色指引。
- `src/texturing.ts`、`src/texture-image.ts`：透明前景颜色延展、正反面 UV 与内嵌颜色贴图；从原几何创建独立版本。
- `src/color.ts`、`src/clay-sheet.ts`：Lab 主色聚类、近似吸收混色配方与调色 PNG 导出。
- `electron/texture.mjs`：GLB 内嵌图片与 UV 验证、配色与对齐参数校验。模型记录父模型、参考抠图及上色配置，作品记录可选 `clayGuide`。
- `electron/store.mjs`：按作品保存 JSON 与素材；写入串行化、临时文件替换，避免字段自动保存与生成结果互相覆盖。

渲染进程不直接连接 ComfyUI，网络访问集中在主进程；窗口启用 context isolation、sandbox，关闭 Node integration。内容安全策略不允许任意远程脚本或远程图片。文件只通过受路径约束的 `qasset` 协议读取，导入素材先复制到作品目录。

## 扩展顺序

1. 0.2.0 已接入 Qwen 2.1 专用人物参考编辑，通过视觉参考与 VAE 参考 latent 引导。后续可进一步评估多参考图的人物一致性。
2. 0.3.0 已接入本地蒙版画笔修正。主进程验证灰度 PNG 与原图尺寸，从原始 RGB 重建 alpha，保存新蒙版与抠图后一次更新作品 JSON；文件失败时清理本次新文件。版本保留 `sourceAssetId`、`maskAssetId`、`parentCutoutId` 和 `revisionType`，3D 直接使用选中的修正版。
3. 0.4.0 已接入本地设计图贴图、换色和黏土调色指引。AI 多视角纹理仍待单独接入；当前侧背面为参考色延展。导出通过临时文件替换写入，关闭窗口等待正在写入的导出。
4. 增加符合黏土工艺的手工分件标记和截面参考。自动重拓扑、自动结构分件需独立验收，不能从“已有 GLB”推定支持。

不在第一版中实现通用模型编辑器、骨骼动画或 3D 打印修复。
