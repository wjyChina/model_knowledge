# 模型详情页搭建思路与注意事项

这份文档记录当前项目搭建图像生成模型详情页时采用的页面结构、信息边界和实现约定。新的模型详情页应先遵守这些约定，再补充具体 checkpoint 的结构。

## 一、页面只保留四个主章节

详情页按读者真正需要的阅读顺序组织：

1. **网络结构**
2. **推断流程**
3. **训练流程与损失函数**
4. **微调方式**

Tokenizer、文本编码器、VAE 和 scheduler 是完整推断链路中的组件，不单独拆成冗长章节。它们应在“推断流程”中作为输入、编码、latent 初始化、采样更新和解码步骤出现。

U-Net 内部的 ResnetBlock2D、Transformer2DModel、Self-Attention、Cross-Attention、Downsample2D、Upsample2D 等，属于网络结构模块，放在网络结构图的 block 详情弹窗中展开。

## 二、网络结构页怎么画

### 1. 先核对 checkpoint，再画图

不要只根据模型名称或论文示意图猜层数。至少核对：

- unet/config.json 或对应模型配置
- block_out_channels
- down_block_types / up_block_types
- layers_per_block
- transformer_layers_per_block
- cross_attention_dim
- attention_head_dim
- sample_size
- pipe.unet.named_modules() 的真实模块名

论文用于说明设计原理，checkpoint 配置和源码用于确认真实层数、通道、模块顺序和张量形状。两类证据不要混写成同一个“官方数字”。

### 2. 主图使用三列卡片

U-Net 主图固定表达三条主线：

- **Down path**：从高分辨率向低分辨率，保存多尺度 skip feature。
- **Mid**：在最低分辨率进行全局语义混合。
- **Up path**：逐级恢复分辨率，取用同尺度 skip feature。

每个 block 卡片至少显示：

- block 名称和序号
- 完整类名，例如 CrossAttnDownBlock2D
- 是否包含 cross-attention
- 输入形状
- 输出形状
- 是否包含下采样或上采样
- “点击看内部结构”的入口

主干数据流用纵向箭头表达。skip 配对不要依赖复杂折线，而应在主图下方单独列出：

~~~text
down_block_i → up_block_j → torch.cat(dim=1)
~~~

并明确：skip 是特征图搬运，不是逐元素相加；Up block 先保证 H/W 对齐，再沿通道维拼接，之后由 shortcut / ResNet 投影和残差相加。

### 3. 模块弹窗必须画出内部网络

点击 mid_block 后，不能只显示一张表。至少要画出类似下面的顺序：

~~~text
输入 feature
  → ResnetBlock2D
  → Transformer2DModel / Self-Attention
  → Cross-Attention
  → ResnetBlock2D
  → 输出 feature
~~~

Down block 应显示：

~~~text
输入
  → ResnetBlock2D
  → Transformer2DModel（如果有 attention）
  → ResnetBlock2D
  → Transformer2DModel（如果有 attention）
  → Downsample2D（如果配置包含）
  → 输出 / 保存 skip
~~~

Up block 应显示：

~~~text
up_input + skip
  → torch.cat(dim=1)
  → ResnetBlock2D
  → Transformer2DModel / Cross-Attention（如果有）
  → Upsample2D（如果配置包含）
  → 输出 feature
~~~

每个子模块要写清楚它改变什么：

- ResnetBlock2D：卷积、归一化、SiLU、时间条件 scale/shift、残差相加。
- Self-Attention：空间 feature 展平为 token，混合空间位置的信息。
- Cross-Attention：视觉 token 作为 Q，文本条件作为 K/V，输出写回视觉流。
- Downsample2D / Upsample2D：只改变空间 H/W，不负责文本条件注入。
- torch.cat(dim=1)：沿通道维拼接，要求两路 H/W 相同。

### 4. 通用模块必须补“完整结构”（虚线框 + mermaid）

index.html 的前两章是全书的概念底座，分工固定：

