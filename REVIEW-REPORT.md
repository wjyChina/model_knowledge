# 《生成模型工程手册》只读审阅报告

审阅范围：`index.html`（23 章，6949 行）、`app.js`（章节顺序与术语表）、`detail.js`、5 个详情页、5 个总览页、`MODEL_DETAIL_GUIDE.md`、`H3-CHECKPOINT-NOTES.md`、`examples/`。
本次为**只读审阅**，未修改任何既有文件；本报告为唯一新增文件。

阅读顺序以 `app.js` 的 `chapterOrder`（app.js:3-27）为准：
`start → llm-anatomy → training-objectives → checkpoint-inspector → vision-anatomy(01) → module-atlas(02) → image-principles(03) → video-anatomy(04) → video-principles(05) → finetune(06) → lora-injection(07) → distill(08) → labs(09) → image-models(10) → video-models(11) → workflows(12) → memory(部01) → quant(部02) → serve(部03) → parallel(部04) → distributed-train(部05) → parallel-lab → sources`

行号未特别说明时均指 `index.html`；其它文件均带文件名。

---

## 总体判断

这本书的**内容质量远高于常见的教程汇编**：基础知识章（01）的公式、数字与边界条件写得可核对，模块图鉴（02）把零件与整机分层，部署/并行部分有真实的量化公式、KV cache 估算式和通信原语对照。它现在最大的问题不是"讲错"，而是**三处结构性错位**：① **LoRA 在第 3 章就被当作已知概念大量使用**（1821、1882-1883），而它的 A/B、rank、alpha 到第 10–11 章才定义——这是全书最靠前的"未讲先用"；② **`labs`（09·四个验证实验）排在 13 位**，但它依赖量化、并行、工作流三章，而这三章分别排在第 18、20、16 位，读者按顺序读到实验时根本做不了；③ **前三章的 `labs`、`#module-atlas`、以及 H3 的 checkpoint 数字**都出现了"同一件事两个口径"，其中 H3 的 VideoVAE 层数与"第 50 层"是**同一文件内相隔十几行直接互相否定**（3772 vs 3793；4674-4679 vs 4824、4829）。

此外，前两章"概念 / 结构"的分工已经出现互相渗透（概念章里有整张 U-Net 结构图，图鉴章里重新讲 patchify 的定义），且全书几乎没有章节间指路——一处概念在四五处重复讲，却没有一句"见 01 §5"。修好上述 20 条后，这本书的结构就没有硬伤了。

---

## 一、知识递进与顺序问题

### 1.1【最严重】LoRA 在第 3 章就被当作已知概念使用，定义却在第 10–11 章

- **证据**：`#training-objectives`（阅读顺序第 3）的 h3「从 logits 到 LoRA 梯度」（1821）直接写「才能更新早先位置的 **LoRA A/B**」（1826）、「LoRA 只保存 A/B 的梯度和优化器状态」（1827），并在 1882-1883 写「LoRA 挂在 cross-attention 的 K/V 会改变条件读取」。
- LoRA 的矩阵形状与公式直到 `#finetune`（第 10）6299-6302「$\Delta W = \frac{\alpha}{r}BA$……$A \in \mathbb{R}^{r\times k}$」和 `#lora-injection`（第 11）5430-5433 才给出。
- **建议**：在 1821 节标题下加一段 3–4 句的 LoRA 最小定义（冻结 W、旁路两个小矩阵 A/B、rank r 与 α/r 缩放、只对 A/B 求梯度），并写"完整挂载点见 07 · LoRA 的真实挂载点"。这样既不动章节编号，也把"未讲先用"补掉。

### 1.2 `labs`（09 · 四个验证实验）位置错：依赖的量化 / 并行 / 工作流都在它后面

