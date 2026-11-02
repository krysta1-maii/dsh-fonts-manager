# 验证记录

目标环境：**DSH 0.2.1-rc.2**；现有 GUI：<http://127.0.0.1:43127>。官方版本锁 commit：`687f282e8625c6b8d11ff58211a90524be2e4317`。

## 1.4.0 移除 agent 工具（2026-11-02）

本版删除宿主侧的 `font_manager` 工具及 `tools`、`settings`、`approval`、`sandboxPolicy` 依赖；`index.js` 退化为空的 Loader 入口，宿主半边不再注册任何工具。字体设置只保留插件详情页的「字体设置与预览」面板，写入路径仍为单次 `form.mutate(ops, revision)`。原 `test/host.test.js` 的工具测试改为校验宿主入口保持无行为；浏览器夹具的组件区不再列出 `font_manager`。

`npm test` 51/51 通过；`npm run build`、`npm run check` 成功；`npm run test:browser` 18/18 通过。浏览器检查仍使用隔离的模拟设置服务和复刻的宿主外框，没有连接实际 DSH，也没有修改用户字体。

本地安装目录尚未更新：`~/.dsh-local-plugins/dsh-fonts-manager/index.js` 仍是 1.3.0 的宿主实现。需要按插件管理流程重新安装或更新宿主文件并重启 DSH 后，`font_manager` 才会从已连接 agent 的工具列表中消失；仅刷新页面只能更新浏览器半边。

以下为 1.4.0 之前的历史记录，其中 `font_manager` 的读写记录对应工具移除前的版本。

## 1.3.0 界面重构（2026-10-26）

本版重做插件详情页「字体设置与预览」区域。分区标题改为与宿主详情页分区一致的 `h4`。用途标签页直接显示当前字体、字号和待应用变化。「恢复继承值」移到标签旁，且只对存在用户覆盖或待应用修改的用途可用。字体浮层按类别分组；代码和终端用途优先列出等宽字体；本机字体改为按字母排序并分批加载，取消了分页；整个选择器支持方向键浏览。预览工具栏改为分段控件。底部应用栏增加状态图标、差异标签和保存中状态，成功提示 5 秒后自动消失。共删去 36 个不再使用的中英文文案键，新增 11 个。纯状态函数和写入路径未改动，写入仍为单次 `form.mutate(ops, revision)`。

浏览器夹具改为使用 DSH 0.2.1 的真实 token 值，包括明暗主题、`--dsw-radius-*`、`--dsw-elevation-*`、焦点环和设置卡片别名。夹具还复刻了插件管理器详情页外框：`.X_2TxG_page` 的内边距与滚动、960px 内容上限、分区间距 32px 和 `h4` 标题。复刻外框后发现一个 1.2.x 已有的问题：Chrome 的 sticky 定位会计入滚动容器的 `padding-bottom`，因此吸底应用栏停在视口底部上方约 48px，下方内容从缝隙中透出。修复方法是在应用栏后放置一个零高度哨兵，用 IntersectionObserver 判断应用栏是否已吸附；吸附时用伪元素遮住宿主的底部留白。窄于 760px 时编辑卡片取消吸顶和层级，避免盖住应用栏。空间不足时字体浮层按宿主滚动区计算最大高度并可向上展开，320px 宽度下也不越出视口。

`npm test` 75/75 通过；`npm run build`、`npm run check` 成功；`npm run test:browser` 18/18 通过。新增或改写的浏览器断言覆盖：详情页外框内的标题层级与宽度；真实 token 下用户气泡与场景的对比；界面文字不小于 11px；用途标签的字号变化提示；浮层分组、键盘导航和焦点返回；成功提示自动消失；恢复按钮的可用条件；本机字体分批加载；对比两侧同步滚动及切换用途后复位；1440×760 下编辑卡片吸顶和应用栏贴住视口底部；英文界面在 1280/960/760/390/320px 宽度下标签、工具栏、应用栏与浮层均无溢出。浅色、深色、浮层、吸附与 390px 窄屏截图已逐一检查。

这些检查使用隔离的模拟设置服务和复刻的宿主外框，没有连接实际 DSH，也没有修改用户字体。本版**未发布到** `~/.dsh-local-plugins/dsh-fonts-manager`，未在已认证的 GUI 中点击验收；实际字体授权弹窗仍需在用户页面中核验。

