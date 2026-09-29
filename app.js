(function () {
  const chapters = Array.from(document.querySelectorAll(".chapter"));
  const chapterOrder = [
    "start",
    "llm-anatomy",
    "training-objectives",
    "checkpoint-inspector",
    "vision-anatomy",
    "module-atlas",
    "image-principles",
    "video-anatomy",
    "video-principles",
    "finetune",
    "lora-injection",
    "distill",
    "image-models",
    "video-models",
    "workflows",
    "memory",
    "quant",
    "serve",
    "parallel",
    "distributed-train",
    "parallel-lab",
    "labs",
    "sources",
  ];
  chapters.sort(
    (a, b) => chapterOrder.indexOf(a.id) - chapterOrder.indexOf(b.id),
  );
  const reader = document.getElementById("reader");
  const groupTitles = {
    导读: ["阅读地图", "先看学习路径，再按顺序进入各主题。"],
    语言模型结构: [
      "第一部 · 语言模型结构",
      "先把 token、注意力、MLP、训练目标和梯度路径讲清楚，再进入视觉模型。",
    ],
    图像与视频: [
      "第二部 · 图像与视频",
      "先学通用的 VAE、latent、patch、DiT、采样和损失，再学微调与蒸馏，最后按任务看具体模型。",
    ],
    部署与并行: [
      "第三部 · 部署与并行",
      "最后把已经理解的模型映射到消费级显卡、多卡服务器和集群。",
    ],
    附录: ["附录 · 资料与核验", "用一手资料核对具体模型版本、实现和许可。"],
  };
  const groupOrder = [
    "导读",
    "语言模型结构",
    "图像与视频",
    "部署与并行",
    "附录",
  ];
  chapters.forEach((chapter) => reader.append(chapter));

  // Detail pages open in a separate tab so the reader keeps its current chapter and scroll position.
  document.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const path = href.split("#")[0];
    if (!path || path === "index.html" || !path.endsWith(".html")) return;
    link.target = "_blank";
    link.rel = "noopener";
  });

  const imageModels = document.getElementById("image-models");
  if (imageModels) {
    const modelLinks = [
      ["SD 1.5 / SDXL", "image-sdxl.html"],
      ["SD3.5", "image-dit.html"],
      ["FLUX.1 / FLUX.2", "image-flux.html"],
      ["Qwen-Image / Edit", "image-qwen.html#network"],
    ];
    const modelRows = imageModels.querySelectorAll("tbody tr");
    modelRows.forEach((row) => {
      const cell = row.cells[0];
      if (!cell) return;
      const text = cell.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) return;
      const rule = modelLinks.find(([label]) =>
        text.textContent.trim().startsWith(label),
      );
      if (!rule) return;
      const link = document.createElement("a");
      link.href = rule[1];
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = rule[0];
      text.replaceWith(link, document.createTextNode(""));
    });
  }
  let previousGroup = "";
  chapters.forEach((chapter) => {
    const group = chapter.dataset.group;
    if (group !== previousGroup) {
      const [title, description] = groupTitles[group] || [group, ""];
      const divider = document.createElement("div");
      divider.className = "book-part";
      divider.id = "part-" + groupOrder.indexOf(group);
      divider.innerHTML = '<span class="part-kicker"></span><h2></h2><p></p>';
      divider.querySelector(".part-kicker").textContent =
        "PART " + String(groupOrder.indexOf(group)).padStart(2, "0");
      divider.querySelector("h2").textContent = title;
      divider.querySelector("p").textContent = description;
      chapter.before(divider);
      previousGroup = group;
    }
  });
  const toc = document.getElementById("toc");
  const search = document.getElementById("search");
  const sidebar = document.getElementById("sidebar");
  const crumb = document.getElementById("crumb");
  const progressText = document.getElementById("progressText");
  const progressBar = document.getElementById("progressBar");
  let active = chapters[0].id;

  // Each chapter starts with a vocabulary map so abbreviations are defined before they appear in the body.
  const glossary = {
    start: [
      [
        "Checkpoint",
        "模型检查点",
        "一组可恢复模型状态：权重、配置、tokenizer/VAE，以及训练时可能包含的优化器和 scheduler 状态。模型文件不等于完整 checkpoint。",
      ],
      [
        "Revision",
        "仓库修订版本",
        "模型仓库的 commit、tag 或 immutable revision。部署和复现实验必须固定它，不能只记录浮动的 model id。",
      ],
      [
        "Inference",
        "推理",
        "给定输入执行前向计算生成输出，不更新参数；延迟、吞吐、显存和质量是主要工程指标。",
      ],
      [
        "Fine-tuning",
        "微调",
        "在已有基座上继续优化参数或适配器，使模型改变特定任务、风格或行为。",
      ],
      [
        "Distillation",
        "知识蒸馏",
        "用教师模型的答案、logits、特征或轨迹监督学生模型；目标是迁移行为，不是简单压缩文件。",
      ],
    ],
    "checkpoint-inspector": [
      [
        "Config",
        "模型配置",
        "通常是 config.json；描述层数、宽度、head 数、RoPE、词表和 MoE 等结构超参数，读取配置不需要加载权重。",
      ],
      [
        "Architecture",
        "网络架构",
        "由模块类型、连接关系、张量维度和重复次数构成。architecture 字段只是入口名称，完整结构要结合源码和 state_dict。",
      ],
      [
        "State dict",
        "参数状态字典",
        "参数名到 tensor 的映射。用 named_parameters() 和 state_dict().keys() 可以确认实际模块名、权重形状和是否使用 fused projection。",
      ],
      [
        "Model card",
        "模型卡",
        "官方说明中的任务、限制、许可证、硬件、训练信息和已知风险；它不能替代源码或配置核验。",
      ],
      [
        "HF",
        "Hugging Face",
        "模型和工具生态。AutoConfig 读取配置，Transformers 加载语言模型，Diffusers 组织图像/视频 pipeline；每个具体仓库仍需单独核验。",
      ],
    ],
    memory: [
      [
        "VRAM",
        "Video RAM，显存",
        "GPU 上保存权重、激活、KV cache 和临时 buffer 的内存。容量决定能否运行，带宽决定数据搬运速度。",
      ],
      [
        "KV cache",
        "Key-Value 缓存",
        "自回归解码保存历史 token 的 K/V，下一步只计算新 Q；容量随层数、KV heads、head_dim、序列长和 batch 增长。",
      ],
      [
        "Activation",
        "激活值",
        "forward 中产生、backward 可能需要保存的中间 tensor。训练峰值通常比推理更受激活和梯度检查点影响。",
      ],
      [
        "Bandwidth",
        "内存带宽",
        "每秒能搬运多少数据。量化常通过减少权重搬运提高吞吐，但不自动减少所有激活和通信。",
      ],
      [
        "OOM",
        "Out Of Memory，显存不足",
        "分配 tensor 失败。要区分权重、KV、激活、碎片和其他进程造成的 OOM，再决定量化、缩短上下文或分片。",
      ],
    ],
    quant: [
      [
        "PTQ",
        "Post-Training Quantization，训练后量化",
        "先得到浮点模型，再用校准数据估计 scale/zero-point 或码本并转换权重；不重新训练全部模型。",
      ],
      [
        "QAT",
        "Quantization-Aware Training，量化感知训练",
        "训练时插入 fake quantization，让模型适应量化误差，最后导出低比特权重；与普通 PTQ 不是一回事。",
      ],
      [
        "NF4",
        "NormalFloat 4-bit",
        "QLoRA 使用的非均匀 4-bit 码本，针对近似正态分布权重设计；通常配合 double quantization 和高精度计算。",
      ],
      [
        "GPTQ",
        "GPT Quantization",
        "利用校准样本和近似二阶信息逐层量化并补偿误差的离线 PTQ 方法；文件格式和推理 kernel 由具体实现决定。",
      ],
      [
        "AWQ",
        "Activation-aware Weight Quantization",
        "用激活统计识别敏感通道并保护对应权重，再进行低比特量化；效果依赖校准分布和 kernel。",
      ],
      [
        "W4A16 / W8A8",
        "Weight/Activation bit-width",
        "W4A16 表示权重 4 bit、激活 16 bit；W8A8 表示两者都 8 bit。它描述计算路径，不等于文件扩展名。",
      ],
    ],
    serve: [
      [
        "API",
        "Application Programming Interface，应用程序接口",
        "服务以稳定协议暴露生成能力；OpenAI-compatible API 只说明接口形状，不代表底层模型或性能相同。",
      ],
      [
        "Prefill",
        "提示词预填充",
        "一次并行处理输入 token，建立 KV cache；通常计算密集，长 prompt 会增加首 token 延迟。",
      ],
      [
        "Decode",
        "自回归解码",
        "每次生成一个或少数 token 并追加 KV；通常带宽和串行依赖更敏感。",
      ],
      [
        "Continuous batching",
        "连续批处理",
        "请求在不同时间进入/退出同一 batch，提升 GPU 利用率；需要调度器管理长度、KV 和公平性。",
      ],
      [
        "PagedAttention",
        "分页式注意力缓存",
        "把 KV cache 分成可复用的固定大小 block，减少连续大块内存和碎片；它是内存管理/attention 实现，不是新模型。",
      ],
      [
        "Offload",
        "卸载",
        "把权重或中间状态放到 CPU/RAM/NVMe，需要时搬到 GPU；节省显存但增加 PCIe/内存带宽延迟。",
      ],
    ],
    parallel: [
      [
        "DP",
        "Data Parallelism，数据并行",
        "每张卡保存模型副本，处理不同样本，再同步梯度；模型能单卡放下时常用于扩大吞吐。",
      ],
      [
        "TP",
        "Tensor Parallelism，张量并行",
        "把单层矩阵或 attention heads 切到多卡，层内频繁 all-reduce；适合高速互联和单层太大的模型。",
      ],
      [
        "PP",
        "Pipeline Parallelism，流水线并行",
        "把不同层放到不同卡，激活通过 send/recv 传递；microbatch 不足会产生 pipeline bubble。",
      ],
      [
        "EP",
        "Expert Parallelism，专家并行",
        "MoE 的 expert 分布到不同卡，router 触发 all-to-all；通信和 expert 负载均衡是关键。",
      ],
      [
        "Speculative decoding",
        "投机解码",
        "小 draft model 先提出多个 token，大模型并行验证；候选接受率高时降低串行 decode 步数。",
      ],
      [
        "P2P",
        "Peer-to-Peer，点对点 GPU 通信",
        "GPU 直接读写另一张 GPU 的内存；由 PCIe/NVLink/拓扑和驱动决定是否高效。",
      ],
    ],
    "distributed-train": [
      [
        "DDP",
        "DistributedDataParallel",
        "每个 rank 一份完整模型；反向后 all-reduce 梯度。它解决吞吐，不解决单卡装不下的问题。",
      ],
      [
        "FSDP",
        "Fully Sharded Data Parallel",
        "分片参数、梯度和 optimizer state，forward 前 all-gather 所需参数，backward 后 reduce-scatter 梯度。",
      ],
      [
        "ZeRO",
        "Zero Redundancy Optimizer",
        "DeepSpeed 的分片系列：ZeRO-1 切 optimizer、ZeRO-2 再切梯度、ZeRO-3 连参数也切。",
      ],
      [
        "Microbatch",
        "微批次",
        "单次 forward/backward 实际处理的 batch；梯度累积多次 microbatch 后才 optimizer step。",
      ],
      [
        "Gradient checkpointing",
        "梯度检查点/激活重计算",
        "只保存部分激活，backward 时重新 forward 以换显存；降低内存但增加计算。",
      ],
      [
        "Rank / world size",
        "进程编号 / 总进程数",
        "每个分布式进程有 rank，world size 是进程总数；GPU 映射、数据 sampler 和 checkpoint 都要按 rank 正确处理。",
      ],
    ],
    "parallel-lab": [
      [
        "NCCL",
        "NVIDIA Collective Communications Library",
        "GPU 集合通信库，提供 all-reduce、all-gather、reduce-scatter、all-to-all 等操作；拓扑和环境变量会影响路径。",
      ],
      [
        "All-reduce",
        "全归约",
        "所有 rank 的 tensor 做求和/平均，并让所有 rank 得到结果；DDP 梯度同步的核心原语。",
      ],
      [
        "All-gather",
        "全收集",
        "每个 rank 提供一片 tensor，所有 rank 收到完整拼接；FSDP/TP 常在计算前使用。",
      ],
      [
        "Reduce-scatter",
        "归约后分散",
        "先跨 rank 归约，再把不同切片发给各 rank；适合分片梯度和 optimizer state。",
      ],
      [
        "All-to-all",
        "全交换",
        "每个 rank 向所有其他 rank 发送不同数据；MoE token dispatch 常用，最容易受负载和网络影响。",
      ],
      [
        "NCCL topology",
        "通信拓扑",
        "GPU、PCIe switch、NVLink、NIC 的连接图。nvidia-smi topo -m 只能提供本机视图，最终要结合 nccl-tests 实测。",
      ],
    ],
    "llm-anatomy": [
      [
        "LLM",
        "Large Language Model，大语言模型",
        "以 token 序列为输入，通过多层 Transformer 产生下一个 token 的概率分布。",
      ],
      [
        "Token / vocabulary",
        "词元 / 词表",
        "Tokenizer 把文本映射为整数 id；vocab size V 决定 embedding 和 LM head 的词表维度。",
      ],
      [
        "B / S / d_model",
        "batch / sequence / model width",
        "B 是样本批次，S 是 token 序列长度，d_model 是每个 token 的向量宽度和残差流宽度；常见 hidden_size 就是 d_model。",
      ],
      [
        "d_ff / intermediate_size",
        "MLP 中间宽度",
        "SwiGLU 的 gate/up 先把最后一维从 d_model 扩到 d_ff；down 再压回 d_model。它不是 token 数，也不是层数。",
      ],
      [
        "Linear / projection",
        "线性层 / 投影层",
        "对最后一维执行 y=xWᵀ+b；projection 只是说明这层把向量投到另一个表示空间，输入输出形状要看 W。",
      ],
      [
        "SiLU / sigmoid",
        "平滑激活 / S 形函数",
        "sigmoid(z)=1/(1+e^-z)；SiLU(z)=z·sigmoid(z)。SiLU 保留平滑非线性，SwiGLU 的 gate 分支使用它。",
      ],
      [
        "⊙ / elementwise",
        "逐元素乘法",
        "两个同形状张量在相同的 batch、token、channel 位置相乘；不会像矩阵乘法那样混合 token 或通道。",
      ],
      [
        "Residual / residual stream",
        "残差连接 / 残差流",
        "把子层输出加回输入，如 x+Attention(x)；残差流是 block 之间持续传递的 [B,S,d_model] 主通道。",
      ],
      [
        "MHA / GQA / MQA",
        "多头 / 分组查询 / 多查询注意力",
        "MHA 每个 Q head 有独立 K/V；GQA 多个 Q head 共享 K/V；MQA 所有 Q head 共享一组 K/V，降低 KV cache。",
      ],
      [
        "RoPE",
        "Rotary Position Embedding，旋转位置编码",
        "对 Q/K 的成对维度施加随位置变化的旋转，使点积携带相对位置信息；rope_theta 和 scaling 影响长上下文。",
      ],
      [
        "RMSNorm",
        "Root Mean Square Normalization",
        "用均方根缩放 hidden state，通常没有 LayerNorm 的均值中心化；eps 和放置位置由模型配置决定。",
      ],
      [
        "SwiGLU",
        "Swish Gated Linear Unit",
        "用 SiLU(gate_proj(x)) 与 up_proj(x) 逐元素相乘，再经 down_proj；比普通两层 FFN 多一个门控投影。",
      ],
      [
        "MoE",
        "Mixture of Experts，混合专家",
        "router 为每个 token 选 top-k expert MLP；总参数可很大，但每 token 只激活部分专家，同时带来 all-to-all 通信。",
      ],
      [
        "Rollout",
        "策略采样轨迹",
        "用当前 policy 在 prompt 集上生成 response、token log-prob、结束原因、工具结果和奖励，供在线 RL 计算 ratio、KL 与 advantage。",
      ],
      [
        "Reward model / RM",
        "奖励模型",
        "从人工偏好或规则标签学习一个评分器；它是训练信号的代理，必须用独立人工盲评和红队集检查奖励投机。",
      ],
      [
        "RLHF",
        "基于人类反馈的强化学习",
        "常见闭环是 SFT policy → preference/RM → rollout → reward → advantage → PPO/RLOO/其他策略更新，并用 reference KL 限制漂移。",
      ],
      [
        "Advantage / GAE",
        "优势 / 广义优势估计",
        "估计某个 token 或整段 response 比 value baseline 好多少；优势尺度和 response/token mask 会直接影响策略梯度。",
      ],
    ],
    "training-objectives": [
      [
        "CE / Cross-Entropy",
        "交叉熵",
        "把目标 token 的负对数概率作为损失；Causal LM 通常对 shifted labels 计算并对有效 mask 求平均。",
      ],
      [
        "SFT",
        "Supervised Fine-Tuning，监督微调",
        "使用输入-目标答案对直接最大化目标答案概率；chat SFT 通常只 mask 后的 assistant token。",
      ],
      [
        "DPO",
        "Direct Preference Optimization",
        "不训练显式 reward model，直接用 chosen/rejected 的 policy 与 reference log-prob 差训练偏好。",
      ],
      [
        "epsilon prediction / v prediction",
        "噪声预测 / 速度参数化",
        "扩散网络在随机时间点预测 epsilon 或 v；target 与 scheduler 的参数化必须匹配。",
      ],
      [
        "Flow Matching",
        "流匹配",
        "从噪声到数据定义概率路径，训练网络预测该路径在时间 t 的速度场，推理用 ODE solver 积分。",
      ],
      [
        "Autograd",
        "自动微分",
        "保存计算图并用链式法则反向求梯度；冻结参数不等于不经过该层 forward。",
      ],
    ],
    "vision-anatomy": [
      [
        "Pixel / latent",
        "像素空间 / 潜空间",
        "Pixel 是 RGB 图像的显式网格；latent 是 VAE 编码后的连续特征网格。生成主干通常在 latent 中运行，最后由 VAE decoder 回到像素。",
      ],
      [
        "Patch / token",
        "图像块 / 主干输入向量",
        "Patch 是 latent 网格的小区域；token 是把 patch 展平并线性投影后得到的向量。图像 token 与语言 token 都是向量，但来源和语义不同。",
      ],
      [
        "Patchify / unpatchify",
        "切块成序列 / 序列还原网格",
        "Patchify 把 [B,C,H,W] 变为 [B,N,D]；unpatchify 把每个输出 token 还原为 patch 并排列回 [B,C,H,W]。",
      ],
      [
        "DiT",
        "Diffusion Transformer，扩散 Transformer",
        "用 Transformer 代替 U-Net 作为扩散/流模型主干。它接收带噪 latent token，输出噪声、速度或 latent update；VAE 和 scheduler 仍是独立模块。",
      ],
      [
        "MMDiT",
        "Multimodal Diffusion Transformer",
        "图像 token 与文本 token 保留各自的投影/归一化，再通过联合 attention 交互；SD3 类模型使用这种设计，但具体实现需看 checkpoint。",
      ],
      [
        "VAE",
        "Variational Autoencoder，变分自编码器",
        "把像素图压到 latent 再解码；潜扩散在 latent 中工作以减少空间计算。实际生成模型常使用带特定缩放因子的 VAE。",
      ],
      [
        "U-Net",
        "编码器-解码器式卷积主干",
        "通过 downsample 获取大感受野、mid block 建模全局、upsample 恢复分辨率，并用 skip connection 传递细节。",
      ],
      [
        "ResNet block",
        "Residual Network block，残差块",
        "卷积/归一化/激活变换后与输入相加，改善深层优化；时间 embedding 通常注入其中。",
      ],
      [
        "Cross-Attention",
        "交叉注意力",
        "Q 来自 latent，K/V 来自文本或其他条件；让视觉特征读取 prompt，而不是把文本直接拼到像素上。",
      ],
      [
        "AdaLN",
        "Adaptive Layer Normalization",
        "用 timestep/条件 embedding 生成 scale、shift 或 gate 调制归一化后的特征；DiT 常用它注入时间条件。",
      ],
      [
        "RoPE",
        "Rotary Position Embedding，旋转位置编码",
        "对 token 的 Q/K 成对维度施加位置相关旋转，使 attention 感知 token 的空间/序列位置；图像实现可能使用二维坐标或 packing。",
      ],
      [
        "Scheduler / solver",
        "调度器 / 数值求解器",
        "根据 timestep、sigma 和主干预测值更新 latent；它不是主干层，扩散 scheduler 与 flow ODE solver 的公式不能混用。",
      ],
      [
        "Flow Matching",
        "流匹配",
        "训练模型预测从噪声分布到数据分布的条件速度场；推理使用数值积分逐步移动 latent。",
      ],
      [
        "ControlNet",
        "结构控制分支",
        "复制或旁路 U-Net 的多尺度特征，用 zero-conv/adapter 注入姿态、深度、边缘等控制信号。",
      ],
      [
        "SNR / λ_t",
        "信噪比 / log-SNR",
        "SNR(t)=ᾱ_t/(1−ᾱ_t) 衡量这一刻信号与噪声的比值；λ_t=log SNR 是同一件事的对数写法，v-prediction 与加权损失都按它来定义。",
      ],
      [
        "Schedule / sigma 表",
        "噪声调度 / 推理时间表",
        "beta schedule 决定训练时 ᾱ_t 的曲线；sigma 表是推理时实际使用的每一步噪声水平，由 timesteps 采样方式（leading/trailing/Karras）与 shift 生成，两者不是同一张表。",
      ],
      [
        "ε / v / x₀ / velocity",
        "四种预测参数化",
        "同一份权重可以回归噪声 ε、干净 latent x₀、速度 v 或 flow 的 velocity；三者之间可以互相换算，但必须与该 checkpoint 的 prediction_type 和 sampler 匹配。",
      ],
      [
        "Sampler / solver",
        "推理求解器",
        "把模型预测变成下一步 latent 的数值公式：DDIM 是确定性一步式，Euler 是 ODE 一阶积分，Heun/DPM-Solver++ 是二阶多步，FlowMatch Euler 是流匹配侧的同款欧拉积分。换 sampler 通常要连 sigma 表一起换。",
      ],
      [
        "Guidance distillation",
        "引导蒸馏",
        "把 guidance 直接训进网络（权重里带 guidance 输入），推理时一次前向即可；它的引导行为是学出来的，不等同于普通 CFG，也不能再叠加一次双前向 CFG。",
      ],
    ],
    "module-atlas": [
      [
        "ViT block",
        "视觉 Transformer 块",
        "把图像切成 patch 当 token，用标准 Transformer 编码器处理；一个 block = LayerNorm → 多头自注意力 → 残差 → LayerNorm → MLP → 残差，和语言模型 block 的唯一区别在输入（patch embedding）与位置编码。",
      ],
      [
        "AdaLN",
        "Adaptive Layer Normalization，自适应层归一化",
        "用条件向量生成归一化的 scale / shift（以及门控 gate），把时间步、pooled 文本等「全局条件」注入每个 block。AdaLN-Zero 把 gate 初始化为 0，让 block 一开始是恒等映射。",
      ],
      [
        "AdaGN",
        "Adaptive Group Normalization",
        "U-Net 里的时间条件注入方式：在 ResNet block 的 GroupNorm 之后用时间向量做 scale / shift。作用与 AdaLN 相同，位置不同。",
      ],
      [
        "SwiGLU",
        "Swish-Gated Linear Unit，门控前馈网络",
        "gate = SiLU(xW_g) 与 up = xW_u 逐元素相乘后再降维；中间宽度常取 8/3·D。LLaMA / Qwen / H3 用这一种，FLUX 的 ff.net 是 GELU 门控。",
      ],
      [
        "Transformer2DModel",
        "空间 Transformer 块",
        "U-Net 里插在 ResNet 之间的模块：把特征图展平成 token 做 self-attention 与 cross-attention（读文本 K/V），再折回特征图并残差相加。",
      ],
      [
        "U-Net 整机",
        "多尺度卷积主干",
        "down → mid → up 的卷积主干，同尺度 skip feature 在通道维拼接。SDXL 是 3 级、2 个 downsampler、Mid 在 h/4；SD 1.5 是 4 级、3 个 downsampler、Mid 在 h/8。",
      ],
      [
        "tubelet",
        "时间块",
        "视频 patch 化时带时间维的块，例如 1×2×2（一帧 × 2×2 像素）或 2×2×2。它决定视频 token 的有效时间步长与空间步长。",
      ],
      [
        "MM-RoPE",
        "多模态旋转位置编码",
        "把 head_dim 分成几段，每段负责一个轴（t/h/w）做旋转变换，使视频、音频、文本 token 能在同一条 packed 序列里表达三维位置关系。",
      ],
      [
        "GQA",
        "Grouped-Query Attention，分组查询注意力",
        "多个 Q head 共享一组 K/V head（例如 64:8），在几乎不掉质量的前提下减少 KV cache 与显存；LLaMA / Qwen 系列与 H3-Encoder 在用。",
      ],
      [
        "QK-Norm",
        "对 Q/K 的归一化",
        "在算注意力分数前对 Q、K 各做一次 RMSNorm / LayerNorm，稳定深层训练；SD3.5 的 qk_norm=rms_norm 与 FLUX 都用了。",
      ],
      [
        "merger",
        "视觉 token 合并器",
        "把 ViT 输出里 2×2 相邻 token 拼接后经 MLP 投影到 LLM 宽度，token 数除以 4；Qwen3-VL 还有 3 个 deepstack merger 从不同深度各取一路。",
      ],
      [
        "MoE",
        "Mixture of Experts，混合专家",
        "用 router 给每个 token 打分并只送进 top-k 个 FFN 专家，再按权重求和；总参数量大、每个 token 的激活量小，代价是 all-to-all 通信与负载均衡。",
      ],
      [
        "scaling factor",
        "latent 缩放系数",
        "训练时约定的常数，把 VAE latent 的标准差拉到 ≈1 以匹配加噪公式的假设；进主干前乘、回像素前必须除回去（漏除是最常见的复现 bug）。",
      ],
    ],
    "video-anatomy": [
      [
        "T2V / I2V",
        "Text-to-Video / Image-to-Video",
        "T2V 仅用文本条件生成视频；I2V 将一张或多张图像作为外观/边界条件。",
      ],
      [
        "3D VAE",
        "时空变分自编码器",
        "同时在 T、H、W 上压缩视频，输出 [B,C,T',H',W'] latent；时间压缩率决定帧 token 成本。",
      ],
      [
        "Tubelet / 3D patch",
        "时间块 / 三维 patch",
        "把连续时间帧和空间区域一起切成 token；patch 越大 token 越少，但局部细节表达可能下降。",
      ],
      [
        "Spatial / Temporal Attention",
        "空间 / 时间注意力",
        "空间注意力建模同帧布局；时间注意力建模跨帧运动和身份一致性；分解计算可降低全时空成本。",
      ],
      [
        "Flicker",
        "闪烁",
        "相邻帧的亮度、纹理、身份或结构不稳定；通常与时间条件、窗口拼接、VAE 和采样轨迹有关。",
      ],
      [
        "FPS",
        "Frames Per Second，每秒帧数",
        "输出播放速率；FPS 与生成帧数、时长、插帧和音频同步必须分开记录。",
      ],
    ],
    "lora-injection": [
      [
        "LoRA",
        "Low-Rank Adaptation，低秩适配",
        "冻结 W，只训练 ΔW=(alpha/r)BA；用低秩矩阵表达任务增量，推理时可旁路或合并。",
      ],
      [
        "Rank r",
        "低秩维度",
        "A/B 中间维度；r 越大可表达的增量越多、训练参数和显存也越大。",
      ],
      [
        "Alpha",
        "LoRA 缩放系数",
        "实际增量通常按 alpha/r 缩放；它改变更新幅度，不等同于 rank，也不能跨实现盲目比较。",
      ],
      [
        "Target modules",
        "目标模块",
        "LoRA 插入的 Linear/Projection 名称。不是跨模型标准，必须打印 named_modules 或使用官方训练脚本默认值。",
      ],
      [
        "QLoRA",
        "Quantized LoRA",
        "4-bit 冻结基座 + 高精度计算 + LoRA；节省基座存储，不改变 LoRA 的目标层位置。",
      ],
      [
        "Adapter merge",
        "适配器合并",
        "把 ΔW 加回 W 形成新权重；量化基座、多个 adapter、推理 kernel 和导出格式可能限制是否能安全合并。",
      ],
    ],
    "image-principles": [
      [
        "Latent Diffusion",
        "潜空间扩散",
        "先用 VAE 压缩图像，再在低维 latent 中加噪/去噪，最后解码回像素，减少计算。",
      ],
      [
        "DDPM / DDIM",
        "Denoising Diffusion Probabilistic/Implicit Model",
        "DDPM 定义随机前向加噪与反向去噪；DDIM 是可用更少步数的确定性/半确定性采样路径。",
      ],
      [
        "Scheduler",
        "噪声调度器",
        "规定 sigma/beta/timestep 和每一步 latent 更新规则；它不是主干网络，不能跨模型随意替换。",
      ],
      [
        "CFG",
        "Classifier-Free Guidance",
        "组合 conditional 与 unconditional 预测，提高 prompt 遵循；scale 过大可能过饱和、失真或牺牲多样性。",
      ],
      [
        "DiT",
        "Diffusion Transformer",
        "把 latent patch 转成 token，用 Transformer 替代 U-Net 主干；分辨率变化体现为 token 序列长度变化。",
      ],
      [
        "MMDiT",
        "Multimodal Diffusion Transformer",
        "让文本和图像 token 通过独立投影/归一化后联合交互，常见于 SD3 类多模态生成器。",
      ],
    ],
    "image-models": [
      [
        "T2I / I2I",
        "Text-to-Image / Image-to-Image",
        "T2I 从噪声和文字开始；I2I 从输入图像 latent 加噪后重建，denoise strength 控制偏离原图程度。",
      ],
      [
        "Inpainting",
        "局部重绘",
        "使用 mask 指定允许改变的区域，结合原图 latent 和文本条件进行去噪；边缘融合决定自然度。",
      ],
      [
        "IP-Adapter",
        "Image Prompt Adapter",
        "把参考图编码为 image embedding，通过额外 attention 条件影响生成，不等同于训练一个完整新模型。",
      ],
      [
        "LoRA / DreamBooth",
        "低秩适配 / 主体个性化微调",
        "LoRA 训练小增量；DreamBooth 类方法用少量主体图和先验保持让模型学习特定主体概念。",
      ],
      [
        "Super-resolution",
        "超分辨率",
        "从低分辨率生成高分辨率细节；结果可能是合理补全，不应被解释为恢复了原始真实细节。",
      ],
      [
        "OCR",
        "Optical Character Recognition，光学字符识别",
        "评估图像内文字正确率；生成模型的文字排版能力不能只用视觉美观评价。",
      ],
    ],
    "video-principles": [
      [
        "T2V / I2V / V2V",
        "文本/图像/视频到视频",
        "分别以文本、图像或已有视频作为条件；V2V 常通过重加噪和时空约束进行编辑。",
      ],
      [
        "Temporal consistency",
        "时间一致性",
        "主体身份、纹理、光照和几何在相邻帧稳定；是视频生成区别于逐帧生图的核心指标。",
      ],
      [
        "Motion prior",
        "运动先验",
        "模型从视频数据学习的动作/摄像机变化规律；可通过 motion module、条件或参考轨迹控制。",
      ],
      [
        "Frame interpolation",
        "插帧",
        "在已有帧之间预测中间帧，提高 FPS；它不等于重新生成完整长视频。",
      ],
      [
        "Shot / storyboard",
        "镜头 / 分镜",
        "生产流程中的最小可控叙事单元；先分镜再生成短镜头比一次生成长片更容易保持一致性。",
      ],
      [
        "VAE temporal compression",
        "VAE 时间压缩",
        "把多帧压成更短的 latent 时间轴；压缩率决定模型一次能处理的帧数和解码边界。",
      ],
    ],
    "video-models": [
      [
        "Wan / HunyuanVideo / CogVideoX / LTX",
        "开放视频模型家族",
        "都是模型家族名，不是统一架构；必须按具体版本的 VAE、DiT、条件和许可证阅读。",
      ],
      [
        "MiniMax H3 / H3-Omni-Transformer",
        "统一多模态音视频模型",
        "公开资料描述 H3 可把文本、图像、视频和音频放进统一上下文，并联合预测视频与音频 latent；具体 checkpoint 的层数、模块名和采样配置仍要以模型卡、源码和 config 核验。",
      ],
      [
        "T2V / I2V / TI2V",
        "文本/图像/文本图像到视频",
        "TI2V 同时使用文本与图像条件；不同 checkpoint 的任务支持不能从家族名推断。",
      ],
      [
        "MoE",
        "Mixture of Experts",
        "Wan 等某些版本可能使用高/低噪声专家或专家路由；总参数、激活参数和显存要分开核算。",
      ],
      [
        "Open weights",
        "开放权重",
        "可下载权重不等于开放数据、开放源码或允许任意商用；许可证和模型卡要独立检查。",
      ],
      [
        "API / hosted model",
        "托管模型服务",
        "只能使用服务商公开的接口和能力；内部层数、训练数据、loss 和后处理若未披露就属于未知。",
      ],
      [
        "Benchmark",
        "基准评测",
        "用固定数据和指标比较模型；视频还需人工评估动作、身份、闪烁和接镜，单一自动分数不够。",
      ],
    ],
    workflows: [
      [
        "Workflow",
        "工作流",
        "节点和数据类型组成的有向图；每个节点应记录输入、输出、版本、参数、显存和失败原因。",
      ],
      [
        "Node / graph",
        "节点 / 图",
        "ComfyUI 等系统把模型加载、编码、采样、解码、后处理拆成可连接节点。",
      ],
      [
        "Seed",
        "随机种子",
        "初始化随机噪声的可复现标识；固定 seed 只能复现同配置下的随机起点，不能抵消模型/版本变化。",
      ],
      [
        "ControlNet / Adapter",
        "控制网络 / 适配器",
        "把姿态、深度、边缘或参考图转成条件特征，注入主干的不同层级。",
      ],
      [
        "Queue / batch",
        "队列 / 批处理",
        "队列管理多任务，batch 把同类请求并行；视频和不同分辨率混批可能造成 padding 和显存浪费。",
      ],
      [
        "Artifact provenance",
        "产物溯源",
        "记录输入哈希、模型 revision、节点图、参数、许可证和输出，保证结果可追溯。",
      ],
    ],
    finetune: [
      [
        "PEFT",
        "Parameter-Efficient Fine-Tuning",
        "只训练少量附加参数或部分参数，降低显存、存储和训练成本；LoRA 是 PEFT 方法之一。",
      ],
      [
        "SFT",
        "Supervised Fine-Tuning",
        "用高质量 input/target 样本直接优化目标 token；数据格式、mask 和 chat template 会直接影响训练。",
      ],
      [
        "QLoRA",
        "Quantized LoRA",
        "NF4 等低比特冻结基座 + BF16/FP16 计算 + LoRA；优化器只维护 adapter 状态。",
      ],
      [
        "DoRA",
        "Weight-Decomposed Low-Rank Adaptation",
        "将权重方向和幅度分解后结合 LoRA，可能改善某些任务，但参数、实现和合并流程不同。",
      ],
      [
        "DPO",
        "Direct Preference Optimization",
        "从 chosen/rejected 偏好对直接更新 policy；需要可靠偏好数据和独立评测。",
      ],
      [
        "Catastrophic forgetting",
        "灾难性遗忘",
        "新数据训练让旧能力退化；需要混合数据、低学习率、正则或回归测试监控。",
      ],
    ],
    distill: [
      [
        "Teacher / Student",
        "教师 / 学生模型",
        "教师提供答案、概率、特征或轨迹；学生用更小架构学习这些信号，教师通常不更新。",
      ],
      [
        "Response distillation",
        "响应蒸馏",
        "教师先生成文本、标签或最终图像/视频样本，学生把它们作为监督数据；实现简单但会继承教师错误。",
      ],
      [
        "Trajectory distillation",
        "轨迹蒸馏",
        "保存扩散/流模型多个时间点的 latent 与 teacher prediction，让学生学习多步过程的更新；通常需要单独保存 tensor 文件。",
      ],
      [
        "Feature distillation",
        "特征蒸馏",
        "匹配教师和学生的中间 hidden、attention 或时空 feature；宽度不同要加 projection 对齐。",
      ],
      [
        "Logit distillation",
        "logits 蒸馏",
        "学生匹配教师未归一化 logits 或温度 softmax 分布；要求可访问教师 logits 且词表/对齐兼容。",
      ],
      [
        "KL divergence",
        "Kullback-Leibler 散度",
        "衡量两个概率分布差异；蒸馏中常用 KL(student || teacher) 或反向方向，方向必须明确。",
      ],
      [
        "Temperature T",
        "蒸馏温度",
        "softmax(logits/T)；T 越高分布越平滑，暴露类别间的暗知识，loss 常乘 T² 保持梯度尺度。",
      ],
      [
        "On-policy / off-policy",
        "在线 / 离线蒸馏",
        "离线先生成并过滤教师数据；在线让学生生成后实时获得教师评分或修正，成本和偏差更大。",
      ],
      [
        "Consistency / few-step distillation",
        "一致性/少步蒸馏",
        "将扩散教师的多步轨迹压缩为少步甚至一步生成器；与语言模型响应蒸馏不是同一种训练。",
      ],
    ],
    labs: [
      [
        "Baseline",
        "基线",
        "未经新方法的可比较参考，如 BF16、基座 zero-shot、单卡吞吐；没有基线就无法解释改进。",
      ],
      [
        "A/B test",
        "对照实验",
        "只改变一个变量比较两组，如 4-bit vs BF16、qv-only vs all-linear LoRA。",
      ],
      [
        "Ablation",
        "消融实验",
        "移除或替换一个组件观察性能变化，用于判断该组件是否真正贡献效果。",
      ],
      [
        "P50 / P95",
        "延迟分位数",
        "P50 代表典型中位延迟，P95 反映尾延迟；服务容量不能只看平均值。",
      ],
      [
        "Throughput / latency",
        "吞吐 / 延迟",
        "吞吐是单位时间处理 token/请求数；延迟是单请求等待时间，batch 变大常让两者权衡。",
      ],
      [
        "Held-out set",
        "保留测试集",
        "训练过程中不参与优化的数据，用于判断泛化、过拟合和数据泄漏。",
      ],
    ],
    sources: [
      [
        "Primary source",
        "一手资料",
        "论文、官方仓库、官方文档、官方模型卡和配置；用于确认结构、算法和运行命令。",
      ],
      [
        "Paper",
        "论文",
        "解释方法和实验设定，但论文架构图不一定包含工程实现的 padding、offload、后处理和版本差异。",
      ],
      [
        "Repository",
        "代码仓库",
        "查看 modeling、configuration、pipeline、训练脚本和 commit；源码是验证模块名的关键。",
      ],
      [
        "License",
        "许可证",
        "决定下载、商用、再分发、派生和蒸馏限制；开放权重不自动代表开放许可。",
      ],
      [
        "Reproducibility",
        "可复现性",
        "固定 revision、依赖、硬件、随机种子、数据版本、命令和评测脚本，才能比较结果。",
      ],
    ],
  };

  function renderGlossary() {
    chapters.forEach((chapter) => {
      const terms = glossary[chapter.id];
      const lead = chapter.querySelector(".lead");
      if (!terms || !lead || chapter.querySelector(".chapter-glossary")) return;
      const box = document.createElement("div");
      box.className = "chapter-glossary";
      const title = document.createElement("h3");
      title.textContent = "本章术语与缩写";
      box.append(title);
      const table = document.createElement("div");
      table.className = "glossary-table";
      terms.forEach(([term, full, detail]) => {
        const row = document.createElement("div");
        row.className = "glossary-row";
        row.innerHTML =
          '<div class="glossary-term"><b></b><small></small></div><p></p>';
        row.querySelector("b").textContent = term;
        row.querySelector("small").textContent = full;
        row.querySelector("p").textContent = detail;
        table.append(row);
      });
      box.append(table);
      lead.insertAdjacentElement("afterend", box);
    });
  }

  renderGlossary();

  function renderToc(query = "") {
    const term = query.trim().toLocaleLowerCase();
    const matches = chapters.filter(
      (chapter) =>
        !term ||
        (chapter.dataset.title + " " + chapter.textContent)
          .toLocaleLowerCase()
          .includes(term),
    );
    toc.replaceChildren();
    let group = "";
    let wrapper;
    for (const chapter of matches) {
      if (chapter.dataset.group !== group) {
        group = chapter.dataset.group;
        wrapper = document.createElement("div");
        wrapper.className = "toc-group";
        const label = document.createElement("div");
        label.className = "toc-group-title";
        label.textContent = group;
        wrapper.append(label);
        toc.append(wrapper);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toc-link" + (chapter.id === active ? " active" : "");
      button.dataset.target = chapter.id;
      const number = document.createElement("span");
      // 侧栏的角标：结构专章用 S、实验章用 E、附录用「附」，带编号的章节用两位数字。
      // 没有可识别前缀的（如「阅读指南」）退回它在书里的位置序号。
      const marker = chapter.dataset.title.match(/^(结构|实验|资料|\d+)/);
      number.textContent = marker
        ? marker[1] === "结构"
          ? "S"
          : marker[1] === "实验"
            ? "E"
            : marker[1] === "资料"
              ? "附"
              : marker[1].padStart(2, "0")
        : String(chapters.indexOf(chapter)).padStart(2, "0");
      const title = document.createElement("span");
      // 只去掉「01 · 」「结构 · 」「实验 · 」「资料 · 」这类短前缀；像「阅读指南」这种
      // 没有前缀的标题要原样保留，否则侧栏会只剩序号、没有文字。
      title.textContent = chapter.dataset.title.replace(/^[^\s·]{1,6}\s*·\s*/, "");
      button.append(number, title);
      button.addEventListener("click", () => {
        chapter.scrollIntoView({ behavior: "smooth", block: "start" });
        history.replaceState(null, "", "#" + chapter.id);
        sidebar.classList.remove("open");
      });
      wrapper.append(button);
    }
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "search-result";
      empty.textContent = "没有匹配章节。试试模型名称、任务或术语。";
      toc.append(empty);
    }
  }

  // 左侧目录跟随页面上下滚动：
  // 拖动页面滚动条时，当前激活的章节项会被滚到目录可视区中间，
  // 所以导航栏会跟着页面上下滑动；用户自己在目录里滚动时先让位，避免互相抢滚动。
  let tocHoldUntil = 0;

  function keepTocVisible(id) {
    if (!id || Date.now() < tocHoldUntil) return;
    const button = toc.querySelector('.toc-link[data-target="' + id + '"]');
    if (!button) return;
    if (!toc.clientHeight) return;
    const tocRect = toc.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const delta =
      buttonRect.top +
      buttonRect.height / 2 -
      (tocRect.top + tocRect.height / 2);
    if (Math.abs(delta) < 6) return;
    const reduce =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    toc.scrollBy({ top: delta, behavior: reduce ? "auto" : "smooth" });
  }

  ["wheel", "touchstart", "pointerdown"].forEach((type) =>
    toc.addEventListener(
      type,
      () => {
        tocHoldUntil = Date.now() + 1600;
      },
      { passive: true },
    ),
  );

  function setActive(id) {
    active = id;
    const index = chapters.findIndex((chapter) => chapter.id === id);
    crumb.textContent = chapters[index].dataset.title;
    progressText.textContent = index + 1 + " / " + chapters.length;
    progressBar.style.width = ((index + 1) / chapters.length) * 100 + "%";
    toc
      .querySelectorAll(".toc-link")
      .forEach((button) =>
        button.classList.toggle("active", button.dataset.target === id),
      );
    keepTocVisible(id);
  }

  renderToc();
  setActive(active);
  search.addEventListener("input", () => {
    renderToc(search.value);
    requestAnimationFrame(() => keepTocVisible(active));
  });
  document
    .getElementById("menu")
    .addEventListener("click", () => sidebar.classList.toggle("open"));
  document.addEventListener("click", (event) => {
    if (
      window.innerWidth <= 900 &&
      sidebar.classList.contains("open") &&
      !sidebar.contains(event.target) &&
      event.target.id !== "menu"
    )
      sidebar.classList.remove("open");
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      search.focus();
    }
    if (event.key === "Escape") {
      sidebar.classList.remove("open");
      search.blur();
    }
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) setActive(visible[0].target.id);
    },
    { rootMargin: "-70px 0px -70% 0px" },
  );
  chapters.forEach((chapter) => observer.observe(chapter));
  if (location.hash) {
    const target = document.getElementById(
      decodeURIComponent(location.hash.slice(1)),
    );
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }

  const theme = document.getElementById("theme");
  try {
    if (localStorage.getItem("book-theme") === "dark")
      document.body.classList.add("dark");
  } catch (_) {}
  theme.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    try {
      localStorage.setItem(
        "book-theme",
        document.body.classList.contains("dark") ? "dark" : "light",
      );
    } catch (_) {}
  });
  document.querySelectorAll(".copy").forEach((button) =>
    button.addEventListener("click", async () => {
      const value = button.parentElement.querySelector("code").textContent;
      let copied = false;
      try {
        await navigator.clipboard.writeText(value);
        copied = true;
      } catch (_) {}
      if (!copied) {
        const field = document.createElement("textarea");
        field.value = value;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.append(field);
        field.select();
        try {
          copied = document.execCommand("copy");
        } catch (_) {}
        field.remove();
      }
      button.textContent = copied ? "已复制" : "复制失败";
      setTimeout(() => {
        button.textContent = "复制";
      }, 1800);
    }),
  );

  const params = document.getElementById("params");
  const bits = document.getElementById("bits");
  const headroom = document.getElementById("headroom");
  function updateCalc() {
    const p = Number(params.value),
      b = Number(bits.value),
      h = Number(headroom.value);
    const output = document.getElementById("calcOutput");
    if (!Number.isFinite(p * b * h) || p <= 0 || h < 1) {
      output.textContent = "请输入正参数量与不小于 1 的余量。";
      return;
    }
    const gib = (p * 1e9 * b) / 8 / 1024 ** 3;
    output.innerHTML =
      "<strong>" +
      gib.toFixed(2) +
      " GiB</strong> 裸权重下界 · 乘余量约 <strong>" +
      (gib * h).toFixed(2) +
      " GiB</strong><br>仍需单独预算 KV cache、激活、框架开销；量化 scale 与未量化层也会增重。";
  }
  [params, bits, headroom].forEach((element) =>
    element.addEventListener("input", updateCalc),
  );
  updateCalc();

  document.querySelectorAll("#checklist input").forEach((input, index) => {
    try {
      input.checked = localStorage.getItem("book-check-" + index) === "true";
    } catch (_) {}
    input.addEventListener("change", () => {
      try {
        localStorage.setItem("book-check-" + index, input.checked);
      } catch (_) {}
    });
  });
})();