- `#vision-anatomy`（01 · 基础知识）：**只讲概念、公式和损失**——输入张量形态、latent、patchify / token（含它的张量流图）、上下采样与压缩率（`#basics-resample`）、扩散与流匹配（DDPM 前向闭式、反向、ε/v/x₀/velocity 四种目标与换算）、噪声调度与 sigma 表（beta schedule、SNR、Karras、shift）、sampler / scheduler / solver（DDIM、Euler、ancestral、Heun、DPM-Solver++、UniPC、FlowMatch Euler 的更新式）、CFG / guidance、条件路径、训练闭环与额外损失项、通用与特色的边界。新写某一章前先确认“这是概念还是结构”。
- `#module-atlas`（02 · 通用模块图鉴）：**只讲结构**，分两部分。
  - **零件（1–11）**：ViT block、AdaLN/AdaLN-Zero、MLP·SwiGLU·GEGLU、归一化家族、ResNet block、Transformer2DModel、位置编码·RoPE、attention 变体·GQA·QK-Norm、条件注入三条路、视觉塔+merger、MoE。
  - **整机（12–18）**：U-Net（`#atlas-unet`）、DiT / MMDiT / 单流主干（`#atlas-dit`、`#atlas-single-stream`）、图像 VAE（`#atlas-image-vae`）、时间因果视频 VAE（`#atlas-video-vae`）、音频 VAE（`#atlas-audio-vae`）、文本编码器 CLIP/T5（`#atlas-text-encoder`）、多模态条件编码器（`#atlas-mm-encoder`），再以「模块 × 模型」总表收尾。
  - `#generic-structure` 是整机部分的导语锚点，保留下来给旧链接兜底。

每个模块都写「解决什么问题 + 完整结构（虚线框 + mermaid）+ 用在哪里」。

**判断一段内容该进哪一章**：它回答的是「这是什么、怎么算、数字多少」→ 01 章（例：上下采样层的 stride 与压缩率、patchify 的形状变化）；回答的是「这个网络/block 内部逐层长什么样」→ 02 章。上下采样与 patchify 原先挂在图鉴里，因为只有一张表和一张数据流图、没有模块内部结构，已按这条搬到 01 章（图鉴 §0 的索引表保留一行指路）。

**index.html 是“书”，只放知识**：写作规范（什么时候必须补图、虚线框代表什么、checkpoint 事实与通用实现怎么分开写）一律写在本文档里，不要写进正文。原先 01 章末尾的「怎么读虚线框」一节和图鉴导语里的「三条边界」callout 已按这条原则删除。

新增内容时的落位规则：**概念、公式、损失**进 01 章；**某个模块/整机的逐层结构**进 02 章；**某个 checkpoint 的具体数字**进对应详情页，并在「论文与 checkpoint 对照」表里给出证据。

有些模块在所有模型里都存在，但 checkpoint 只公开它的压缩率、通道数或“取第 N 层”，不公开逐层结构。典型例子是 MiniMax H3 的“时间因果视频 VAE”（只公开 f16t4d24 与 24 通道 latent）。这类模块不能再写一句“内部未公开”就结束，必须两条都做：

1. 在通用模块图鉴里给出**完整结构**（`index.html#atlas-video-vae` 这类锚点）：逐层写张量形状、写清 checkpoint 事实与通用实现的边界。
2. 在详情页的张量级网络显示里，用**虚线框**画出同一张完整结构（`gn-frame`），框内图形用站内 mermaid 渲染器画。

详情页写法：在 `detail.js` 的模块对象里加 `generic` 字段，由 `gnBlock()` 渲染：

~~~js
generic: {
  title: "时间因果视频 VAE（3D causal VAE）",
  note: "一句话说明官方公开了什么、框内是什么",
  mermaid: ["flowchart TD", '  x["输入<br/>[B,3,T,H,W]"]:::in --> ...'].join("\n"),
  facts: "<b>哪些是 checkpoint 事实、哪些是通用实现</b>……",
  linkHref: "index.html#atlas-video-vae",
  linkText: "通用模块图鉴 17：…… →",
}
~~~

约定：