## 1.2.1 详情页进入滚动修复（2026-10-26）

已安装的 DSH 0.2.1-rc.3 插件管理器在列表与详情之间复用 `.X_2TxG_page` 滚动容器，进入详情时不重置 `scrollTop`。本插件先渲染 120px 的加载占位，配置快照就绪后在同一位置展开约 2000px 的完整内容，浏览器滚动锚定为保持下方内容位置继续向下补偿，最终把页面钳制到最底部。无头 Chrome 复现：占位阶段 `scrollTop` 为 1207，内容展开后为 3087（等于最大滚动值）。

修复在插件页挂载的 `useLayoutEffect` 中查找最近的 `overflow-y: auto/scroll` 宿主滚动容器并置 `scrollTop = 0`，在占位展开前执行。新增浏览器回归模拟“列表滚到底部 → 加载占位 → 完整内容”，断言滚动位置始终为 0。

`npm test` 72/72 通过；`npm run test:browser` 15/15 通过；`npm run check` 通过。仅更新浏览器实现与构建产物，Host、共享配置和依赖声明不变；版本 **1.2.1**。

## 1.2.0 交互与页面重构（2026-10-23）

已将确认的独立原型落实为正式 React 组件：字体浮层、用途联动场景、默认当前/修改后对比、字号加减和逐字输入、高级字体栈、差异摘要、页内 sticky 操作栏。主题使用宿主 tokens，预览沿用 DSH 实际字号比例。没有将原型的模拟“应用”逻辑带入生产；写入仍为原生 `form.mutate(ops, edit.revision)`。

`npm test` 72/72 通过；`npm run build`、`npm run check` 成功。真实 Chrome + React 19.2.0 加载生成后的插件 factory，14 组浏览器回归通过：逐字字号、逗号、选择器浮层/Escape、原子提交、失败保留草稿、冲突确认、继承字段混合编辑、只读、授权列表、路由重挂、保存中重挂（含 reset）、外部字号同步、中英文320–1280px响应式。无浏览器异常，无 HTTP 请求；明暗主题及窄窗口截图已检查。

这些浏览器检查使用隔离的模拟设置服务，未连接实际 DSH，也没有修改用户字体。当前 GUI 根页及管理 API 对新浏览器返回401，因此不把组件截图称为已认证 GUI 的验收。实际字体授权弹窗与原宿主祖先滚动容器仍需用户页面核验。浏览器测试依赖只在开发副本的 `.ui-test`，不是插件运行依赖。

更新前只读快照：revision 0；正文 PingFang SC / 16px，代码 Cascadia Mono / 11px，终端 Cascadia Mono / 13px；用户覆盖有正文家族/字号及代码、终端家族，未覆盖代码/终端字号。实际 Host `/plugins/events` 报告 release `0.2.1-rc.2 / 332895e`，与上方官方 tag 文档锁分开记录。

已发布到固定本地安装目录，版本 **1.2.0**；安装目录的语法检查及 72 项单元测试再次通过。现有 Host graph 的 bundle revision 从 `245e7cf22024` 更新为 `55888215740f`；当前服务返回的 bundle 包含完整新产物，安装副本与开发构建的 SHA-256 均为 `5faa4083c24b990ac5a7f6bd76a3ceaa47be04a8707056e6ef4f6391f0e73946`。更新前后 `font_manager read` 的完整结果相同，revision 仍为 0，字体值及用户覆盖未改变；Host 工具、共享字体规范化和 Cordis patch 文件哈希保持不变。没有重启服务、重新安装插件或更新 DSH 主程序。

原安装文件备份位于开发副本的 `.release-backups/installed-before-1.2.0`；同目录父级保存部署清单、服务端前后 revision、字体配置前后快照。已打开页面可刷新后查看新 UI 和插件卡片版本。服务端 bundle 验证不等同于已认证 GUI 点击验收。`npm pack --dry-run` 本轮因 npm 用户缓存写入权限未完成，未将其计为通过。

以下为历史记录，旧测试数量、revision 和安装结果不代表 1.2.0 的本轮结果。

## 1.1.1 中性分区样式