- **证据**：`#labs`（6641，data-title「09 · 四个验证实验」，阅读顺序第 13）实验 A 要求「选一个有 BF16、8-bit 和 4-bit 同基座修订的模型」（6653）；实验 B 要求「测 1 卡、2 副本、TP=2」（6661）；实验 C 要求做分镜与图生图/局部编辑（6667）。而 `#quant` 在第 18 位、`#parallel` 在第 20 位、`#workflows` 在第 16 位（app.js:16-24）。
- **建议**：把 `#labs` 从"`#distill` 之后"移到 `#parallel-lab` 之后、`#sources` 之前，并把 `data-title` 从「09 · 四个验证实验」改为「实验 · 四个验证实验」——这样与 `#checkpoint-inspector`（「实验 · Checkpoint 结构检查」）、`#parallel-lab`（「实验 · 多卡通信与拓扑验收」）的命名约定一致，且**不破坏 01–12 的编号体系**。若不想移动，退一步在 6647「四个必须亲手做的实验」标题下加一句"本章实验请在第 17–22 章之后做"。

### 1.3 `#module-atlas` §13 使用 all-to-all，但该原语只在最后一章解释

- **证据**：4106-4107「token 的路由会带来 **all-to-all 通信**，这也是它最难调的部分」（阅读顺序第 6）；all-to-all 的解释在 `#parallel-lab` 982-990「Router 把 token 发给拥有目标 expert 的卡」（第 22 位）。
- **建议**：在 4107 那句后面加一个括号定义（"all-to-all：每张卡向其它所有卡各发一份不同数据，MoE 用它把 token 派发到专家所在卡"），或把 982-990 那张 All-to-All 卡片复制一份到 §13 的 `gn-note` 里。

### 1.4 `#checkpoint-inspector` 声明的前置条件里，RMSNorm 到第 6 位才定义

- **证据**：115-117「**前置条件：**读者已经学完 Token、Embedding、Attention、RoPE、RMSNorm、MLP、SwiGLU 和完整 Transformer Block」（第 4 位）。`#llm-anatomy` 的图注只写「RMSNorm / 无均值/方差参数或按模型配置」（1141），不是定义；RMSNorm 的正式定义在 `#module-atlas` §4（3622-3649 的 mermaid 与 3670-3674 的表）。
- **建议**：在 `#llm-anatomy` ① 的 `arch-grid` 里补一张 `RMSNorm` 卡片（2 句：只除 √mean(x²)、不减均值），或把 3670-3674 的表行前移。RoPE 在 1206-1207 已有一句可用定义，不必动。

### 1.5 前两章的"概念 / 结构"分工已被破坏（双向渗透）

- **结构跑进基础知识章（01）**：3151-3223 是整张「SDXL 类潜扩散的组件级结构」图（U-Net down→mid→up、ResNet block、Spatial self-attn、Cross-attn、skip connection、VAE Decode），与 3224 的 `<h4>11. 什么时候必须在详情页补一张结构图</h4>`（一张"详情页该画什么图"的规范表）都应属图鉴或详情页，而不是"只讲概念、公式和损失"的 01 章——这与它自己在 1930-1933 的承诺「每个模块的**逐层结构**放在下一章」冲突。
- **概念跑进图鉴章（02）**：§8 开头 3836-3839 重新解释「patchify 是**纯形状变换**……它们本身没有"生成能力"」，而 patchify 的概念在 01 §2（2262-2272）已经定义过；§2 3535-3540 讲的是"DiT 为什么需要 AdaLN"的动机（概念），§0（3311-3353）整节是分类学而非结构。
- **建议**：把 3151-3223 的组件级结构图移到 `#module-atlas` 15（DiT/MMDiT）之后或直接只留在 `image-sdxl.html`；把 3224 的补图规范移到 `#sources`（"资料与核验"）。把 3836-3839 压成一句指路"patchify 的形状变换已在 01 §2 定义，这里只给实现细节"；§2 的动机段保留但压缩到 2 句。

---

## 二、必要知识缺失

### 2.1 VAE 的 scaling factor：给了数字却从没讲"为什么"，而且解码路径缺反缩放