- 虚线框右上角固定写“虚线框内＝一个完整结构”，框必须包含输入形状、逐层输出形状和最终输出形状，不能只画一半。
- 通用实现与 checkpoint 事实必须分开写；通用结构不能反推成官方数字。
- **有本地 checkpoint 时优先核验，不要留“未公开”**：读 safetensors 头部就能拿到全部张量名与形状（8 字节小端长度 + JSON 头，不需要加载权重），足以确认层数、hidden size、head 数、FFN 类型、各投影形状、VAE 通道与步长。核验出来的数字写进模块与 `sources` 表（见第三部分最后一节的写法），并把“仍是未知”的项目收窄到真正读不出来的部分（例如时间下采样落在哪一级、调制向量的分配方式）。
- **注意区分权重来源**：社区 repack（如 `*_pruned_int8_convrot`、`*_nvfp4`）与官方原始权重可能不同（层数、剪枝、量化），写文档时必须标注是哪一份，不能让读者以为社区剪枝数字就是官方数字。
- mermaid 用站点子集：`flowchart TD|LR`、`A["文本"]:::tone`（tone: in / cond / latent / core / attn / norm / out / op / warn）、`A --> B`、`A -->|标签| B`、`A -.-> B`。节点标签里出现 `[ ]` 时必须用引号包住标签。
- 渲染器是 `mermaid-lite.js`，不依赖外部 CDN；页面里要引入 `<script src="mermaid-lite.js"></script>`，模块弹窗打开时由 `dfBindModules` 调用 `window.MermaidLite.renderAll(modal)`。

同一张图也可以直接放进页面正文：在详情页 HTML 里写插槽即可，定义仍然只有一份（`detail.js` 的 `genericStructures`）：

~~~html
<div class="generated-section page-network" id="network">
  <h2>1. 网络结构</h2>
  <div data-architecture="sdxl"></div>
  <div class="generic-slot" data-generic="unet-tensor"></div>
  <div class="generic-slot" data-generic="image-vae"></div>
</div>
~~~

- `genericStructures` 现有键：`image-vae`、`unet-tensor`（SDXL U-Net 张量级 + skip）、`dit-tensor`（SD3.5 MMDiT 主干）、`dit-block`（单个 JointTransformerBlock 内部）。
- `unet-tensor` / `dit-tensor` 这类“具体结构”也放在同一套虚线框版式里，好处是画法、配色和标签完全一致；`table` 字段可选，用来放 checkpoint 对照表。
- 跳层的虚线边（skip）会自动绕到图的右侧总线并水平插进目标节点；有虚线边时布局会自动预留右侧留白，画图时不用手动调宽度。
- 当前覆盖：H3 的 VisualVAE / AudioVAE / Encoder / Omni-Transformer、Qwen-Image 的 Qwen2.5-VL、SD3 的 CLIP、FLUX 的 T5，以及 SD1.5 / SDXL 的 U-Net、SD3.5 的 MMDiT 主干与 block、四个图像详情页的图像 VAE。

## 三、推断流程怎么写

推断流程应按一次完整生成过程排列：

1. prompt 和可选的源图、mask、控制图
2. Tokenizer 和文本编码器
3. SDXL 的 c_text、pooled embedding、added time/size ids
4. VAE Encode 或纯噪声初始化 z_T
5. 当前状态 z_t 进入 U-Net
6. CFG 的 unconditional / conditional 预测合并
7. scheduler / solver 更新为 z_{t-1}
8. 回到下一轮 U-Net，直到 t = 0
9. VAE Decode 得到 RGB

流程图中每个节点应写输入、运算类型和输出形状。不要只写“编码”“融合”“更新”等模糊词，尽量标明：

- concat(channel) 或 concat(seq)
- residual add
- attention read(K,V)
- scheduler.step
- decode

要区分“编码一次”和“每步读取”：文本通常在循环外编码一次，但每个 denoising step 的 cross-attention 都会重新读取同一份 c_text。

CFG 必须画成预测值的加权组合：

~~~text
eps = eps_u + guidance_scale * (eps_c - eps_u)
~~~

不要把 CFG 写成两个 latent 直接相加。

## 四、训练流程与损失函数

训练页要明确训练和推断不是同一条循环：训练通常随机取一个时间点，只做一次 U-Net forward；完整 scheduler 循环属于推断。

推荐流程：

~~~text
真实图片
  → VAE Encode 得到 clean latent z₀
  → 采样噪声 ε 和时间点 t
  → 构造 z_t = α_t z₀ + σ_t ε
  → U-Net 预测 epsilon 或 v
  → 与 target_t 比较
  → MSE / Huber
  → 反向传播和参数更新