用途选择、字体编辑、字体库、场景预览与底部应用区采用独立中性底色和边框；编辑区标题、预览工具栏、折叠标题与内容之间增加细分割线，大屏字体/字号之间增加竖线，窄屏改为横线。色块由当前主题正文色与底色混合生成，明暗主题分别呈现灰白或中性深浅层次，不硬编码白底。实际 DSH 示例画布和字体排版保持不变。

63 项测试通过。已从固定本地插件目录安装 1.1.1，application 为 applied，warnings 为空；插件详情配置项 active。更新前后字体配置 revision 均为 8，所有字体覆盖保持不变。未进行真实浏览器截图或视觉验收。

## 1.1.0 DSH 情境预览

已从 `~/.dsh-local-plugins/dsh-fonts-manager` 安装 1.1.0，返回 `application: applied`、`warnings: []`。实时 Client 的插件详情配置项 active，旧 main 与侧栏项均不存在。更新前后配置 revision 均为 8：正文 PingFang SC / 16px、代码 Cascadia Mono / 11px、终端 Cascadia Mono / 13px，用户覆盖原样保留。本轮没有提交任何字体修改。60 项测试通过；只读复核未发现高/中风险问题，未执行真实浏览器截图或视觉验收。

预览扩展为对话与输入、代码与工具、终端面板三类只读示例，并使用完整可用宽度；字体库和字形样本收进可展开区域。默认 100% 为实际字号，150% 放大整个场景。当前设置对比保留真实的三类字体和字号，另选字体时只替换所选用途的字体家族。

排版依据当前安装的 DSH 0.2.1-rc.2，正文大小 T、代码大小 C、正文副级 S=T≤14?T−1:T−2：

| 元素 | 预览字号 / 行高 |
| --- | --- |
| 助手正文、输入草稿 | T / T+10 |
| 用户气泡 | T / T+8 |
| h2 / h3 | T+5 / T+14；T+4 / T+12 |
| 表格 | S / S+9 |
| 工具标题和摘要 | S / T+10，使用正文家族 |
| 代码块 | C / C+8，使用代码家族 |
| 正文行内代码 | 父字号×0.875，行高 C+8，使用代码家族 |
| 工具输出 | C / C+5，每行外盒至少18px |
| 模型栏 / 代码头 | 固定13/20与11/18，家族仍按正文或语言标签的实际角色 |