- **缺什么**：为什么 latent 要乘一个 ≈0.13 的常数、解码前要不要除回去。
- **现在只在哪里出现**：`scaling_factor=0.13025` 出现在 4489 与 4513（mermaid 节点「z = μ + σ ⊙ ε，再乘 scaling_factor」）、4575 表格「再乘该 checkpoint 的 scaling_factor」、4613-4615 表格行「scaling factor / 采样后逐元素相乘」；`image-models.html` 140-148 有一行「Latent scaling / 按模型特定常数缩放 / 送入 scheduler/主干的 z'」和「Decode / clean z' / **反缩放**…」。全部只有操作，没有一句解释。
- **附带的技术问题**：4513-4515 的 mermaid 把乘过 scaling_factor 的 `sample` 直接连到 `dec`，没有"÷ scaling_factor"这一步；真实 Diffusers 流程是 `latents / vae.config.scaling_factor` 才 `vae.decode`。
- **建议**：在 `#atlas-image-vae`（16）4571-4576 那张表的"采样"行后加 3–4 句：scaling factor 的作用是把 VAE latent 的标准差归一到 ≈1，使加噪公式（假定 x₀ ~ N(0,1)）与噪声调度匹配；解码前必须除以同一常数。并在 4513-4515 的 mermaid 里插一个「÷ scaling_factor」节点。（约 1–2 小时）

### 2.2 序列并行 / 上下文并行（SP / CP）：总览页明确承诺了，但全书没有一节讲

- **缺什么**：SP/CP 切的是什么、和 TP 的区别、通信发生在哪。
- **现在只在哪里出现**：`parallel.html` 第 4 行 lead 写「本页用同一套记号说明 DP、TP、PP、EP、**SP/CP**、FSDP/ZeRO……」——但该页 7 节（第 5 行 nav：`#data`、`#tensor`、`#pipeline`、`#expert`、`#shard`、`#serve-sched`、`#decision`）**没有任何一节涉及 SP/CP**。`index.html` 里只有 829 行一个表格单元格「SP / CP / 序列或上下文维切分 / attention/KV 通信」，`app.js` 的 `distributed-train` 术语表（app.js:296-327）也没有 SP/CP 条目。
- **建议**：在 `parallel.html` 第 5 节（`#shard`）之后新增第 6 节 `#sequence`「序列/上下文并行」，3–5 段 + 一张 IO 表 + 与 TP 的对比（TP 切 head/矩阵，SP 切序列维、需要对 attention 做 all-gather/reduce-scatter，CP 是 SP 在长上下文上的形式）。若暂时不写，至少把第 4 行 lead 里的"SP/CP"删掉，避免承诺落空。（2–3 小时；只删承诺 5 分钟）

### 2.3 四个"只在表格里出现过一次"的名词：DoRA、GRPO、RLOO、RAG

- **证据**：
  - `DoRA` 全书仅 1 次：6270 表格单元格「LoRA / DoRA / 线性层低秩增量；基座冻结」——而 DoRA 并不是"低秩增量"，它是把 ΔW 拆成幅度与方向。
  - `GRPO` 仅 1 次：1537 表格单元格「rollout + reward + PPO/RLOO/GRPO 类在线 RL」。
  - `RLOO` 在 `app.js:439` 的 RLHF 条目里出现一次，正文里除 1537 外无解释。
  - `RAG` 出现 5 次（1502、1727、6251「知识更新优先考虑检索增强」、6265「Prompt / RAG」、6673「基座 + RAG」），缩写从未展开，机制从未说明。
- **建议**：在 6270 该行后加 1 句 DoRA（幅度 + 方向分解，方向用低秩更新）；在 1537 单元格后加 1 句区分 PPO/RLOO/GRPO（是否需要 critic、advantage 怎么估）；在 6265 表格前加 1–2 句 RAG（检索文档 → 拼进上下文 → 不更新权重，与 LoRA 互补）。（共约 30 分钟）

### 2.4 为什么需要两个 / 三个文本编码器，全书只写"用了哪几个"，没写"为什么要"

- **证据**：3163-3175 的 SDXL 结构图只标注「CLIP-L / per-token embedding」→「OpenCLIP bigG / 第二文本 embedding」→「pooled text」；`#atlas-text-encoder`（19）4965-4971 只说明 CLIP 给"序列 + pooled"、T5 给"序列"，4974-4979 的结论是"两条链路的差别只在三处"。`detail.js:2053` 说明 SD3.5「CLIP-L（768）、CLIP-G（1280）与 T5-XXL（4096）分别编码」以及各自输出怎么拼，但同样没有解释动机。
- **建议**：在 `#atlas-text-encoder`（19）4980 的 `gn-note` 后加 3–4 句：CLIP-L 容量小、对长 prompt 与组合语义弱，所以 SDXL 再加一个更大的 OpenCLIP-G 取更强语义；SD3/FLUX 再引入 T5 是因为它能处理最长 512 token 的完整句子（CLIP 侧只有 77 token），文字渲染与长描述依赖它；pooled 向量只提供"全局风格"，序列条件才提供"内容"。（约 40 分钟）