~~~

损失函数中的 target 必须以 checkpoint 的 prediction_type 和 scheduler 配置为准。不能把 epsilon prediction、v-prediction 和 velocity prediction 混为一个固定公式。

训练页至少说明：

- clean latent、噪声和随机时间点从哪里来
- U-Net 使用哪些条件（c_text、pooled、added ids）
- 目标是 epsilon、v 还是其它参数化
- loss 是否包含时间权重 w(t)
- 哪些参数接收梯度
- 训练不包含完整采样循环

## 五、微调方式怎么写

微调章节应同时包含方法、数据、冻结范围、验收方式和微调损失。

### 1. 常见微调位置

默认先考虑 U-Net attention：

- to_q
- to_k
- to_v
- to_out.0

需要更大容量时，再考虑 feed-forward projection。VAE 和文本编码器通常冻结；是否训练 text encoder LoRA 必须说明动机和代价。

### 2. 数据要求

按任务写最低字段，不要只写“准备图片和 caption”：

- **主体 / 风格**：image、精确 caption、宽高、主体标识、split。
- **局部编辑**：source、target、mask、instruction、split。
- **构图 / 控制**：control image、target、caption、布局或控制标注。

数据应按主体、拍摄批次或来源切分，避免近重复图片同时进入训练集和验证集。需要记录模型 revision、分辨率桶、caption 模板、seed、LoRA rank / alpha、训练和验证 loss。

示例可以使用 JSONL，但必须让字段和任务对应：

~~~jsonl
{"image":"train/subject_001.jpg","caption":"sks person, side profile, studio light","width":1024,"height":1024,"subject":"person_a","split":"train"}
{"source":"edit/in_004.png","target":"edit/out_004.png","mask":"edit/mask_004.png","instruction":"把杯子改成红色，保留手和桌面","split":"validation"}
~~~

### 3. 微调损失

微调通常沿用基座的 epsilon / v 训练目标，只把可训练权重替换成带 LoRA 增量的权重：

~~~text
L_lora = E[ w(t) · || f_(W + ΔW_lora)(z_t, t, c) - target_t ||² ]
~~~

必须说明：

- target_t 由基座 prediction_type 决定。
- LoRA 的 A/B 参数接收梯度。
- 未选中的 U-Net 权重、VAE 和文本编码器默认冻结。
- 微调 loss 下降不代表能力没有退化，验收还要看主体一致性、提示遵循、文字、未见角度 / 分辨率和基座能力保持。

## 六、响应式布局与交互注意事项

- 主图不能使用会把整页撑宽的固定 SVG 作为唯一阅读方式。
- 桌面端使用三列；窄窗口自动变为单列卡片。
- 模块详情弹窗应限制最大高度，并允许纵向滚动。
- 长文本、类名、张量形状和公式要允许换行，不能遮挡相邻文字。
- 表格只在确实需要对比字段时使用；复杂网络优先使用流程节点。
- 交互模块使用真实 button，支持鼠标、键盘 Enter 和 Space。
- 弹窗必须提供明确关闭按钮，也支持点击背景关闭。
- 不要让页面出现全局横向滚动；局部需要查看长表格时才允许局部滚动。
- **不要用 `html,body{overflow-x:hidden}` 收横向溢出**：它会把 html/body 变成滚动容器，导致主页左侧目录和详情页顶栏的 `position:sticky` 直接失效。本仓库统一用 `overflow-x:clip`（`detail.css` 里带 `@supports` 回退），既裁掉横向溢出又不创建滚动容器。
- 主页左侧目录是独立滚动区（`#toc`）：`app.js` 的 `keepTocVisible()` 在激活章节变化时把该项滚到目录可视区中间，所以拖动页面滚动条时导航会跟着上下滑动；用户自己在目录里滚动时自动跟随暂停 1.6 秒，避免互相抢滚动。
- 深色模式要同步检查卡片、流程图、代码块和弹窗的对比度。

## 七、提交前验证清单

