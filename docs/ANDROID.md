# Android 版

Android 0.5.0 与 Windows 0.8.0 共用角色工作流、蒙版编辑器、3D 预览、设计图上色和黏土调色逻辑。手机通过原生网络层连接远程 ComfyUI，适用于内网地址、FRP 穿透地址，以及带端口或路径前缀的反向代理。

## 安装与连接

在手机打开 [Windows 0.8.0 / Android 0.5.0 Release](https://github.com/QwenchC/Q-character/releases/tag/v0.8.0)，点击 `Q-Character-Android-0.5.0.apk` 下载后安装；也可使用 [APK 直接下载链接](https://github.com/QwenchC/Q-character/releases/download/v0.8.0/Q-Character-Android-0.5.0.apk)。按系统提示允许当前浏览器安装此来源的应用。Release 中的 `SHA256SUMS.txt` 可用于校验下载文件。

最低 Android 8.0，需要支持 WebGL 2 和 WebMessageListener 的 Android System WebView／Chrome；首次打开即有可离线预览的示例作品。应用不包含生成模型，也不在手机上运行 ComfyUI。

1. 在电脑启动已有 ComfyUI 和穿透服务。
2. 在手机点击右上角“生成服务设置”，填写完整地址，例如 `https://your-host.example:12345` 或 `https://your-host.example/comfy`。HTTP 也支持；选择 HTTPS 可避免明文传输图片与认证。地址不能带账号、密码或查询参数。
3. 按需选择“无需认证”、Bearer Token 或 Basic 账号密码。凭据使用 Android Keystore 加密，仅保存在当前手机；更换地址或认证方式后需重新填写。网页登录、Cookie 登录、Cloudflare Access 与 OAuth 网页流程不在本版认证范围内。
4. 普通 HTTPS 自动使用系统证书验证。对于自签名证书，展开“HTTPS 证书与信任管理”，检查域名、有效期和 SHA256 指纹，再点击“核对并授权证书”。还需要在原生确认框确认一次。授权仅针对当前协议、主机、端口和完整证书；不会全局忽略证书错误。证书变化、过期或域名不匹配均不能沿用授权。
5. 保存设置，点击“连接 ComfyUI”检查模型。服务必须直接返回 ComfyUI API；应用拒绝重定向、登录 HTML 和缺失节点，凭据不会跟随跳转到其他地址。模型名称可在同一设置页调整，默认与 Windows 版一致。

具体穿透域名、访问凭据和授权证书不会写入公开代码或 APK。每台手机单独配置。证书管理中的“撤销”会移除当前地址的例外授权，并使现有连接失效。

## 创作与导出

- 新建作品后使用文字生成设计图，或在“图片参考”中通过系统文件选择器导入照片，使用 Qwen 2.1 编辑。大照片会按 EXIF 方向转正，并缩小到最长边 2048 像素，保留透明度。文字设计使用 SDXL，推荐英文描述。
- 用 BiRefNet 自动抠图，再对照原图、白底和蒙版检查。手动修正支持恢复／擦除、软笔刷、撤销重做、单指涂画、移动工具与双指缩放平移。保存会创建独立蒙版和透明图，保留原始素材。
- 3D 只使用已抠图版本。应用按前景边界裁切、留白并合成白底，避免透明背景 RGB 进入混元 3D。先用“快速草模”检查，也可生成标准精度。
- 在“3D 工作台”单指旋转，双指缩放／平移；可切换正面、侧面、背面和素色泥模。在下方选择透明设计图，按设计图上色或编辑目标色，保存新模型版本。
- “导出 GLB”保存内嵌贴图与材质；在 Blender 使用“文件 → 导入 → glTF 2.0”即可显示。STL 只保留几何。GLB 按米、STL 按毫米导出；目标 80 mm 对应 Blender 高度约 0.08 m。
- 三视图、透明 PNG 和黏土调色指引均可导出。导出时由 Android 系统选择保存位置，可选 Downloads 或文件提供器支持的其他位置，再传到电脑。需要在系统保存窗口完成“保存”。取消文件选择不会覆盖已有作品。

默认 Pixal3D 在远程 ComfyUI 生成几何与 AI PBR 贴图，手机可预览、保留材质换色和导出 GLB；权重只需安装在服务端，见 [Pixal3D](PIXAL3D.md)。混元模型仍使用正面投影与侧背色块延展。黏土配方是试配起点，需要小样和干燥后校色。

多视图支持分别上传、参考正面生成侧背面、逐张修正蒙版，以及三／四视图几何与 AI PBR 贴图。视图槽位和模型输入版本会与 Windows 同步；操作与权重安装见 [多视图说明](MULTIVIEW.md)。

一致性检查支持颜色差异辅助、服装／发型／配饰逐项人工核对，以及触屏涂选局部重绘；重绘后自动抠图并使旧检查过期。两端同步检查记录、遮挡说明、重绘选区和新版本，见 [一致性与重绘](CONSISTENCY-REPAIR.md)。

## 任务、保存与限制

生成在远程电脑执行。手机显示提交、运行和下载阶段，通过历史轮询接收结果；本版没有后台常驻服务，手机锁屏、系统休眠或清理应用后不会保证持续显示进度。已提交的远程任务可能继续运行。

重新打开后，在任务提示或“生成记录”点击“继续接收此任务”，会按原服务地址和原 `prompt_id` 查询，**不会重新提交生成**。切换服务器后必须先恢复原地址。如提交时断线而尚未保存任务编号，应先到 ComfyUI 历史确认执行状态。远端已清理的历史结果无法找回。

取消只删除本应用当前任务的排队项。ComfyUI 0.39.1 及以上还使用 `prompt_id` 定向中断；旧版停止接收，不发全局中断，避免影响其他任务。

单个素材／导出上限 64 MiB，图片处理上限 1600 万像素；大型网格的导出、上色可能消耗较多手机内存，可先降低 3D 精度。作品保存在应用私有目录，更新同签名 APK 会保留；卸载会移除私有作品和设置。请先导出重要模型与图片。Windows 与 Android 各自保留本地作品；0.2.0 已加入电脑提供服务的双向同步，配对、冲突处理和单独穿透设置见 [作品同步](SYNC.md)。

## 构建

使用 Node.js 24、JDK 17 以上和 Android SDK 36。Android 工程使用 Gradle Wrapper 9.3.1／AGP 9.1.1；设置 `JAVA_HOME` 和 `ANDROID_HOME`，或在 Android Studio 打开 `android/`。项目中的 `android/local.properties` 为本机配置，不提交。

```powershell
npm ci
npm test
npm run android:prepare
.\android\gradlew.bat -p android assembleDebug lintDebug
# 或使用统一脚本
powershell -File scripts/build-android.ps1 -Configuration Debug
```

正式 APK 必须签名。在仓库外生成并备份自己的 RSA 签名密钥，别将密钥或密码提交到 Git。配置 `QCHAR_ANDROID_KEYSTORE`、`QCHAR_ANDROID_STORE_PASSWORD`、`QCHAR_ANDROID_KEY_PASSWORD`（别名 `qcharacter`），再运行 `npm run android:build`。本机脚本也支持读取用户目录 `.q-character/android-signing.json` 中的 `keystore` 和 `password` 字段；该私有文件不在仓库内。后续更新必须保留同一密钥。脚本会输出 `release/` 下 APK 与独立 SHA256 校验文件，保持 Windows 版本号不变。

测试脚本 `scripts/android-transport-smoke.mjs` 用于一次性调试模拟器，需将该应用 WebView 调试端口转发到本地 9228，或设置 `ANDROID_CDP_PORT`。它临时修改测试设备的无凭据连接配置，完成后恢复，用本机模拟服务器检查路径前缀、认证、重定向和下载撤销；不应在存有个人作品的手机上作为常规操作运行。

## 0.1.0 历史验证

2026-10-16 在 Android 16（API 36）Pixel 7 模拟器与真实远程 ComfyUI 0.39.1／RTX 5090 上完成 Qwen → BiRefNet → 触屏手动蒙版 → 混元 3D → 设计图上色链路。生成过程中关闭重开应用，按同一任务编号找回结果。完成系统文件选择器 GLB／STL／三视图／调色指引保存和图片导入检查。桌面与手机共享代码共 38 项自动测试通过；Android Lint 无错误（包含系统 API、版本和自定义 TLS 代码的提示性警告）。

手机导出的 GLB 在 Blender 5.1.1 成功导入：1 个网格、UV 存在，2048×1024 颜色贴图内嵌并连接 Base Color，目标高度 80 mm 实测约 0.079999998 m，正反面渲染通过。这里验证的是模拟器运行与真实远端生成，尚未在实体 Android 手机上验收。

正式签名 APK 已完成首次安装与同签名覆盖安装，作品名称和示例素材保留。APK 未设置 debuggable，代码也显式关闭 Release WebView 调试。测试用 userdebug 系统镜像自身仍会开放 DevTools，这是模拟器系统行为，参见 [Chromium 官方说明](https://chromium.googlesource.com/chromium/src.git/+/HEAD/android_webview/docs/net-debugging.md)。

详细证据见 [验证记录](android-validation/report.json)、[手机预览](android-validation/mobile-preview.png) 和 [Blender 正面渲染](android-validation/blender-front.png)。记录已去除实际穿透地址和凭据。

## 0.2.0 同步验证

新版增加 HTTPS 配对、跨端素材和调色方案同步，保留既有 ComfyUI 配置和作品。验证范围及结果见 [作品同步说明](SYNC.md) 和 [同步验证记录](sync-validation/report.json)。