---

## 三、冗余与重复

### 3.1 同一个"token 数随分辨率变化"的算例讲了两遍，数字完全一致

- **证据**：01 §2 的 `tensor-example`（2297-2305）「若 H'=128,W'=128,p=2，则 N=64×64=4096……2048……N=128×128=16384，正好约 4 倍」；`#image-principles`（03）的「手算一次空间 token」（5679-5687）「1024×1024 → 128×128 潜图 → 64×64 = 4096 个图像 token；2048×2048 → …16384 token」。
- **建议**：保留 01 §2（首次出现、带 `N=(H'/p)(W'/p)` 公式推导），把 5679-5687 的第二个算例改成一句「token 数的算法与算例见 01 §2；这里只强调宽高各翻倍时注意力矩阵约 16 倍」。

### 3.2 LoRA 的公式与"压缩比"在四处重复

- **证据**：`#lora-injection` 5430-5433（`$\Delta W = \frac{\alpha}{r}BA$`、`params = r(in + out)`）；`#finetune` 6299-6302（同一公式 + 可训练量从 `dk` 降到 `r(d+k)`）；`image-models.html` 448-452（`ΔW=(alpha/r)BA`）；`detail.js` 各模型页（如 2729）再列一次挂载点。
- **建议**：保留 `#lora-injection`（章节主题就是 LoRA）作为唯一完整定义处；把 `#finetune` 的整个 h3「LoRA 到 QLoRA 的机制」（6297-6308）删掉或压成两句并指向 07；`image-models.html` 448-452 改为一句指路。

### 3.3 视频"难在哪 / 指标"在 04 与 05 两章重复

- **证据**：`#video-anatomy`（04）的 5257-5330「为什么视频比图像难很多」+ 5284-5325 的五件套表 + 5315-5317 的"评价"行；`#video-principles`（05）的 5952-5983「时空 token 与条件」（同一条"token 数随 H×W×T 增长、时间位置编码、首帧条件、长片靠分镜"链）+ 6000-6003「视频制作的指标」（与 5315-5317 同一组指标）。
- **建议**：保留 04 的机制表与指标行（04 是"通用时空结构"的首次讲解），把 05 的 5967-5983 压成 2–3 句摘要 + 指路 04，把 6000-6003 合并进 04 的指标行。05 只保留它独有的内容：「扩散/流生成 vs 自回归/混合方法」的对照（5984-5998）。

### 3.4 并行实验协议、DDP 命令与总览页内容三处重复（并伴有一处参数不一致）

- **证据**：
  - `#labs` 实验 B（6658-6663）「在同一机器测 1 卡、2 副本、TP=2……记录 P50/P95 延迟及总吞吐」与 `#parallel-lab`「把加速变成可比较的实验」（1037-1054）「先跑单卡基线……依次测试 DDP、TP、FSDP/ZeRO」是同一份实验协议。
  - `parallel.html` 第 6 段与 `index.html` 858-861 是**逐字相同**的 `torchrun --standalone --nproc_per_node=2 train.py --per_device_train_batch_size 1 --gradient_accumulation_steps 8`；`parallel.html` 第 14 段的「最小实验顺序：1 卡基线 → 2 卡 DDP → 2 卡 TP → FSDP/ZeRO」又与 `index.html` 1043-1044 重复。
  - **数字不一致**：同一个"vLLM 单机两卡 TP"示例，`index.html:732` 是 `--max-model-len 4096`，`parallel.html` 第 9 段是 `--max-model-len 8192`。
  - `image-models.html` 的 §1 数据流（41-104）、§4 U-Net/DiT/MMDiT（213-307）、§5 训练目标/采样器/CFG（309-351）、§8 微调（445-496）与 `index.html` 的 01 §6-§9、02 §14-§15、`#finetune` 大面积同义。
