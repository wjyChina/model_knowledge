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
- [ ] node --check detail.js 是否通过，浏览器控制台是否无错误。
- [ ] 页面是否没有全局横向溢出。

## 八、当前实现对应文件

- image-sdxl.html：详情页的最小页面骨架和四个章节入口。
- detail.js：网络结构数据、推断 / 训练 / 微调渲染器、模块详情弹窗。
- detail.css：网络卡片、skip 配对、条件路径、模块流程图和响应式布局。
- image-models.html：图像模型总览和详情页入口。