- [ ] 页面是否只剩四个主章节，旧的冗余长章节是否删除。
- [ ] 网络图是否能看出 Down / Mid / Up 和 skip 配对。
- [ ] 点击 mid_block 是否能看到 ResnetBlock2D、Self-Attention、Cross-Attention、ResnetBlock2D。
- [ ] Down / Up block 是否按配置显示 attention 和采样层。
- [ ] 推断流程是否区分循环外编码、每步读取和 scheduler 更新。
- [ ] 训练损失的 target 是否与 checkpoint 配置一致。
- [ ] 微调章节是否有数据字段、JSONL 示例、冻结范围和微调损失。
- [ ] 桌面、窄窗口、深色模式是否无文字遮挡。
- [ ] 通用模块（VAE / 音频 VAE / 条件编码器 / 文本编码器 / 单流主干）是否在详情页有虚线框完整结构，并在通用知识里有对应的张量级说明。
- [ ] 虚线框内是否写全了输入形状、逐层输出形状和最终输出形状。
- [ ] 公式是否已渲染成真正的上下标（正文与弹窗都没有裸露的 `X_y`），`$...$` 公式在 JS 字符串里是否用了双反斜杠。
- [ ] 深色模式下公式、虚线框和 mermaid 图是否都清晰可读。
- [ ] 主页滚动到任意章节时，左侧目录是否保持可见并自动跟随（active 项滚进可视区），目录本身是否可上下滑动。
- [ ] `node --check detail.js`、`node --check mathlite.js` 是否通过，浏览器控制台是否无错误。
- [ ] 页面是否没有全局横向溢出。

## 八、checkpoint 核验流程（层数与形状从哪来）

详情页里凡是“层数 / hidden size / head 数 / VAE 通道”这类能读出来的事实，都不要停在上游文档的“未公开”上。做法是只读 safetensors 头部：

~~~python
import json, struct
with open(path, "rb") as f:
    n = struct.unpack("<Q", f.read(8))[0]      # 前 8 字节：头部 JSON 长度（小端）
    hdr = json.loads(f.read(n).decode("utf-8"))  # {张量名: {dtype, shape, data_offsets}}
    # 权重数据从 8 + n 开始，核验形状不需要读它
~~~

核验时按顺序看这几件事：

1. `blocks.N.` / `model.layers.N.` 的最大下标 → 层数。
2. 融合投影的形状 → head 数：`qkv_proj` 输出维 ÷ 3 = 每头拼接后的宽度，再除以 `q_norm`（或 `head_dim`）得到 head 数。
3. `mlp.fc1 / fc2` 的形状 → 是普通 MLP（×4）还是门控（fc1 输出 = 2 × fc2 输入）。`fc1 = 28672 = 2 × 14336`、`fc2` 输入 14336 → SwiGLU，intermediate 14336。
4. `k_proj / v_proj` 是否小于 `q_proj` → GQA；`q_norm / k_norm` 是否存在 → QK-Norm。
5. VAE：`encoder.down.N` 的级数与 `downsample` 出现次数 → 下采样次数；步长卷积的 kernel（DAC 约定 `kernel = 2 × stride`）→ 总压缩倍数；`conv_out` 的通道数是否为 latent 通道的 2 倍（μ 与 logσ²）；`latents_mean / latents_std` 的长度 = latent 通道数。
6. `proj_out` 的输出维 ÷ 3（RGB 通道）→ 每个 latent 位置展开的像素块大小，用来确认 VAE 的时空压缩率是否自洽。

写进页面的方式：数字进模块与卡片，来源进 `sources` 表，新增一行“本次核验：……”并写清是哪个文件、哪个张量、什么形状。**同时必须标注权重来源**：社区 repack（剪枝 / int8 / nvfp4）与官方原始权重可能不同，例如 H3 的 ComfyUI 剪枝版按形状统计约 20.1B，而官方公告是 33B；这类差异要写出来，不能让读者把剪枝数字当成官方数字。

注意：`sources.evidence`、`conditionsNote`、`unknown` 三个字段用 `rich()` 渲染，可以写 `<code>` / `<b>` / `<strong>` / `<br />`（会先转义再放行这几个标签）；`item` 与其它叙述字段仍是纯文本。

## 九、公式与数学排版（上下标 / $...$ LaTeX 子集）