- **建议**：实验协议保留 `#parallel-lab`（更完整、有验收标准），`#labs` 实验 B 只留一句"协议见 实验 · 多卡通信与拓扑验收"；DDP 命令与"最小实验顺序"保留 `parallel.html`，`index.html` 改为指路；两处 `max-model-len` 统一（建议 4096，与"单卡 BF16 示例"一致）；`image-models.html` 定位改为"公共接口速查表 + 模型入口"，§4/§5 压成表格 + 指向 01/02 的链接。

---

## 四、前后不一致与失效锚点

### 4.1 失效锚点：`image-qwen.html#edit` 指向不存在的 id

- **证据**：`image-models.html:385` 写 `<a href="image-qwen.html#edit">Qwen-Image Edit</a>`；`app.js:72` 的自动链接表也有 `["Qwen-Image / Edit", "image-qwen.html#edit"]`（会写进 `#image-models` 表格第一列的链接）。而 `image-qwen.html` 的静态 id 只有 `id="network"`，`detail.js` 只为"微调"小节生成 `finetune`（detail.js:4055-4059），其余小节生成 `detail-section-N`（detail.js:4067）——**没有任何地方生成 `edit`**。
- 其余跨页锚点全部有效（已复核 `#network`、`#finetune`、`image-models.html#vae/#sampling/...`、`image-modules.html#i2i/#ip/...`、`video-models.html#t2v/#i2v/#edit/...`、`parallel.html#shard/#serve-sched/...`，以及 `detail.js` 里 11 处 `linkHref: "index.html#atlas-*"`）。
- **建议**：在 `detail.js` 里给 Qwen-Image 的 Edit 小节加 `id="edit"`（与该页其它小节一致的写法），或把 `image-models.html:385` 与 `app.js:72` 改成 `image-qwen.html#network`。（10 分钟）

### 4.2 H3 VideoVAE 的层数：同一章内相隔约 150 行互相否定

- **证据**：`#atlas-video-vae`（17）的 `gn-note`（4673-4683）写「H3-VisualVAE 的真实结构……编码器是 **6 级** 3D 因果卷积……**解码器不是卷积，而是 36 层 ViT**（宽 2048、门控 FF 8192、4 个 register token），`proj_out` 输出 3072」；同一节末尾的边界表（4822-4829）却写「官方另提"编码器训练后另有 ViT 解码器"，**层数未公开**」和「层数 / kernel / 归一化 / 注意力位置……**未公开**，必须读 VAE config 与源码」。
- 前文 4122-4126 也仍写「发行方只公开它的压缩率、通道数和名字，不公开逐层结构」。
- **数据来源**：`H3-CHECKPOINT-NOTES.md:37-48` 明确记录 6 级编码器、36 层 ViT 解码器、`proj_out` 3072；`detail.js:3812-3839` 已按 checkpoint 核验值更新。
- **建议**：把 4824 改为「官方未出逐层结构；本节 4673-4683 的数字来自社区 repack 的 safetensors 头部核验」，4829 改为「官方未公开；checkpoint 核验值见上，其它版本仍须读 VAE config」，并把 4122-4126 的"最典型的例子是 MiniMax H3"换成官方确实无核验数据的模块（否则与 4673 冲突）。

### 4.3 H3 的两个关键口径在同项目内自相矛盾（"第 50 层"与"13B AdaLN"）

- **"第 50 层"**：`detail.js:3772` 写「官方说的"第 50 层"就是这个 50 层堆叠的**最后一层输出（index 49）**，不是"最后一层之后再过 final norm"」，`index.html:5003-5004` 与之一致；但同一文件 `detail.js:3793` 又写「② 取的是**第 50 层而不是最后一层**，这是官方实现细节」。两句互斥。
- **"13B AdaLN"**：`index.html:3577`、`4469`、`5079`（§21 总表「AdaLN（约 13B，可缓存）」）、`video-models.html:656`（「33B dense single-stream，含约 13B AdaLN 参数」，结构来源列标为"官方公告可核验"）都直接给 13B；而 `index.html:4477-4478`、`detail.js:3920`、`H3-CHECKPOINT-NOTES.md:17` 明确写这份权重里 AdaLN 相关**只有约 43.65M（0.22%）**，与 13B 差约 300 倍。
- **建议**：① `detail.js:3793` 改为与 3772 一致，并保留口径说明；② 给"约 13B 在 AdaLN"补一份统一脚注「指官方 33B 原版权重；本地 int8 剪枝 repack 实测 AdaLN ≈43.65M」并加在 3577、4469、5079、`video-models.html:656` 四处——这本是 `MODEL_DETAIL_GUIDE.md:323` 自己定的规则（"社区 repack 与官方原始权重可能不同……这类差异要写出"）。