原生证据为 [ui-theme 排版定义](</home/andyk/.nvm/versions/node/v24.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js#L1425>)、[用户气泡](</home/andyk/.nvm/versions/node/v24.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-chat/lib/client.js#L4272>)、[输入区](</home/andyk/.nvm/versions/node/v24.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js#L18703>)、[Markdown 与共享控件样式](</home/andyk/.nvm/versions/node/v24.22.1/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-BxpfOGf3.css#L1>)，均为本机发布产物。特别核对了 Markdown 的 `.875em!important` 覆盖，以及 xterm 的测量格高，未只按主题 token 名义值推断。

所有预览字体与尺寸通过 `--dfm-pv-*` 子树变量实现；不改写 Host tokens 或全局样式。场景不读取 Session、不调用工具、不发送消息、不创建终端。终端用浏览器自然行框近似，未声称与 xterm 格高、格宽一致；语法展示为中性文字/注释色，不加载完整 Shiki。新增测试覆盖原生比例、字体角色独立、当前设置比较、文本安全以及预览无副作用。

## 1.0.2 插件详情页内嵌（历史）

字体设置和效果预览现通过 `plugins.bundle.config` 渲染在「插件 → 可视化字体管理」详情页的说明下方、组件列表上方。沿用原生详情页标题、图标、导航和滚动，不再注册独立 main 页面或侧栏入口。

当前安装来源为 `~/.dsh-local-plugins/dsh-fonts-manager`，版本 1.0.2；插件管理器返回 `application: applied`、`warnings: []`。实时 Inspect 确认 `plugins.bundle.config` 下的 `@local/dsh-fonts-manager` 为 active，`main` 和 `sidebar.panellist` 中均无本插件旧项。

升级前后字体配置 revision 均为 6，未写入字体设置：正文 PingFang SC / 15px，代码 Cascadia Mono / 11px，终端默认字体 / 13px；原用户覆盖全部保留。50 项自动测试通过，包括专门检查详情页插槽、页面模式筛选、ui-theme 表单来源，以及不重建整页滚动/导航的回归。

## 自动检查

`npm test`：63/63 通过。`npm run build`、`npm run check`、`npm pack --dry-run --json` 均成功，命令退出码均为 0。

| 范围 | 已执行检查 |
| --- | --- |
| 共享字体逻辑 | 中英文字体、引号与控制字符规范化；幂等性；字号上下界；非法输入；只修改六个字体字段 |
| Host 工具 | 只读不审批；修改权限门禁；拒批、取消和异常；两次 revision 检查及原生原子校验；取消和卸载；canonical 输出 |
| 预览纯逻辑 | 草稿不修改原状态；多用途修改与 reset 合并；字体回退；本机字体合并与可用性标记 |
| 分发与界面静态检查 | lazy factory 语法；仅依赖宿主 React；中英文 key 一致；独立 slots；主题颜色和键盘焦点样式；导出资源存在 |

还直接调用了安装版 DSH tools 的 `assertSupportedJsonSchema` 和 `validateJsonSchemaValue` 验证工具输出，JSON render round-trip 通过。图标经 XML 解析验证为 SVG，415 字节，原创图形，无外部资源引用。

## 1.0.1 安装与原生设置回归（历史）

通过 `plugin_manager install_bundle` 安装当前目录，返回 `application: applied`、`warnings: []`。当时 profile 以本地链接使用 `@local/dsh-fonts-manager@1.0.1`。未修改 DSH 安装目录，未启动替代服务器。

Cordis Inspect 确认 `include:dsh-fonts-manager` 存在；Client 的 `main` 与 `sidebar.panellist` 各有一个 `dsh-fonts-manager` 项，均 `active: true`。内置 `settings.general.item` 的 `appearance` 和 `font-size` 项仍为 active，插件不占用这些位置。安装目录解析到本项目，导出的中英文元数据和原创图标均已读取核对。

真实工具执行 `read → apply → reset → read`：测试只为代码用途写入相同的有效值，再移除该测试覆盖。revision 从 0 → 1 → 2；最终字体状态和用户覆盖均与测试前完全一致。正文 15px、代码 11px、终端 13px，三个字体列表为空；用户覆盖仍只有 `fontSize: 15`。测试未更改主题。

## 终审修复

代码审阅发现：选择原字体或把编辑改回原值后，零差异草稿可能仍保留旧 revision，导致后续外部设置更新出现多余冲突。1.0.1 已让零差异编辑回到跟随实时设置的状态，真正有未保存修改的草稿继续保留原 revision；新增四项纯逻辑回归测试。按插件管理器要求移除本插件再重新安装，更新结果为 applied，两个 Client 注册仍各只有一个 active 项。

## 接口证据与局限

实时 Inspect 核验了 `main`、`sidebar.panellist`、`locale`、`theme`、`settings`、`settingsController`、`tools` 和权限契约。`configForms` 未出现在 Inspect 的 Service 目录，查询返回 `no catalogued Service named "configForms"`；随后读取当前安装包的 exports、README、`ConfigForm` 和 `ConfigForms` 声明，以及原生字体的实际调用约定进行补证。终端预览回退栈按安装版 `terminalFontFamily` 实现核对。

用户提供的 1.0.1 插件详情页截图已确认元数据与原创图标显示正常，但截图中尚无字体配置内容。当前没有已连接页面的浏览器控制能力，因此**未运行新版设置区的真实页面点击、截图、明暗主题视觉验收、键盘交互或本机字体授权弹窗测试**。安装成功与 slot active 只证明注册生效，不等同于已检查视觉渲染、图标显示或页面控制台。没有用模拟页面、模拟 React/DOM 或另起浏览器替代这些验收。

## 建议的人工验收

打开「插件 → 可视化字体管理」，在说明下方的「字体设置与预览」区域选择字体或调整字号，确认下方 DSH 场景预览改变而原页面字体暂时不变；切换正文、代码、终端并进行并排对比；点击应用后在原有字体设置页确认同步；未授权及不支持本机字体访问时检查提示；最后在明暗主题和窄窗口中检查布局。

实现与使用说明见 [README](<README.md>)。