全站公式由 `mathlite.js` 统一排版：主页章节、详情页正文、模块弹窗和 mermaid 网络图都用同一套规则，页面上不再出现裸露的 `N_img`、`z_t` 这种写法。

### 1. 自动上下标：照数学习惯直接写 `X_y`

| 写法 | 渲染结果 |
| --- | --- |
| `N_img`、`z_t`、`c_text`、`d_model`、`N_total` | 真正的下标 |
| `z_{t-1}`、`x_{<t}`、`f_(W + ΔW_lora)` | 花括号 / 括号里的内容整体作为下标 |
| `W_u^T`、`R^(B×3×H×W)`、`‖·‖^2` | 上标 |
| `ᾱ_t`、`σ_t`、`λ_rec`、`ε_u` | 希腊字母基号同样支持 |

- 只有“数学符号”会被转换：单字母基号、希腊字母基号，以及 `eps / vel / pi` 与 `target_t` 这类白名单词。
- 真实代码标识符保持原样：`named_modules`、`target_modules`、`conv_in`、`layers_per_block`、`to_q`、`q_proj`、`x_embedder`、`v_prediction`、`NS_W`、`target_video`、`shot_022` 都不会被改写。白名单在 `mathlite.js` 的 `BASE_STRICT / BASE_SOFT / SHORT_SUBS / SUB_BLACKLIST`，新增变量名时改这里。
- 基准可以是**多字母数学变量名**：`BASE_STRICT`（`eps` / `vel` / `pi`，总是转换）与 `BASE_SOFT`（`target` / `noise` / `shift` / `scale` / `gate` 等，只有下标命中 `SHORT_SUBS` 才转换）。正则里多字母词必须排在单字母前面，否则 `eps_c` 会被拆成 `e + ps_c`。于是 `eps_cond`、`shift_msa`、`target_t` 会渲染成下标，而 `gate_proj`、`target_modules`、`latent_channels` 保持原样。
- 两个书写坑：乘积要留空格（写 `x W_u^T`，不要写 `xW_u^T`，否则前一个字母会挡住基号）；下标很长时用花括号（`L_{reconstruction}`）。

### 2. 复杂公式：用 `$...$` 写 LaTeX 子集

~~~html
<code>$L_{\text{lora}} = \mathbb{E}\left[\, w(t)\,\| f_{W+\Delta W_{\text{lora}}}(z_t,t,c) - \text{target}_t \|^2 \right]$</code>
~~~

支持 `_ ^ { }`、`\frac \dfrac`、`\sqrt[n]{}`、`\bar \hat \tilde \vec`、希腊字母、`\cdot \times \odot \| \le \ge \in \to \sim \approx` 等算子、`\mathbb \mathrm \text \operatorname`、`\left \right`、`\,` `\;` `\!` 间距，以及 `\log \exp \max \min \mathrm{softmax}`。

三个必须注意的地方：

1. 在 **HTML** 文件里直接写单个反斜杠（`\sqrt`）。
2. 在 **detail.js 的 JS 字符串**里必须写成双反斜杠（`"\\sqrt"`），否则 `\m`、`\e`、`\t` 会被 JavaScript 当转义序列吃掉，页面上就会显示成 `mathbb{E}`、`epsilon` 这种半成品。
3. 公式里的 `<` 要写成 `&lt;`（例如 `x_{&lt;t}`），渲染时会被还原。

站点没有引入任何外部 CDN，离线打开也能排版。

### 3. 检查方法

- 页面上公式应显示真正的上下标与分式，源码里不该再有裸露的 `N_x` 出现在正文中。
- `node --check detail.js`、`node --check mathlite.js` 必须通过。
- 两处都要看：详情页模块弹窗在打开时调用 `MathLite.renderIn(modal)`；页面级内容在 `DOMContentLoaded` 与 `load` 各渲染一次（幂等，重复执行安全）。
- 深色模式要单独确认：公式不能出现“浅底 + 浅字”。

## 十、当前实现对应文件

- image-sdxl.html：详情页的最小页面骨架和四个章节入口。
- detail.js：网络结构数据、推断 / 训练 / 微调渲染器、模块详情弹窗。
- detail.css：网络卡片、skip 配对、条件路径、模块流程图和响应式布局。
- image-models.html：图像模型总览和详情页入口。