### 4.4 `parallel-lab` 的 scaling efficiency 公式写反了

- **证据**：1048-1049「报告 scaling efficiency = 单卡吞吐 ÷（卡数 × 多卡吞吐）」。若单卡吞吐 T、N 卡理想吞吐 N·T，该式给出 1/N²，明显不成立。
- **建议**：改为 `scaling efficiency = 多卡吞吐 ÷（卡数 × 单卡吞吐）`。（5 分钟）

### 4.5 编号与命名的遗留问题：`14 / 附录`、两组 01–05、总表"交叉注意力"行

- **证据**：
  - `#sources` 的 eyebrow 写「**14 / 附录**」（6770），是旧版 14 章结构的残留；全书其它章节的 eyebrow 是"组内编号 / 组名"或"实验专题 / …"。
  - **组内编号冲突**：`#vision-anatomy` 是「01 · 基础知识」（1925），`#memory` 是「01 · 先算资源账」（182）；02/03/04/05 同样各有两组（`02 · 通用模块图鉴` vs `02 · 量化机制与选择`，eyebrow 分别是「通用知识 / 模块图鉴」与「02 / 部署与并行」）。侧栏与 crumb 只显示 `data-title`，单独看"02"无法判断是哪一部。
  - `#module-atlas` §21 总表的「交叉注意力」行（5163-5172）把 SD3 标为「√（联合注意力）」、FLUX 标为「√（double-stream）」、Qwen-Image 标为「√（联合注意力）」，而同一章 §10（3949-3959）明确把 cross-attention 与 joint attention 分为两类——表头的"交叉注意力"与单元格内容冲突。
- **建议**：6770 改为「附录 / 资料索引」；`data-title` 与 eyebrow 加组前缀（如「图 01 · 基础知识」/「部 01 · 先算资源账」）；总表该行改名为「跨模态注意力（cross / joint）」或拆成两行。

---

## 五、可读性问题（次要）

### 5.1 `#module-atlas` 是唯一没有"本章术语与缩写"的章节

`app.js` 的 `glossary` 有 22 个键（app.js:119-940），覆盖包括 `start`、`sources` 在内的每一章，**唯独没有 `module-atlas`**（该 id 在 app.js 里只出现在 `chapterOrder` 第 9 行）；`renderGlossary()`（app.js:945-972）因此不给它插入术语表。而这一章恰恰是新名词最密集的一章（ViT block、AdaLN/AdaLN-Zero、GEGLU、AdaGN、Transformer2DModel、tubelet、MM-RoPE、GQA、QK-Norm、merger、MoE）。建议在 `glossary` 里补 `module-atlas` 条目（约 10 条，每条 1–2 句）。

### 5.2 两处影响阅读的版式问题

- **标题层级与编号错位**：`#vision-anatomy` 的小节 1–10 都是 `<h3>`，只有 `<h4>11. 什么时候必须在详情页补一张结构图</h4>`（3224）用了 h4 却沿用章级"11."编号（`#module-atlas` 的 15.1/15.2 用 h4 是因为它们是两位小数编号，属正常）；同一章 1945 的「先把输入说清楚」和 2174 的「论文结论如何落到工程结构」两个 `<h3>` 没有编号，夹在带编号的 1–11 之前，目录里看不出层级。
- **列过多的表**：`#module-atlas` §21「一张总表：模块 × 模型」（5050-5194）是 **8 列 × 13 行**，单元格里还嵌 `√（Qwen2.5-VL 视觉塔）`、`—（换成 Transformer）` 这类长文本，窄屏下基本读不了。建议转置为"模型为行、模块为列"，或把 MiniMax H3 与"视频模型"两列拆到 `video-models.html`。
- 另：`#memory` 的位宽下拉框有 `INT2 · 2 bit` 选项（241），但 `#quant` 全章未讨论 2-bit 量化，容易误导。建议删掉该选项或在 quant 章补一句。

---

## 六、修改清单（按优先级）

| 优先级 | 改什么 | 位置 | 预计工作量 |
|---|---|---|---|
| P0 | 修死锚点 `image-qwen.html#edit`（给 Edit 小节加 `id="edit"`，或改指向 `#network`） | `image-models.html:385`；`app.js:72` | 10 分钟 |
| P0 | 修正 scaling efficiency 公式为"多卡吞吐 ÷（卡数 × 单卡吞吐）" | `index.html:1049` | 5 分钟 |
| P0 | 统一 H3 VideoVAE 层数口径（把"层数未公开"改为"官方未公开，本节数字来自 checkpoint 核验"） | `index.html:4822-4829`（另 4122-4126） | 20 分钟 |
| P0 | 修 `detail.js` "第 50 层"自相矛盾（3793 与 3772 取一个口径） | `detail.js:3793` | 10 分钟 |
| P0 | 给所有"约 13B 在 AdaLN"加统一脚注（注明官方 33B 版权重 vs 本地 repack 43.65M） | `index.html:3577/4469/5079`；`video-models.html:656` | 20 分钟 |
| P1 | 补 VAE scaling factor 的作用说明，并在 mermaid 里加"÷ scaling_factor"节点 | `index.html:4513-4515`、`4571-4576` | 1–2 小时 |
| P1 | 改 `labs` 的位置与编号（移到 `#parallel-lab` 后，`data-title` 改「实验 · 四个验证实验」）；最低限度加前置指路 | `app.js:16`；`index.html:6641-6644` | 30 分钟 |
| P1 | 在 `#training-objectives` 补一段 LoRA 最小定义并指向 07 | `index.html:1821-1827` | 30 分钟 |
| P1 | `parallel.html` 新增"序列并行 / 上下文并行"一节（或删掉 lead 里的 SP/CP 承诺） | `parallel.html:4-5`、`#shard` 之后 | 2–3 小时（只删承诺 5 分钟） |
| P1 | 给 `module-atlas` 补"本章术语与缩写"条目 | `app.js` `glossary`（118-940 之间） | 40 分钟 |
| P2 | 补 DoRA / RAG / GRPO（RLOO）各一句定义 | `index.html:6270`、`6265`、`1537` | 30 分钟 |
| P2 | 补"为什么需要两个 / 三个文本编码器"3–4 句 | `index.html:4980` 附近 | 40 分钟 |
| P2 | `#finetune` 的"LoRA 到 QLoRA 的机制"并入 `#lora-injection` 或改为指路 | `index.html:6297-6308` | 30 分钟 |
| P2 | 删掉 `#image-principles` 的重复算例，改为指路 01 §2 | `index.html:5679-5687` | 15 分钟 |
| P2 | `#video-principles` 与 `#video-anatomy` 去重（机制、指标改指路） | `index.html:5952-6004` | 1 小时 |
| P2 | `#labs` 实验 B 改为指路 `#parallel-lab`；统一两处 `--max-model-len` | `index.html:6658-6663`、`732`；`parallel.html:9` | 20 分钟 |
| P3 | 清理编号遗留：`14 / 附录`、组内 01–05 冲突加组前缀、总表"交叉注意力"行改名 | `index.html:6770`、各 `data-title`、`5163-5172` | 30 分钟 |
| P3 | 前两章边界：组件级结构图（3151-3223）与补图规范（3224）移出 01；`#module-atlas` §8 定义句改为指路 | `index.html:3151-3282`、`3836-3839` | 2 小时 |

> 未采纳的建议（认为不值得做）：全书重写 01/02 章；为 5 个详情页另建导航体系；把 `index.html` 拆成多页。这些改动成本高、对当前问题的边际收益低。

---

## 处理记录（审阅后由主 agent 补记）

**已修复**

| 报告条目 | 实际改动 |
|---|---|
| 4.1 死锚点 | `app.js:72` 与 `image-models.html:385` 的 `image-qwen.html#edit` → `#network` |
| 4.4 scaling efficiency 公式 | `index.html` 改为「多卡吞吐 ÷（卡数 × 单卡吞吐）」，并补一句理想值 1 的含义 |
| 4.3 第 50 层口径 | `detail.js` 多模态编码器的 `facts` 改为与 3772 一致（= 最后一层输出 index 49，且该 repack 无 `model.norm`） |
| 4.2 H3 VideoVAE 层数 | §17 边界表两行改为「官方未公开；checkpoint 核验值 = 6 级编码器 / 36 层 ViT 解码器」；§14 导语里的例子改为「先按通用实现画、再用 checkpoint 核验」的说法 |
| 4.3 13B AdaLN | §2 用在哪里、§15 导语、§21 总表单元格、`video-models.html` 四处都加了「官方 33B 原版权重 vs 本地剪枝 repack ≈43.65M」的口径说明 |
| 2.1 VAE scaling factor | §16 新增一整段「scaling factor 在做什么」（为什么要缩到 ≈1、解码必须除回去、`shift_factor`），表格新增「Decoder 前」一行，mermaid 新增「解码前先除回去」节点 |
| 1.1 LoRA 未讲先用 | `#training-objectives` 的「从 logits 到 LoRA 梯度」前加了 LoRA 最小定义（`h = Wx + (α/r)BAx`、A/B 形状、只训 A/B、可合并）并指向 07 章 |
| 1.2 `labs` 位置 | `app.js` 的 `chapterOrder` 把 `labs` 移到 `parallel-lab` 之后；`data-title` 改「实验 · 四个验证实验」，图像与视频组顺延为 01–11；实验 B 增加指向「实验 · 多卡通信与拓扑验收」的协议说明 |
| 1.3 all-to-all | §13 的 `gn-note` 里加了一句白定义 + 指向 `parallel.html#expert` |
| 1.4 RMSNorm 前置 | `#checkpoint-inspector` 的前置条件里补「RMSNorm 只除均方根、不减均值」并指向图鉴 §4 |
| 2.2 SP / CP | `parallel.html` 新增第 6 节「SP / CP：切序列维，让长上下文放得下」（术语、图、与 DP/TP 的四行对照表、适用与代价），导航与后续小节编号同步；顺手删掉了该页 `</main>` 前的一个多余 `+` |
| 2.3 DoRA / RAG / GRPO | 微调方式表里 DoRA、RAG 各补一句机制；在线 RL 单元格补 PPO / RLOO / GRPO 的区别 |
| 2.4 为什么多个文本编码器 | 图鉴 §19 新增一段（77 token 限制、语义容量、序列 vs pooled 两种用途、代价） |
| 3.1 token 算例重复 | `#image-principles` 的「手算一次空间 token」改为指路 01 §2，只保留分辨率→注意力 16 倍的结论 |
| 3.2 LoRA 公式重复 | `#finetune` 的「LoRA 到 QLoRA 的机制」删掉重复公式，改为指路 07 章 + 只留 QLoRA 部分 |
| 4.5 编号遗留 | `#sources` 的 eyebrow 改为「附录 / 资料与核验方法」；总表该行改名「跨模态注意力（cross / joint）」；侧栏角标新增 E（实验）/ 附（资料）标记 |
| 5.1 图鉴缺术语表 | `app.js` 的 `glossary` 新增 `module-atlas`，13 条（ViT block、AdaLN、AdaGN、SwiGLU、Transformer2DModel、U-Net 整机、tubelet、MM-RoPE、GQA、QK-Norm、merger、MoE、scaling factor） |
| 5.2 标题层级 | `#vision-anatomy` 的「什么时候必须补一张结构图」由 h4 改 h3，标题改为「怎么读虚线框：哪些模块一定有完整结构图」 |

**评估后未改**

- 「`--max-model-len` 不一致」：两处不是同一个例子——`index.html` 是单卡 0.6B 演示（4096 合理），`parallel.html` 是双卡 TP 大模型示例（8192 合理），保留现状。
- 「把 §01 的 SDXL 组件级结构图移出基础知识」：那张图是**链路级**（零件如何协同），不是模块内部结构，放在概念章末尾与「怎么读虚线框」正好连成一组；已把后者的标题与层级改清楚，不再与「结构归图鉴」的承诺冲突。
- 「组内 01–05 编号冲突」：侧栏已经按 `data-group` 渲染分组标题（图像与视频 / 部署与并行），编号在组内唯一，未再加前缀。
- 「§21 总表转置」「`#memory` 的 INT2 选项」：收益低于改动风险，暂留。

