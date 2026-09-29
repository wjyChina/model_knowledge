(function () {
  const reader = document.querySelector(".detail-reader");
  if (!reader) return;

  // ===========================================================================
  // 数据流渲染器（df-*）
  // 目标：读者不需要点击任何模块，就能沿主图按顺序读到
  //   真实输入 → 预处理/编码 → 中间变量与形状 → 主干内部数据流 →
  //   预测输出 → scheduler/solver 多步循环 → 最终解码。
  // 图中每个合流点都必须写出运算类型（concat(seq) / concat(channel) /
  // residual add / attention read(K,V) / scheduler update …），不允许只写 “+”。
  // 只有内部含多层神经网络、值得展开的模块才渲染为可点击按钮。
  // ===========================================================================

  // 运算词汇表：全站统一，避免不同数学运算共用 “+”。
  const opKinds = {
    encode: { code: "encode", label: "编码 / 投影" },
    cat: { code: "concat(seq) 或 concat(channel)", label: "拼接（必须写明维度）" },
    add: { code: "residual add", label: "逐元素相加（形状必须相同）" },
    read: { code: "attention read", label: "注意力读取 / 条件注入" },
    write: { code: "attention write", label: "写回查询流的残差或输出投影" },
    solver: { code: "scheduler / solver update", label: "数值更新（无参数、无梯度）" },
    split: { code: "split", label: "按 token 类型或通道拆回各流" },
    decode: { code: "decode", label: "解码回像素 / 波形" },
  };

  function opChip(kind) {
    const meta = opKinds[kind] || opKinds.encode;
    return (
      '<span class="df-chip df-chip-' +
      kind +
      '"><b>' +
      meta.code +
      "</b><span>" +
      meta.label +
      "</span></span>"
    );
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Catalog text is local, but a small allowlist keeps intentional inline code
  // and emphasis readable without allowing arbitrary markup into the page.
  function rich(text) {
    return esc(text == null ? "" : text)
      .replace(/&lt;(\/?)code&gt;/g, "<$1code>")
      .replace(/&lt;(\/?)b&gt;/g, "<$1b>")
      .replace(/&lt;(\/?)strong&gt;/g, "<$1strong>")
      .replace(/&lt;br\s*\/??&gt;/g, "<br />");
  }

  // --- 主图节点 ------------------------------------------------------------
  // kind: input | external | process | module | condition | state | loop | output | note
  // module 节点必须自带 detail（输入/输出/作用/何时重复/内部图），因为它代表多层网络。
  function dfNode(node) {
    const spec = typeof node === "string" ? { title: node } : node;
    const kind = spec.kind || "process";
    const shape = spec.shape ? "<code>" + esc(spec.shape) + "</code>" : "";
    const meta = spec.meta ? "<small>" + esc(spec.meta) + "</small>" : "";
    const body =
      "<strong>" + esc(spec.title) + "</strong>" + shape + meta;
    if (spec.detail) {
      return (
        '<button type="button" class="df-node df-module df-node-' +
        kind +
        '" data-df-module="' +
        esc(spec.id || spec.title) +
        '">' +
        body +
        '<span class="df-hint">展开内部结构</span></button>'
      );
    }
    return (
      '<div class="df-node df-node-static df-node-' + kind + '">' + body + "</div>"
    );
  }

  function dfOp(op) {
    const spec = typeof op === "string" ? { kind: op } : op;
    const kind = spec.kind || "encode";
    return (
      '<div class="df-op df-op-' +
      kind +
      '"><b>' +
      esc(String(spec.code).replace(/([^^\s])\*([^\s])/g, "$1 * $2")) +
      "</b><small>" +
      esc(spec.note || (opKinds[kind] || opKinds.encode).label) +
      "</small></div>"
    );
  }

  function dfRow(items) {
    return (
      '<div class="df-row">' +
      items
        .map((item) => (item && item.__op ? dfOp(item) : dfNode(item)))
        .join("") +
      "</div>"
    );
  }

  function op(kind, code, note) {
    return { __op: true, kind: kind, code: code, note: note };
  }

  function dfSplit(split) {
    return (
      '<div class="df-split"><b>' +
      esc(split.title) +
      '</b><div class="df-row">' +
      split.nodes
        .map((n) => (n && n.__op ? dfOp(n) : dfNode(n)))
        .join("") +
      "</div></div>"
    );
  }

  function dfStage(stage, index) {
    const cls = stage.loop ? " df-stage-loop" : "";
    return (
      '<section class="df-stage' +
      cls +
      '" id="' +
      esc(stage.id || "df-stage-" + index) +
      '">' +
      '<span class="df-no">' +
      String(index + 1).padStart(2, "0") +
      "</span>" +
      '<span class="df-stage-kicker">' +
      esc(stage.kicker || "") +
      "</span>" +
      '<strong class="df-stage-title">' +
      esc(stage.title) +
      "</strong>" +
      (stage.note ? "<p>" + esc(stage.note) + "</p>" : "") +
      dfRow(stage.nodes) +
      (stage.split ? dfSplit(stage.split) : "") +
      (stage.drop ? '<div class="df-drop">' + stage.drop + "</div>" : "") +
      "</section>"
    );
  }

  // --- 条件变量表：固定条件 vs 每步变化状态 -------------------------------
  function dfCondTable(spec) {
    if (!spec.conditions || !spec.conditions.length) return "";
    const rows = spec.conditions
      .map(
        (c) =>
          "<tr><td><code>" +
          esc(c.name) +
          "</code></td><td>" +
          esc(c.where) +
          "</td><td>" +
          esc(c.fixed) +
          "</td><td>" +
          esc(c.read) +
          "</td></tr>",
      )
      .join("");
    return (
      '<div class="df-cond-panel"><h3>条件与状态：哪些是固定条件，哪些每一步都在变</h3>' +
      "<p>" +
      rich(spec.conditionsNote || "") +
      "</p>" +
      '<div class="df-cond-table"><table><thead><tr><th>变量</th><th>在哪一步产生</th><th>是否每次循环重新计算</th><th>在主干里被谁读取</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div>"
    );
  }

  // --- 多步循环图：当前状态 → 主干预测 → solver → 下一状态 → 回到哪一层 ----
  function dfLoop(loop) {
    const body = loop.steps
      .map((s) => dfRow(s))
      .join("");
    return (
      '<div class="df-loop-box"><div class="df-loop-head"><b>' +
      esc(loop.title) +
      "</b><code>" +
      esc(loop.counter) +
      "</code></div>" +
      body +
      '<div class="df-return">' +
      loop.ret +
      "</div></div>"
    );
  }

  // --- 论文 / 实现来源表：区分论文结论与 checkpoint 实现 -------------------
  function dfSources(spec) {
    if (!spec.sources || !spec.sources.length) return "";
    const rows = spec.sources
      .map(
        (s) =>
          "<tr><td>" +
          esc(s.item) +
          "</td><td>" +
          s.links +
          "</td><td>" +
          rich(s.evidence) +
          "</td></tr>",
      )
      .join("");
    return (
      '<div class="df-cond-panel"><h3>论文与 checkpoint 对照：哪些结论有依据</h3>' +
      "<p>论文说明设计与训练结论，官方代码 / config 说明某个 checkpoint 的实际形状；“未核实”的部分必须按最后一列给出的字段核对，不能按推测填写。</p>" +
      '<div class="df-cond-table"><table><thead><tr><th>结论 / 变量</th><th>来源</th><th>能证实到什么程度</th></tr></thead><tbody>' +
      rows +
      "</tbody></table></div></div>"
    );
  }

  function dfUnknown(spec) {
    if (!spec.unknown || !spec.unknown.length) return "";
    return (
      '<div class="df-unknown"><strong>未公开 / 需按 checkpoint 核验的边界（不得当作已知事实）</strong><ul><li>' +
      spec.unknown.map((u) => rich(u)).join("</li><li>") +
      "</li></ul></div>"
    );
  }

  function dfCost(spec) {
    if (!spec.cost) return "";
    return '<div class="df-cost"><b>计算与显存</b> ' + spec.cost + "</div>";
  }

  function dfSkeleton(spec) {
    if (!spec.skeleton) return "";
    return (
      '<div class="df-sk"><div class="df-sk-head">' +
      esc(spec.skeleton.title) +
      "<small>" +
      esc(spec.skeleton.note) +
      "</small></div>" +
      spec.skeleton.svg +
      "</div>"
    );
  }

  // --- 模块详情弹窗（只服务真正含多层网络的模块） -------------------------
  function dfModal() {
    const modal = document.createElement("dialog");
    modal.className = "ia-modal df-modal";
    modal.innerHTML =
      '<div class="ia-modal-card"><button type="button" class="ia-modal-close" aria-label="关闭模块说明">×</button><div class="ia-modal-kicker"></div><h2></h2><p class="ia-modal-meta"></p><div class="ia-module-diagram" aria-label="模块内部结构图"></div><div class="ia-modal-grid"><div><strong>输入张量</strong><p data-df="input"></p></div><div><strong>输出张量</strong><p data-df="output"></p></div><div><strong>作用</strong><p data-df="role"></p></div><div><strong>何时重复</strong><p data-df="repeat"></p></div></div><div data-df="extra"></div></div>';
    document.body.append(modal);
    modal.querySelector(".ia-modal-close").addEventListener("click", () =>
      modal.close(),
    );
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });
    return modal;
  }

  // --- 通用模块的完整结构（gn-*） -----------------------------------------
  // 有一类模块属于“通用模块”（时间因果视频 VAE、音频 VAE、多模态条件编码器、
  // CLIP/T5 文本编码器、单流 AdaLN 主干……），checkpoint 只公开压缩率或“取第 N 层”
  // 这类事实，不公开逐层结构。这里统一按通用参考实现画出完整网络，并放进虚线框：
  // 虚线框表示“框内就是一个完整结构”，而不是“未公开的示意图”。
  // mermaid 源码由站点内置的 mermaid-lite.js 渲染，同时保留源码供复制。
  function gnBlock(spec) {
    if (!spec || !spec.mermaid) return "";
    return (
      '<div class="gn-frame">' +
      '<div class="gn-frame-head"><div><strong>完整结构 · ' +
      esc(spec.title) +
      "</strong><small>" +
      rich(spec.note || "") +
      "</small></div><span class=\"gn-badge\">虚线框内＝一个完整结构</span></div>" +
      '<pre class="mermaid-lite" data-ml-label="' +
      esc(spec.title) +
      '">' +
      esc(spec.mermaid) +
      "</pre>" +
      (spec.facts ? '<p class="gn-note">' + spec.facts + "</p>" : "") +
      (spec.table
        ? '<div class="table-wrap"><table><thead><tr>' +
          spec.table.head
            .map(function (cell) {
              return "<th>" + cell + "</th>";
            })
            .join("") +
          "</tr></thead><tbody>" +
          spec.table.rows
            .map(function (row) {
              return (
                "<tr>" +
                row
                  .map(function (cell) {
                    return "<td>" + cell + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("") +
          "</tbody></table></div>"
        : "") +
      '<p><a class="gn-link" href="' +
      esc(spec.linkHref || "index.html#generic-structure") +
      '" target="_blank" rel="noopener">' +
      esc(spec.linkText || "通用模块图鉴：整机结构（U-Net / DiT / VAE / 文本塔）→") +
      "</a></p></div>"
    );
  }

  // --- 通用模块结构库（可被模块弹窗和正文插槽共用） -------------------------
  // 页面正文里写 <div data-generic="image-vae"></div> 即可插入同一张完整结构图，
  // 避免同一张图在正文和弹窗里出现两种不一致的画法。
  const genericStructures = {
    "image-vae": {
      title: "图像 VAE（AutoencoderKL）",
      note:
        "图像 VAE 的结构在 checkpoint 里可以直接读到（SDXL：block_out_channels=[128,256,512,512]、layers_per_block=2、latent_channels=4、scaling_factor=0.13025），所以框内是带具体数字的完整结构，不是“未公开的示意”。",
      mermaid: [
        "flowchart TD",
        '  x["RGB 图像 x<br/>[B,3,H,W]"]:::in --> cin["conv_in（3→128, 3×3）<br/>[B,128,H,W]"]:::core',
        '  cin --> e1["Encoder Down1：2×ResnetBlock2D<br/>+ Downsample2D<br/>[B,128,H/2,W/2]"]:::core',
        '  e1 --> e2["Encoder Down2：2×ResnetBlock2D<br/>+ Downsample2D<br/>[B,256,H/4,W/4]"]:::core',
        '  e2 --> e3["Encoder Down3：2×ResnetBlock2D<br/>+ Downsample2D<br/>[B,512,H/8,W/8]"]:::core',
        '  e3 --> e4["Encoder Down4：2×ResnetBlock2D（不再下采样）<br/>[B,512,H/8,W/8]"]:::core',
        '  e4 --> mid["Mid block：ResnetBlock2D + Self-Attention + ResnetBlock2D<br/>[B,512,H/8,W/8]"]:::attn',
        '  mid --> cout["conv_norm_out + SiLU + conv_out（512→2C）<br/>+ quant_conv（1×1 卷积）"]:::core',
        '  cout --> head["μ, logσ² [B,4,H/8,W/8]"]:::out',
        '  head --> sample["z = μ + σ ⊙ ε，再乘 scaling_factor<br/>（SDXL：0.13025）"]:::op',
        '  sample --> pack["按主干取用：U-Net 直接用 [B,4,H/8,W/8]<br/>DiT 类：2×2 pack → [B,N,4·p²] token"]:::latent',
        '  sample --> dec["Decoder：post_quant_conv → conv_in<br/>Mid block → 4×（Upsample2D + 3×ResnetBlock2D）<br/>每级拼接同尺度 skip"]:::core',
        '  dec --> dout["conv_norm_out + SiLU + conv_out（128→3）→ tanh<br/>[B,3,H,W]"]:::out',
        "  e3 -.->|skip| dec",
        "  e2 -.->|skip| dec",
        "  e1 -.->|skip| dec",
      ].join("\n"),
      facts:
        "<b>为什么解码器每级是 3 个 ResnetBlock：</b>编码器每级输出 2 个 ResnetBlock 的结果，解码器要在同一级把 <code>torch.cat([up_feature, skip], dim=1)</code> 接回来后继续计算，所以 Diffusers 的 <code>UpDecoderBlock2D</code> 默认是 <code>layers_per_block + 1 = 3</code> 个 ResnetBlock。<b>必须按 checkpoint 读的部分：</b>latent 通道（SDXL 是 4，SD3 / FLUX / Qwen-Image 是 16）、<code>scaling_factor</code>、通道数与每级 block 数。",
      linkHref: "index.html#atlas-image-vae",
      linkText: "通用模块图鉴 14：图像 VAE 的完整张量级结构 →",
    },
    "unet-tensor": {
      title: "SDXL U-Net（张量级，含 skip 合流）",
      note:
        "以 1024×1024 → latent 128×128 为例，按 stable-diffusion-xl-base-1.0 的 unet/config.json 画出 Down / Mid / Up 的逐级张量形状；橙色虚线是 skip feature 的搬运，Up block 内部先 cat 再投影。",
      mermaid: [
        "flowchart TD",
        '  x["latent z_t [B,4,128,128]<br/>+ t（time embedding）+ c_text [B,77,2048]"]:::in --> cin["conv_in 3×3<br/>[B,320,128,128]"]:::core',
        '  cin --> d0["down_block_0 · DownBlock2D<br/>2×ResnetBlock2D（无 cross-attn、不下采样）<br/>skip0 [B,320,128,128]"]:::norm',
        '  d0 --> d1["down_block_1 · CrossAttnDownBlock2D<br/>2×（Resnet → Self-Attn → Cross-Attn → Resnet）<br/>skip1 [B,640,64,64] → Downsample2D"]:::attn',
        '  d1 --> d2["down_block_2 · CrossAttnDownBlock2D<br/>2×（Resnet → Self-Attn → Cross-Attn → Resnet）<br/>skip2 [B,1280,32,32]（最后一层不下采样）"]:::attn',
        '  d2 --> mid["mid_block · UNetMidBlock2DCrossAttn<br/>Resnet → Self-Attn → Cross-Attn → Resnet<br/>[B,1280,32,32]"]:::attn',
        '  mid --> u0["up_block_0 · CrossAttnUpBlock2D<br/>cat(mid, skip2) = 2560 → conv_shortcut → 3×（Resnet + Cross-Attn）<br/>Upsample2D → [B,1280,64,64]"]:::core',
        '  u0 --> u1["up_block_1 · CrossAttnUpBlock2D<br/>cat(up0, skip1) = 1920 → 3×（Resnet + Cross-Attn）<br/>Upsample2D → [B,640,128,128]"]:::core',
        '  u1 --> u2["up_block_2 · CrossAttnUpBlock2D<br/>cat(up1, skip0) = 960 → 3×（Resnet + Cross-Attn）<br/>最后一层不上采样 → [B,320,128,128]"]:::core',
        '  u2 --> cout["conv_norm_out + SiLU + conv_out 3×3<br/>eps / v [B,4,128,128]（与 z_t 同形状）"]:::out',
        "  d2 -.->|skip2 1280@32| u0",
        "  d1 -.->|skip1 640@64| u1",
        "  d0 -.->|skip0 320@128| u2",
      ].join("\n"),
      facts:
        "<b>三处最容易写错的地方：</b>① Up block 每级是 <code>layers_per_block + 1 = 3</code> 个 Resnet（要接住同尺度 skip），Down block 只有 2 个；② skip 是<b>沿通道维拼接</b>（<code>torch.cat([up, skip], dim=1)</code>），拼接后的通道数先被第一层 Resnet 的 <code>conv_shortcut</code> 投回该级宽度，再走残差，<b>不是逐元素相加</b>；③ <code>c_text</code> 只在含 cross-attn 的 block 里作为 K/V 被读取，<code>t</code> 与 pooled 条件经 time embedding 以 scale/shift 注入每个 Resnet。分辨率变化只由 <code>Downsample2D</code> / <code>Upsample2D</code> 承担。",
      table: {
        head: ["对比项", "SDXL（3 down / 3 up）", "SD 1.5（4 down / 4 up）"],
        rows: [
          [
            "block 类型",
            "<code>down=[DownBlock2D, CrossAttnDownBlock2D, CrossAttnDownBlock2D]</code>",
            "<code>down=[CrossAttnDownBlock2D ×3, DownBlock2D]</code>（最后一级无 cross-attn）",
          ],
          [
            "通道",
            "<code>block_out_channels=[320,640,1280]</code>；up 通道 <code>[1280,640,320]</code>",
            "<code>block_out_channels=[320,640,1280,1280]</code>；up 通道 <code>[1280,1280,640,320]</code>",
          ],
          [
            "空间链",
            "128 → 64 → 32，再 32 → 64 → 128",
            "128 → 64 → 32 → 16，再 16 → 32 → 64 → 128",
          ],
          [
            "文本条件",
            "<code>c_text [B,77,2048]</code>（CLIP-L + bigG）+ <code>pooled [B,1280]</code> + added time/size ids",
            "<code>c_text [B,77,768]</code>（只有 CLIP-L），没有 pooled 条件",
          ],
          [
            "<code>cross_attention_dim</code>",
            "2048",
            "768",
          ],
        ],
      },
      linkHref: "index.html#atlas-unet",
      linkText: "通用模块图鉴 12：U-Net 的多尺度 skip 结构怎么读 →",
    },
    "dit-tensor": {
      title: "SD3.5-large MMDiT 主干（张量级）",
      note:
        "以 1024×1024 → 16 通道 latent 128×128、patch 2 为例，按 SD3.5-large 的 transformer/config.json 画出从 patch 化到 velocity 输出的完整主干；图像流与文本流只在每个 block 的 attention 内部沿序列维合并。",
      mermaid: [
        "flowchart TD",
        '  x["latent z_t [B,16,128,128]<br/>+ t / sigma + pooled [B,2048]"]:::in --> p["PatchEmbed 2×2：每块 16×2×2 = 64 个数<br/>[B,4096,64] → Linear → [B,4096,2432]<br/>+ 位置编码（pos_embed_max_size=192，按网格插值）"]:::core',
        '  c["文本条件 c<br/>CLIP-L 768 与 CLIP-G 1280 → concat(channel) → [B,77,2048]<br/>T5-XXL 4096 → 拼接 → context_embedder → [B,N_txt,2432]"]:::cond --> b',
        '  p --> b["JointTransformerBlock ×38（D=2432 = heads 38 × head_dim 64）<br/>每个 block：图像 to_q/k/v、文本 add_q/k/v 各自投影<br/>→ concat(seq) 做一次联合 attention → split(seq)"]:::attn',
        '  b --> n["norm_out（AdaLN，由 t + pooled 生成 scale/shift）<br/>→ proj_out（2432 → 64）<br/>[B,4096,64]"]:::out',
        '  n --> unp["Unpatchify 2×2：每个 token 还原成一个 patch<br/>velocity [B,16,128,128]"]:::out',
        '  unp --> s["solver 更新 → z_{t-1}<br/>回到第 1 个 block；条件 c 只在循环外编码一次，每步重新读取"]:::op',
      ].join("\n"),
      facts:
        "<b>读这张图先分清三件事：</b>① 主干只用图像 token 走输出头——文本 token 参与 attention，但不进 <code>proj_out</code>；② <code>N_img = (H/8/p) × (W/8/p)</code>，分辨率翻倍 token 数变 4 倍，是显存和训练分布的主要约束；③ 时间步与 pooled 条件走 <b>AdaLN 调制</b>，<code>c_text</code> 走 attention 的 K/V，两条入口不能互换。图中数字来自 SD3.5-large；SD3-medium 等变体的层数、宽度与文本编码器组合不同，必须重读 <code>transformer/config.json</code>。",
      linkHref: "index.html#basics-patchify",
      linkText: "基础知识 §2：patchify / token 数与 DiT 主干 →",
    },
    "dit-block": {
      title: "MMDiT 单个 JointTransformerBlock 内部（张量级）",
      note:
        "38 个 block 同构，差别只在最后一个 block 不再计算文本侧 FFN（<code>context_pre_only</code>）。框内是 Diffusers 官方实现的真实顺序：双流各自投影 → 序列维拼接 → 一次联合 attention → 拆流 → 各自 FFN。",
      mermaid: [
        "flowchart TD",
        '  i["image x [B,4096,2432] ｜ text c [B,N_txt,2432]"]:::in --> n1["norm1 / norm1_context（AdaLN-Zero）<br/>由 t + pooled 生成 scale / shift / gate"]:::norm',
        '  n1 --> qkv["图像：to_q / to_k / to_v → Q_i,K_i,V_i [B,38,4096,64]<br/>文本：add_q_proj / add_k_proj / add_v_proj → Q_t,K_t,V_t [B,38,N_txt,64]"]:::core',
        '  qkv --> rms["qk_norm = rms_norm：只作用在 Q / K 上"]:::op',
        '  rms --> cat["concat(seq, dim=2)：Q = [Q_i ‖ Q_t]，K、V 同理<br/>[B,38,4096+N_txt,64]"]:::latent',
        '  cat --> attn["softmax(QKᵀ/√64)·V（一次联合 attention）<br/>→ flatten → [B,4096+N_txt,2432]"]:::attn',
        '  attn --> sp["split(seq)：image = [:, :4096]，text = [:, 4096:]"]:::op',
        '  sp --> r1["图像 to_out[0] → residual add；文本 to_add_out → residual add<br/>x₁ = x + Attn(x)、c₁ = c + Attn(c)"]:::core',
        '  r1 --> ff["各自 norm2 → FFN（2432 → 9728 → 2432，GELU）→ residual add<br/>最后一个 block 只算图像侧"]:::core',
        '  ff --> o["更新后的 image / text token，形状不变<br/>送入下一个 block"]:::out',
      ].join("\n"),
      facts:
        "<b>图中只有三处 “+”，而且都是逐元素相加：</b>AdaLN 的残差、attention 输出投影后的残差、FFN 后的残差——三者都要求形状完全相同。跨模态交换信息只发生在 <code>concat(seq)</code> 之后的那一次 attention 里：文本不是被广播给每个图像 token，而是作为 K/V 被读取；最后一个 block 之后只取图像 token 走 <code>norm_out</code> + <code>proj_out</code>。",
      linkHref: "index.html#atlas-dit",
      linkText: "通用模块图鉴 13：DiT / 联合注意力与条件路径 →",
    },
  };

  function dfBindModules(host, spec) {
    const buttons = host.querySelectorAll("[data-df-module]");
    if (!buttons.length) return;
    const modal = dfModal();
    buttons.forEach((button) => {
      const openModule = () => {
        const detail = spec.modules[button.dataset.dfModule];
        if (!detail) return;
        modal.querySelector(".ia-modal-kicker").textContent =
          (spec.modalKicker || "模块内部结构") + " · 点击项可展开的多层网络";
        modal.querySelector("h2").textContent = detail.title;
        modal.querySelector(".ia-modal-meta").textContent = detail.meta || "";
        modal.querySelector(".ia-module-diagram").innerHTML =
          (detail.diagram || "") + gnBlock(detail.generic);
        ["input", "output", "role", "repeat"].forEach((field) => {
          const target = modal.querySelector('[data-df="' + field + '"]');
          target.textContent = (detail[field] || []).join(" ");
        });
        const extra = modal.querySelector('[data-df="extra"]');
        extra.innerHTML = detail.extra
          ? '<p class="df-modal-lab">' + detail.extraTitle + "</p><p>" + detail.extra + "</p>"
          : "";
        if (typeof modal.showModal === "function") modal.showModal();
        else modal.setAttribute("open", "");
        if (window.MermaidLite) window.MermaidLite.renderAll(modal);
        if (window.MathLite) window.MathLite.renderIn(modal);
      };
      button.addEventListener("click", openModule);
      if (button.tagName.toLowerCase() !== "button") {
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openModule();
          }
        });
      }
    });
  }

  // --- U-Net 骨架 SVG：Down 保存 skip → Mid → Up 按通道拼接 -----------------
  // 供模块详情与页面正文复用；SD 1.5 与 SDXL 的 down/up block 数量不同，必须分开画。
  function unetSvg(variant) {
    const sd15 = variant === "sd15";
    const W = 1180;
    const H = sd15 ? 520 : 452;
    const rows = sd15
      ? [
          { name: "down_block_0 (CrossAttnDownBlock2D)", shape: "[B,320,128,128]", sub: "含 cross-attn · downsampler" },
          { name: "down_block_1 (CrossAttnDownBlock2D)", shape: "[B,640,64,64]", sub: "含 cross-attn · downsampler" },
          { name: "down_block_2 (CrossAttnDownBlock2D)", shape: "[B,1280,32,32]", sub: "含 cross-attn · downsampler" },
          { name: "down_block_3 (DownBlock2D)", shape: "[B,1280,16,16]", sub: "无 cross-attn · 无 downsampler" },
        ]
      : [
          { name: "down_block_0 (DownBlock2D)", shape: "[B,320,128,128]", sub: "无 cross-attn · downsampler" },
          { name: "down_block_1 (CrossAttnDownBlock2D)", shape: "[B,640,64,64]", sub: "含 cross-attn · downsampler" },
          { name: "down_block_2 (CrossAttnDownBlock2D)", shape: "[B,1280,32,32]", sub: "含 cross-attn · 无 downsampler" },
        ];
    const upRows = (sd15
      ? [
          ["up_block_0 (UpBlock2D)", "[B,1280,16,16]→[B,1280,32,32]"],
          ["up_block_1 (CrossAttnUpBlock2D)", "[B,1280,32,32]→[B,1280,64,64]"],
          ["up_block_2 (CrossAttnUpBlock2D)", "[B,1280,64,64]→[B,640,128,128]"],
          ["up_block_3 (CrossAttnUpBlock2D)", "[B,640,128,128]→[B,320,128,128]"],
        ]
      : [
          ["up_block_0 (CrossAttnUpBlock2D)", "[B,1280,32,32]→[B,1280,64,64]"],
          ["up_block_1 (CrossAttnUpBlock2D)", "[B,1280,64,64]→[B,640,128,128]"],
          ["up_block_2 (CrossAttnUpBlock2D)", "[B,640,128,128]→[B,320,128,128]"],
        ]);
    const y0 = 44;
    const dy = 46;
    const midY = y0 + rows.length * dy + 8;
    const midH = 58;
    const upY0 = midY + midH + 20;
    let svg =
      '<svg class="df-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      (sd15 ? "SD 1.5" : "SDXL") +
      ' U-Net 张量流与 skip 合流">' +
      '<defs><marker id="un-ah-' + variant + '" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto"><path d="M0,0 L8,3.2 L0,6.4 z" fill="#c4863f"/></marker>' +
      '<marker id="un-fl-' + variant + '" markerWidth="9" markerHeight="9" refX="7" refY="3.2" orient="auto"><path d="M0,0 L8,3.2 L0,6.4 z" fill="#5b8f7c"/></marker></defs>' +
      '<text class="df-svg-t" x="16" y="20">' + (sd15 ? "SD 1.5 · UNet2DConditionModel" : "SDXL · UNet2DConditionModel") + "</text>" +
      '<text class="df-svg-s" x="16" y="36">Down path 保存 skip feature　→　Mid 全局混合　→　Up path 按通道拼接 skip　｜　c_text ' +
      (sd15 ? "[B,77,768]" : "[B,77,2048]") +
      " 只在含 cross-attn 的 block 被读取</text>";
    rows.forEach((row, i) => {
      const y = y0 + i * dy;
      svg +=
        '<rect class="df-svg-rect df-svg-rect-down" x="30" y="' + y + '" width="392" height="38" rx="7"/>' +
        '<text class="df-svg-t" x="44" y="' + (y + 17) + '">' + row.name + "</text>" +
        '<text class="df-svg-s" x="44" y="' + (y + 31) + '">' + row.shape + " · " + row.sub + "</text>";
      if (i < rows.length - 1) {
        svg += '<line class="df-svg-flow" x1="226" y1="' + (y + 38) + '" x2="226" y2="' + (y + dy - 1) + '" marker-end="url(#un-fl-' + variant + ')"/>';
      }
    });
    svg +=
      '<line class="df-svg-flow" x1="226" y1="' + (y0 + rows.length * dy - 8) + '" x2="226" y2="' + (midY - 1) + '" marker-end="url(#un-fl-' + variant + ')"/>' +
      '<rect class="df-svg-rect df-svg-rect-mid" x="30" y="' + midY + '" width="392" height="' + midH + '" rx="7"/>' +
      '<text class="df-svg-t" x="44" y="' + (midY + 18) + '">mid_block (UNetMidBlock2DCrossAttn)</text>' +
      '<text class="df-svg-s" x="44" y="' + (midY + 32) + '">ResNet → Self-Attention → Cross-Attention → ResNet</text>' +
      '<text class="df-svg-s" x="44" y="' + (midY + 46) + '">最低分辨率，跨空间位置混合全局信息</text>' +
      '<line class="df-svg-flow" x1="226" y1="' + (midY + midH) + '" x2="226" y2="' + (upY0 - 1) + '" marker-end="url(#un-fl-' + variant + ')"/>';
    upRows.forEach((row, i) => {
      const y = upY0 + i * dy;
      svg +=
        '<rect class="df-svg-rect df-svg-rect-up" x="688" y="' + y + '" width="462" height="38" rx="7"/>' +
        '<text class="df-svg-t" x="702" y="' + (y + 17) + '">' + row[0] + "</text>" +
        '<text class="df-svg-s" x="702" y="' + (y + 31) + '">' + row[1] + "</text>";
      if (i < upRows.length - 1) {
        svg += '<line class="df-svg-flow" x1="919" y1="' + (y + 38) + '" x2="919" y2="' + (y + dy - 1) + '" marker-end="url(#un-fl-' + variant + ')"/>';
      }
    });
    // skip 折线：down 输出 → 右侧纵向搬运 → up 输入
    const skipPairs = sd15
      ? [
          { down: 0, up: 3 },
          { down: 1, up: 2 },
          { down: 2, up: 1 },
        ]
      : [
          { down: 0, up: 2 },
          { down: 1, up: 1 },
          { down: 2, up: 0 },
        ];
    const busX = 646;
    skipPairs.forEach((pair) => {
      const yFrom = y0 + pair.down * dy + 19;
      const yTo = upY0 + pair.up * dy + 19;
      svg +=
        '<polyline class="df-svg-sk" points="422,' + yFrom + " " + busX + "," + yFrom + " " + busX + "," + yTo + " 684," + yTo + '" marker-end="url(#un-ah-' + variant + ')"/>';
    });
    ['concat(channel)', 'residual add'].forEach((label, i) => {
      svg +=
        '<text class="df-svg-lbl" x="' + (busX + 12) + '" y="' + (upY0 + upRows.length * dy + 22 + i * 14) + '">' +
        (i === 0 ? "橙色折线 = skip 搬运" : "") +
        "</text>";
    });
    const footY = upY0 + upRows.length * dy + 14;
    svg +=
      '<text class="df-svg-lbl" x="' + (busX + 10) + '" y="' + (upY0 + 19) + '">skip feature</text>' +
      '<text class="df-svg-s" x="' + (busX + 10) + '" y="' + (upY0 + 33) + '">不是相加</text>' +
      '<rect class="df-svg-rect df-svg-rect-io" x="30" y="' + (H - 36) + '" width="392" height="28" rx="7"/>' +
      '<text class="df-svg-t" x="44" y="' + (H - 17) + '">输入 conv_in(z_t) [B,4,128,128]（1024×1024 示例）</text>' +
      '<rect class="df-svg-rect df-svg-rect-io" x="688" y="' + (H - 36) + '" width="462" height="28" rx="7"/>' +
      '<text class="df-svg-t" x="702" y="' + (H - 17) + '">conv_out → eps / v [B,4,128,128]（与 z_t 同形状）</text>' +
      "</svg>";
    return svg;
  }

  // ===========================================================================
  // 完整网络结构图（ns-*）：像 mermaid 一样把整张网络自上而下/自左而右画全，
  // 每个格子里都是“模块名 + 输入尺寸 + 输出尺寸”，复杂模块可点击看内部结构。
  // 所有尺寸由下面的 block 定义推导，避免手写数字互相矛盾。
  // ===========================================================================

  // 单个 SD/SDXL U-Net 的 block 定义（形状以 1024×1024 → latent 128×128 为例）
  function ddSdxl() {
    return {
      key: "sdxl",
      label: "SDXL U-Net（UNet2DConditionModel）",
      cfgTitle: "SDXL · unet/config.json（stable-diffusion-xl-base-1.0）",
      cfgLines: [
        "block_out_channels = [320, 640, 1280]",
        "down_block_types = [DownBlock2D, CrossAttnDownBlock2D ×2]",
        "up_block_types = [CrossAttnUpBlock2D ×2, UpBlock2D]",
        "layers_per_block = 2；transformer_layers_per_block = [1, 2, 10]",
        "cross_attention_dim = 2048；attention_head_dim = [5, 10, 20]；sample_size = 128",
      ],
      inputLit: "z_t  [B, 4, 128, 128]",
      inputSub: "conv_in（3×3）→ [B, 320, 128, 128]",
      midLabel: "15 · mid_block（UNetMidBlock2DCrossAttn）",
      midIn: "[B, 1280, 16, 16]",
      midRes: "ResNet → Cross-Attn → ResNet",
      midOut: "[B, 1280, 16, 16]",
      downBlocks: [
        {
          id: "d0", h: 0, title: "9 · down_block_0", cls: "DownBlock2D", clsShort: "DownBlock2D",
          attn: false, dsp: false, layers: 2,
          layersDetail: ["ResnetBlock2D [B,320,128,128] → [B,320,128,128]", "ResnetBlock2D [B,320,128,128] → [B,320,128,128]"],
          inShape: "320,128,128", outShape: "320,128,128",
          out: "[B, 320, 128, 128]", note: "没有 cross-attention、没有下采样",
        },
        {
          id: "d1", h: 1, title: "10 · down_block_1", cls: "CrossAttnDownBlock2D", clsShort: "CrossAttn + Down",
          attn: true, dsp: true, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,320,128,128] → [B,640,128,128]",
            "Cross-Attention（K,V = c_text）[B,640,128,128] → [B,640,128,128]",
            "ResnetBlock2D [B,640,128,128] → [B,640,128,128]",
            "Cross-Attention [B,640,128,128] → [B,640,128,128]",
          ],
          inShape: "320,128,128", outShape: "640,64,64",
          out: "[B, 640, 64, 64]", note: "含 cross-attention + Downsample2D（128→64）",
        },
        {
          id: "d2", h: 1, title: "11 · down_block_2", cls: "CrossAttnDownBlock2D", clsShort: "CrossAttn + Down",
          attn: true, dsp: true, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,640,64,64] → [B,1280,64,64]",
            "Cross-Attention [B,1280,64,64] → [B,1280,64,64]",
            "ResnetBlock2D [B,1280,64,64] → [B,1280,64,64]",
            "Cross-Attention [B,1280,64,64] → [B,1280,64,64]",
          ],
          inShape: "640,64,64", outShape: "1280,32,32",
          out: "[B, 1280, 32, 32]", note: "含 cross-attention + Downsample2D（64→32）",
        },
      ],
      upBlocks: [
        {
          id: "u0", h: 1, title: "16 · up_block_0", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: true, layers: 3,
          layersDetail: [
            "拼接：up_input [B,1280,32,32] ‖ skip_2 [B,1280,32,32] → [B,2560,32,32]",
            "ResnetBlock2D [B,2560,32,32] → [B,1280,32,32]（conv_shortcut 投影）",
            "Cross-Attention [B,1280,32,32] → [B,1280,32,32]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "1280,32,32", outShape: "1280,64,64",
          out: "[B, 1280, 64, 64]", note: "取用 skip_2；含 cross-attention + Upsample2D（32→64）",
        },
        {
          id: "u1", h: 1, title: "17 · up_block_1", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: true, layers: 3,
          layersDetail: [
            "拼接：up_input [B,1280,64,64] ‖ skip_1 [B,640,64,64] → [B,1920,64,64]",
            "ResnetBlock2D [B,1920,64,64] → [B,640,64,64]",
            "Cross-Attention [B,640,64,64] → [B,640,64,64]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "1280,64,64", outShape: "640,64,64",
          out: "[B, 640, 64, 64]", note: "取用 skip_1；含 cross-attention + Upsample2D（64→128）",
        },
        {
          id: "u2", h: 1, title: "18 · up_block_2", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: false, layers: 3,
          layersDetail: [
            "拼接：up_input [B,640,128,128] ‖ skip_0 [B,320,128,128] → [B,960,128,128]",
            "ResnetBlock2D [B,960,128,128] → [B,320,128,128]",
            "Cross-Attention [B,320,128,128] → [B,320,128,128]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "640,128,128", outShape: "320,128,128",
          out: "[B, 320, 128, 128]", note: "取用 skip_0；含 cross-attention，无上采样",
        },
      ],
      attnNoteLines: [
        "含 cross-attention：down_block_1、down_block_2、mid_block、up_block_0、up_block_1",
        "不含 cross-attention：down_block_0（DownBlock2D）、up_block_2（UpBlock2D）",
        "SDXL 只有 2 个 downsampler（在 down_block_0 / down_block_1 末尾），所以空间尺寸是 128→64→32（mid 在 32×32 = h/4），再按 32→64→128 回到原尺寸；注意力内部的 BasicTransformerBlock 个数为 2（640 级）与 10（1280 级与 mid）",
      ],
      outLabel: "19 · conv_out（3×3）→ [B, 4, 128, 128]（与 z_t 同形状的 epsilon / v）",
    };
  }

  function ddSd15() {
    return {
      key: "sd15",
      label: "SD 1.5 U-Net（UNet2DConditionModel）",
      cfgTitle: "SD 1.5 · unet/config.json（stable-diffusion-v1-5）",
      cfgLines: [
        "block_out_channels = [320, 640, 1280, 1280]",
        "down_block_types = [CrossAttnDownBlock2D ×3, DownBlock2D]",
        "up_block_types = [UpBlock2D, CrossAttnUpBlock2D ×3]",
        "layers_per_block = 2；attention_head_dim = 8（所有层相同）",
        "cross_attention_dim = 768；sample_size = 64（512×512 训练）",
      ],
      inputLit: "z_t  [B, 4, 128, 128]",
      inputSub: "conv_in（3×3）→ [B, 320, 128, 128]（按 1024×1024 换算；512×512 时 latent 为 64×64）",
      midLabel: "13 · mid_block（UNetMidBlock2DCrossAttn）",
      midIn: "[B, 1280, 16, 16]",
      midRes: "ResNet → Cross-Attn → ResNet",
      midOut: "[B, 1280, 16, 16]",
      downBlocks: [
        {
          id: "d0", h: 0, title: "5 · down_block_0", cls: "CrossAttnDownBlock2D", clsShort: "CrossAttn + Down",
          attn: true, dsp: true, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,320,128,128] → [B,320,128,128]",
            "Cross-Attention（K,V = c_text [B,77,768]）",
            "ResnetBlock2D [B,320,128,128] → [B,320,128,128]",
            "Cross-Attention",
          ],
          inShape: "320,128,128", outShape: "320,64,64",
          out: "[B, 320, 64, 64]", note: "含 cross-attention + Downsample2D（128→64）",
        },
        {
          id: "d1", h: 1, title: "6 · down_block_1", cls: "CrossAttnDownBlock2D", clsShort: "CrossAttn + Down",
          attn: true, dsp: true, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,320,64,64] → [B,640,64,64]",
            "Cross-Attention [B,640,64,64] → [B,640,64,64]",
            "ResnetBlock2D [B,640,64,64] → [B,640,64,64]",
            "Cross-Attention",
          ],
          inShape: "320,64,64", outShape: "640,32,32",
          out: "[B, 640, 32, 32]", note: "含 cross-attention + Downsample2D（64→32）",
        },
        {
          id: "d2", h: 1, title: "7 · down_block_2", cls: "CrossAttnDownBlock2D", clsShort: "CrossAttn + Down",
          attn: true, dsp: true, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,640,32,32] → [B,1280,32,32]",
            "Cross-Attention [B,1280,32,32] → [B,1280,32,32]",
            "ResnetBlock2D [B,1280,32,32] → [B,1280,32,32]",
            "Cross-Attention",
          ],
          inShape: "640,32,32", outShape: "1280,16,16",
          out: "[B, 1280, 16, 16]", note: "含 cross-attention + Downsample2D（32→16）",
        },
        {
          id: "d3", h: 1, title: "8 · down_block_3", cls: "DownBlock2D", clsShort: "DownBlock2D",
          attn: false, dsp: false, layers: 2,
          layersDetail: [
            "ResnetBlock2D [B,1280,16,16] → [B,1280,16,16]",
            "ResnetBlock2D [B,1280,16,16] → [B,1280,16,16]",
            "（无 cross-attention、无 downsampler）",
          ],
          inShape: "1280,16,16", outShape: "1280,16,16",
          out: "[B, 1280, 16, 16]", note: "无 cross-attention、无下采样；输出直接进 mid，所以没有对应的中间 skip",
        },
      ],
      upBlocks: [
        {
          id: "u0", h: 1, title: "14 · up_block_0", cls: "UpBlock2D", clsShort: "UpBlock2D",
          attn: false, usp: true, layers: 3,
          layersDetail: [
            "拼接：up_input [B,1280,16,16] ‖ skip_2 [B,1280,16,16] → [B,2560,16,16]",
            "ResnetBlock2D [B,2560,16,16] → [B,1280,16,16]",
            "ResnetBlock2D → ResnetBlock2D（无 cross-attention）",
            "Upsample2D [B,1280,16,16] → [B,1280,32,32]",
          ],
          inShape: "1280,16,16", outShape: "1280,32,32",
          out: "[B, 1280, 32, 32]", note: "取用 skip_2；无 cross-attention，含上采样（16→32）",
        },
        {
          id: "u1", h: 1, title: "15 · up_block_1", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: true, layers: 3,
          layersDetail: [
            "拼接：up_input [B,1280,32,32] ‖ skip_1 [B,1280,32,32] → [B,2560,32,32]",
            "ResnetBlock2D [B,2560,32,32] → [B,1280,32,32]",
            "Cross-Attention [B,1280,32,32] → [B,1280,32,32]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "1280,32,32", outShape: "1280,64,64",
          out: "[B, 1280, 64, 64]", note: "取用 skip_1；含 cross-attention + 上采样（32→64）",
        },
        {
          id: "u2", h: 1, title: "16 · up_block_2", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: true, layers: 3,
          layersDetail: [
            "拼接：up_input [B,1280,64,64] ‖ skip_0 [B,640,64,64] → [B,1920,64,64]",
            "ResnetBlock2D [B,1920,64,64] → [B,640,64,64]",
            "Cross-Attention [B,640,64,64] → [B,640,64,64]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "1280,64,64", outShape: "640,64,64",
          out: "[B, 640, 64, 64]", note: "取用 skip_0；含 cross-attention + 上采样（64→128）",
        },
        {
          id: "u3", h: 1, title: "17 · up_block_3", cls: "CrossAttnUpBlock2D", clsShort: "CrossAttn + Up",
          attn: true, usp: false, layers: 3,
          layersDetail: [
            "拼接：up_input [B,640,128,128] ‖ skip_down0 [B,320,128,128] → [B,960,128,128]",
            "ResnetBlock2D [B,960,128,128] → [B,320,128,128]",
            "Cross-Attention [B,320,128,128] → [B,320,128,128]",
            "ResnetBlock2D → Cross-Attention → ResnetBlock2D",
          ],
          inShape: "640,128,128", outShape: "320,128,128",
          out: "[B, 320, 128, 128]", note: "取用 down_block_0 的 skip；含 cross-attention，无上采样",
        },
      ],
      attnNoteLines: [
        "含 cross-attention：down_block_0 / 1 / 2、mid_block、up_block_1 / 2 / 3",
        "不含 cross-attention：down_block_3（DownBlock2D）、up_block_0（UpBlock2D）",
        "skip 配对：down_0→up_3、down_1→up_2、down_2→up_1；down_3 的输出进 mid，所以 1.5 的中间 skip 比 SDXL 多一层结构差异",
      ],
      outLabel: "18 · conv_out（3×3）→ [B, 4, 128, 128]（与 z_t 同形状的 epsilon / v）",
    };
  }

  // 由 block 定义推导出“显示用尺寸字符串”（不含 batch 维，B 统一在标题里说明）
  function shapeOf(model, kind, h) {
    if (kind === "mid") return { inShape: "1280,16,16", outShape: "1280,16,16" };
    return null;
  }

  // 单个块节点：标题 + cross-attn 标签 + 输入/输出尺寸 + 备注 + 点击提示
  const NS_W = 252;
  const NS_H = 148;
  function nsBoxNode(model, b, x, y, opts) {
    opts = opts || {};
    const noteLines = wrapNote(b.note, 30);
    return (
      '<g class="ns-block" data-ns-block="' + model.key + ":" + b.id + '" transform="translate(' + x + "," + y + ')">' +
      '<rect class="ns-box' + (opts.boxClass || "") + '" x="0" y="0" width="' + NS_W + '" height="' + NS_H + '" rx="8"/>' +
      '<text class="ns-b" x="12" y="22">' + esc(b.title) + "</text>" +
      (b.attn ? '<text class="ns-tag" x="' + (NS_W - 12) + '" y="22" text-anchor="end">cross-attn</text>' : "") +
      '<text class="ns-s" x="12" y="38">' + esc(b.clsShort || b.cls) + "</text>" +
      '<line class="ns-line" x1="' + NS_W / 2 + '" y1="44" x2="' + NS_W / 2 + '" y2="52"/>' +
      '<rect class="ns-io" x="10" y="52" width="' + (NS_W - 20) + '" height="22" rx="4"/>' +
      '<text class="ns-s" x="20" y="67">in  [B, ' + esc(b.inShape) + "]</text>" +
      '<rect class="ns-io" x="10" y="78" width="' + (NS_W - 20) + '" height="22" rx="4"/>' +
      '<text class="ns-s" x="20" y="93">out [B, ' + esc(b.outShape) + "]</text>" +
      noteLines
        .map(function (l, i) {
          return '<text class="ns-note" x="12" y="' + (110 + i * 13) + '">' + esc(l) + "</text>";
        })
        .join("") +
      '<text class="ns-hint" x="' + NS_W / 2 + '" y="' + (NS_H - 6) + '" text-anchor="middle">点击查看内部逐层尺寸</text>' +
      "</g>"
    );
  }

  // 把备注按字数切成两行，避免在 SVG 里溢出
  function wrapNote(text, maxChars) {
    const t = String(text);
    if (t.length <= maxChars) return [t];
    const cut = t.lastIndexOf("·", maxChars);
    if (cut > 8) return [t.slice(0, cut + 1).trim(), t.slice(cut + 1).trim()];
    return [t.slice(0, maxChars), t.slice(maxChars)];
  }

  // 完整 U-Net 结构图：Down 列 → Mid → Up 列，带 skip 折线与全部张量尺寸
  function nsBuild(model) {
    // 采用响应式 HTML 卡片布局。旧版 SVG 折线在窄窗口会压住卡片文字，
    // 因此把主干顺序与 skip 关系拆成可读的列和列表。
    const card = function (b, kind) {
      return '<button type="button" class="ns-card ns-card-' + kind + (b.attn ? " ns-card-attn" : "") + '" data-ns-block="' + model.key + ':' + b.id + '">' +
        '<span class="ns-card-title">' + esc(b.title) + '</span>' +
        '<span class="ns-card-class">' + esc(b.cls) + (b.attn ? ' <em>cross-attn</em>' : '') + '</span>' +
        '<span class="ns-card-io"><b>in</b> [B, ' + esc(b.inShape) + ']</span>' +
        '<span class="ns-card-io"><b>out</b> [B, ' + esc(b.outShape) + ']</span>' +
        '<span class="ns-card-note">' + esc(b.note) + '</span>' +
        '<span class="ns-card-hint">点击看内部结构</span></button>';
    };
    const arrow = '<div class="ns-column-arrow" aria-hidden="true">↓</div>';
    const mid = '<button type="button" class="ns-card ns-card-mid" data-ns-block="' + model.key + ':mid">' +
      '<span class="ns-card-title">' + esc(model.midLabel) + '</span>' +
      '<span class="ns-card-class">UNetMidBlock2DCrossAttn <em>Self + Cross Attention</em></span>' +
      '<span class="ns-card-io"><b>in</b> ' + esc(model.midIn) + '</span>' +
      '<span class="ns-card-io"><b>out</b> ' + esc(model.midOut) + '</span>' +
      '<span class="ns-card-note">' + esc(model.midRes) + '；最低分辨率做全局混合</span>' +
      '<span class="ns-card-hint">点击看内部结构</span></button>';
    const down = '<section class="ns-board-column"><h4>Down path</h4><p class="ns-board-caption">从高分辨率到低分辨率，保存多尺度 skip</p>' +
      '<div class="ns-edge ns-edge-input"><b>① 输入</b><code>' + esc(model.inputLit) + '</code><small>' + esc(model.inputSub) + '</small></div>' +
      model.downBlocks.map(function (b, i) { return (i ? arrow : '') + card(b, 'down'); }).join('') + '</section>';
    const middle = '<section class="ns-board-column ns-board-column-mid"><h4>Mid</h4><p class="ns-board-caption">最低分辨率的全局语义混合</p><div class="ns-mid-spacer"></div>' + mid + '<p class="ns-board-caption ns-board-mid-note">ResNet → Self-Attn → Cross-Attn → ResNet</p></section>';
    const up = '<section class="ns-board-column"><h4>Up path</h4><p class="ns-board-caption">逐级恢复分辨率，先拼接同尺度 skip</p>' +
      model.upBlocks.map(function (b, i) { return (i ? arrow : '') + card(b, 'up'); }).join('') +
      '<div class="ns-edge ns-edge-output"><b>② 输出</b><code>' + esc(model.outLabel) + '</code></div></section>';
    const pairs = model.key === 'sdxl' ? [[0, 2], [1, 1], [2, 0]] : [[0, 3], [1, 2], [2, 1]];
    let skipRows = pairs.map(function (p, i) {
      const d = model.downBlocks[p[0]];
      const u = model.upBlocks[p[1]];
      return '<div class="ns-skip-row"><span class="ns-skip-badge">skip ' + (i + 1) + '</span><b>' + esc(d.title) + '</b><span class="ns-skip-arrow">→</span><b>' + esc(u.title) + '</b><code>torch.cat(dim=1)</code><small>H/W 对齐后沿通道维拼接</small></div>';
    }).join('');
    if (model.key === 'sd15') {
      const d3 = model.downBlocks[3];
      skipRows += '<div class="ns-skip-row ns-skip-note-row"><span class="ns-skip-badge">说明</span><b>' + esc(d3.title) + '</b><span class="ns-skip-arrow">→</span><b>mid_block</b><small>无对应 skip；输出直接进入 Mid</small></div>';
    }
    return '<div class="ns-board" aria-label="' + esc(model.label) + ' 三列 U-Net 结构图">' +
      '<div class="ns-board-flow"><span>Down</span><b>→</b><span>Mid</span><b>→</b><span>Up</span></div>' +
      '<div class="ns-board-columns">' + down + '<div class="ns-board-connector" aria-hidden="true">→</div>' + middle + '<div class="ns-board-connector" aria-hidden="true">→</div>' + up + '</div>' +
      '<div class="ns-skip-panel"><strong>Skip feature 配对（不是相加）</strong><p>Down 的中间特征被保存；Up 先把当前特征放大到同一 H/W，再与 skip 做 <code>torch.cat(dim=1)</code>，随后由 ResNet 的 shortcut 投影回目标通道数。</p>' + skipRows + '</div></div>';

    /* 旧版 SVG 实现保留在下方作为历史参考，不再执行。 */
    if (false) {
    const COLW = NS_W;
    const n = Math.max(model.downBlocks.length, model.upBlocks.length);
    const ROWH = 158;
    const TOP = 66;
    const ROWS_H = (n - 1) * ROWH + NS_H;
    const xDown = 20;
    const xMid = xDown + COLW + 56;
    const xUp = xMid + COLW + 60;
    const W = xUp + COLW + 16;
    const yTop = TOP;
    const yBot = TOP + ROWS_H;
    const rowY = function (i) {
      return TOP + i * ROWH;
    };
    // Up 列按“从下往上”的数组顺序摆放：第 k 个块放在倒数第 k 行
    const upSlot = function (k) {
      return rowY(n - 1 - k);
    };
    const H = yBot + NS_H + 30;
    const busX = xMid + COLW + 20;
    const midY = rowY(model.downBlocks.length - 1);
    const midH = NS_H + 26;
    const downFlowX = xDown + COLW / 2;
    const upFlowX = xUp + COLW / 2;
    const rowGap = ROWH - NS_H;
    let s =
      '<svg class="ns-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' +
      esc(model.label) + ' 完整结构图">' +
      '<defs><marker id="ns-a-' + model.key + '" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#5b8f7c"/></marker>' +
      '<marker id="ns-s-' + model.key + '" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#c4863f"/></marker></defs>' +
      '<text class="ns-h" x="20" y="18">Down path（从上往下：降采样并保存 skip）</text>' +
      '<text class="ns-h" x="' + xMid + '" y="18">Mid</text>' +
      '<text class="ns-h" x="' + xUp + '" y="18">Up path（从下往上：取用 skip 并恢复分辨率）</text>' +
      '<text class="ns-s" x="20" y="36">阅读：顺箭头 Down → Mid → Up；绿色实线 = 主干数据流，橙色虚线 = skip feature 搬运</text>';
    // 输入行
    s +=
      '<rect class="ns-io ns-io-edge" x="20" y="' + (yTop - 32) + '" width="640" height="30" rx="6"/>' +
      '<text class="ns-b" x="32" y="' + (yTop - 12) + '">① 输入：' + esc(model.inputLit) + "</text>" +
      '<text class="ns-s" x="300" y="' + (yTop - 12) + '">' + esc(model.inputSub) + "</text>" +
      '<line class="ns-flow" x1="' + downFlowX + '" y1="' + (yTop - 2) + '" x2="' + downFlowX + '" y2="' + (rowY(0) - 1) + '" marker-end="url(#ns-a-' + model.key + ')"/>';
    // Down 列：数组顺序就是从上到下
    model.downBlocks.forEach(function (b, i) {
      const y = rowY(i);
      s += nsBoxNode(model, b, xDown, y, { boxClass: b.attn ? "" : " ns-box-plain" });
      if (i > 0) {
        s += '<line class="ns-flow" x1="' + downFlowX + '" y1="' + (rowY(i - 1) + NS_H) + '" x2="' + downFlowX + '" y2="' + (y - 1) + '" marker-end="url(#ns-a-' + model.key + ')"/>';
      }
    });
    // Mid：与最后一个 down block 同排
    s +=
      '<g class="ns-block" data-ns-block="' + model.key + ':mid" transform="translate(' + xMid + "," + midY + ')">' +
      '<rect class="ns-box ns-box-mid" x="0" y="0" width="' + COLW + '" height="' + midH + '" rx="8"/>' +
      '<text class="ns-b" x="12" y="22">' + esc(model.midLabel) + "</text>" +
      '<text class="ns-s" x="12" y="38">UNetMidBlock2DCrossAttn（ResNet→Self-Attn→Cross-Attn→ResNet）</text>' +
      '<rect class="ns-io" x="10" y="50" width="' + (COLW - 20) + '" height="22" rx="4"/>' +
      '<text class="ns-s" x="20" y="65">in  ' + esc(model.midIn) + "</text>" +
      '<rect class="ns-io" x="10" y="76" width="' + (COLW - 20) + '" height="22" rx="4"/>' +
      '<text class="ns-s" x="20" y="91">out ' + esc(model.midOut) + "</text>" +
      '<text class="ns-note" x="12" y="112">' + esc(model.midRes) + "</text>" +
      '<text class="ns-note" x="12" y="126">Self-Attn 在最低分辨率做全局混合</text>' +
      '<text class="ns-hint" x="' + COLW / 2 + '" y="' + (midH - 6) + '" text-anchor="middle">点击查看内部逐层尺寸</text>' +
      "</g>";
    // 最后一个 down block → Mid（从右下角引出，避免压在框内文字上）
    s +=
      '<polyline class="ns-flow" fill="none" points="' +
      (xDown + COLW) + "," + (midY + NS_H / 2) + " " + busX + "," + (midY + NS_H / 2) + " " +
      busX + "," + (midY + NS_H / 2) + " " + (midY + NS_H / 2) + '" />' +
      '<line class="ns-flow" x1="' + (xDown + COLW) + '" y1="' + (midY + NS_H / 2) + '" x2="' + (xMid - 1) + '" y2="' + (midY + NS_H / 2) + '" marker-end="url(#ns-a-' + model.key + ')"/>';
    // Up 列：数组顺序是从下往上
    model.upBlocks.forEach(function (b, i) {
      const y = upSlot(i);
      s += nsBoxNode(model, b, xUp, y, {});
      if (i > 0) {
        s += '<line class="ns-flow" x1="' + upFlowX + '" y1="' + (upSlot(i - 1) + NS_H) + '" x2="' + upFlowX + '" y2="' + (y + NS_H + 1) + '" marker-end="url(#ns-a-' + model.key + ')"/>';
      }
    });
    // Mid → 最下面的 up block（从 mid 右下角引出，接进 up 块的底边）
    s +=
      '<polyline class="ns-flow" fill="none" points="' +
      (xMid + COLW) + "," + (midY + midH) + " " + (busX - 6) + "," + (midY + midH) + " " +
      (busX - 6) + "," + (upSlot(0) + NS_H + 10) + " " + (xUp + COLW / 2) + "," + (upSlot(0) + NS_H + 10) + " " +
      (xUp + COLW / 2) + "," + (upSlot(0) + NS_H + 1) + '" marker-end="url(#ns-a-' + model.key + ')"/>';
    // skip 折线：down 块右侧 → 竖直总线 → 上方对应 up 块的左侧中部
    const pairs = model.key === "sdxl" ? [[0, 2], [1, 1], [2, 0]] : [[0, 3], [1, 2], [2, 1]];
    const lastDownRow = model.downBlocks.length - 1;
    pairs.forEach(function (p, i) {
      const yFrom = p[0] === lastDownRow ? rowY(p[0]) + NS_H - 12 : rowY(p[0]) + NS_H / 2;
      const yTo = upSlot(p[1]) + NS_H / 2;
      s +=
        '<polyline class="ns-skip" points="' + (xDown + COLW) + "," + yFrom + " " + busX + "," + yFrom + " " + busX + "," + yTo + " " + (xUp - 1) + "," + yTo + '" marker-end="url(#ns-s-' + model.key + ')"/>' +
        '<text class="ns-skip-lbl" x="' + (busX + 5) + '" y="' + (yFrom + (yTo > yFrom ? 22 : -8)) + '">skip' + (i + 1) + "</text>";
    });
    // SD1.5 的 down_3 没有对应 up：单独说明去向
    if (model.key === "sd15") {
      const yNone = rowY(1) + NS_H / 2;
      s +=
        '<polyline class="ns-skip ns-skip-note" points="' + (xDown + COLW) + "," + yNone + " " + (xMid - 30) + "," + yNone + '" marker-end="url(#ns-s-' + model.key + ')"/>' +
        '<text class="ns-skip-lbl" x="' + (xMid - 28) + '" y="' + (yNone - 6) + '">无对应 up：输出直接进 mid</text>';
    }
    // 输出
    s +=
      '<line class="ns-flow" x1="' + upFlowX + '" y1="' + (yTop - 2) + '" x2="' + upFlowX + '" y2="' + (rowY(0) - 1) + '" marker-end="url(#ns-a-' + model.key + ')"/>' +
      '<rect class="ns-io ns-io-edge" x="' + xUp + '" y="' + (yTop - 32) + '" width="' + COLW + '" height="30" rx="6"/>' +
      '<text class="ns-b" x="' + (xUp + 12) + '" y="' + (yTop - 12) + '">② ' + esc(model.outLabel) + "</text>";
    s += "</svg>";
    return s;
    }
  }

  // 条件编码（CLIP 部分），包含 SD1.5 与 SDXL 的差异
  function nsConditionSvg() {
    return '<div class="ns-condition-board" role="img" aria-label="SD 1.5 与 SDXL 的文本条件编码">' +
      '<div class="ns-condition-row"><div class="ns-condition-label"><b>SD 1.5</b><small>一个文本编码器</small></div><div class="ns-condition-steps">' +
      '<span>prompt 字符串</span><b>→</b><span>CLIP tokenizer<br><small>input_ids [B,77]</small></span><b>→</b><span>CLIPTextModel<br><small>hidden 768，取 hidden_states[-2]</small></span><b>→</b><strong>c_text [B,77,768]<br><small>只作为 Cross-Attention 的 K/V</small></strong></div></div>' +
      '<p class="ns-condition-note">SD 1.5 没有 pooled 文本条件，也没有 added time/size ids。</p>' +
      '<div class="ns-condition-row"><div class="ns-condition-label ns-condition-label-xl"><b>SDXL</b><small>两个文本编码器 + pooled 条件</small></div><div class="ns-condition-steps">' +
      '<span>prompt 字符串</span><b>→</b><span>两套 tokenizer<br><small>input_ids [B,77] × 2</small></span><b>→</b><span>CLIP-L<br><small>hidden 768</small></span><span>+ bigG<br><small>hidden 1280 + pooled 1280</small></span><b>→</b><strong>c_text [B,77,2048]<br><small>concat(channel) → Cross-Attention K/V</small></strong><strong>pooled [B,1280]<br><small>与 t / size ids → ADM scale / shift</small></strong></div></div>' +
      '<p class="ns-condition-note ns-condition-note-xl">SDXL 的 c_text 与 pooled 是两条不同入口：前者读取视觉 token，后者调制每个 ResNet。</p></div>';

    /* 旧版 SVG 条件图保留在下方作为历史参考，不再执行。 */
    const W = 1130;
    return (
      '<svg class="ns-svg ns-svg-cond" viewBox="0 0 ' + W + ' 236" role="img" aria-label="SD 1.5 与 SDXL 的文本条件编码">' +
      '<defs><marker id="ns-c-a" markerWidth="8" markerHeight="8" refX="6.4" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 z" fill="#5b8f7c"/></marker></defs>' +
      '<text class="ns-h" x="16" y="22">SD 1.5 条件路径（一个文本编码器）</text>' +
      '<rect class="ns-io" x="16" y="34" width="150" height="34" rx="6"/><text class="ns-b" x="28" y="56">prompt 字符串</text>' +
      '<line class="ns-flow" x1="166" y1="51" x2="195" y2="51" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io" x="196" y="34" width="150" height="34" rx="6"/><text class="ns-s" x="208" y="49">CLIP tokenizer</text><text class="ns-s" x="208" y="62">input_ids [B, 77]</text>' +
      '<line class="ns-flow" x1="346" y1="51" x2="375" y2="51" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io" x="376" y="34" width="196" height="34" rx="6"/><text class="ns-s" x="388" y="49">CLIPTextModel（12 层，hidden 768）</text><text class="ns-s" x="388" y="62">取 hidden_states[-2]</text>' +
      '<line class="ns-flow" x1="572" y1="51" x2="601" y2="51" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io ns-io-key" x="602" y="34" width="230" height="34" rx="6"/><text class="ns-b" x="614" y="49">c_text [B, 77, 768]</text><text class="ns-s" x="614" y="62">只作为 cross-attention 的 K / V</text>' +
      '<text class="ns-note" x="16" y="92">SD 1.5 没有 pooled 文本条件，也没有 added time/size ids；U-Net 的 cross_attention_dim = 768。</text>' +
      '<line class="ns-sep" x1="16" y1="106" x2="' + (W - 16) + '" y2="106"/>' +
      '<text class="ns-h" x="16" y="132">SDXL 条件路径（两个文本编码器 + pooled 条件）</text>' +
      '<rect class="ns-io" x="16" y="144" width="150" height="34" rx="6"/><text class="ns-b" x="28" y="166">prompt 字符串</text>' +
      '<line class="ns-flow" x1="166" y1="161" x2="195" y2="161" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io" x="196" y="144" width="150" height="34" rx="6"/><text class="ns-s" x="208" y="159">两套 tokenizer</text><text class="ns-s" x="208" y="172">input_ids [B, 77] ×2</text>' +
      '<line class="ns-flow" x1="346" y1="161" x2="375" y2="161" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io" x="376" y="126" width="196" height="34" rx="6"/><text class="ns-s" x="388" y="141">CLIPTextModel</text><text class="ns-s" x="388" y="154">hidden [B, 77, 768]</text>' +
      '<rect class="ns-io" x="376" y="166" width="196" height="34" rx="6"/><text class="ns-s" x="388" y="181">CLIPTextModelWithProjection（bigG）</text><text class="ns-s" x="388" y="194">hidden [B,77,1280] + pooled [B,1280]</text>' +
      '<line class="ns-flow" x1="572" y1="143" x2="601" y2="161" marker-end="url(#ns-c-a)"/>' +
      '<line class="ns-flow" x1="572" y1="183" x2="601" y2="161" marker-end="url(#ns-c-a)"/>' +
      '<rect class="ns-io ns-io-key" x="602" y="126" width="230" height="34" rx="6"/><text class="ns-b" x="614" y="141">c_text [B, 77, 2048]</text><text class="ns-s" x="614" y="154">concat(channel)：768 + 1280</text>' +
      '<rect class="ns-io ns-io-key" x="602" y="166" width="230" height="34" rx="6"/><text class="ns-b" x="614" y="181">pooled [B, 1280]</text><text class="ns-s" x="614" y="194">进 ADM 条件，不进 attention</text>' +
      '<rect class="ns-io" x="860" y="126" width="254" height="74" rx="6"/>' +
      '<text class="ns-s" x="872" y="145">added time/size ids：[B, 6]</text>' +
      '<text class="ns-s" x="872" y="162">pooled + t 做 residual add → [B,1280]</text>' +
      '<text class="ns-s" x="872" y="179">6 维 → time_embedding 投影 2816 → 相加</text>' +
      '<text class="ns-s" x="872" y="196">注入每个 ResNet 的 scale / shift</text>' +
      "</svg>"
    );
  }

  function nsPanel() {
    const panel = document.createElement("dialog");
    panel.className = "ia-modal ns-panel";
    panel.innerHTML =
      '<div class="ia-modal-card"><button type="button" class="ia-modal-close" aria-label="关闭">×</button><div class="ia-modal-kicker"></div><h2></h2><p class="ia-modal-meta"></p><div class="ns-panel-body"></div></div>';
    document.body.append(panel);
    panel.querySelector(".ia-modal-close").addEventListener("click", () => panel.close());
    panel.addEventListener("click", (event) => {
      if (event.target === panel) panel.close();
    });
    return panel;
  }

  // 模块弹窗中的子结构图：把用户在主图中看到的 block 展开成真实子模块。
  function nsDetailDiagram(model, id) {
    const textDim = model.key === 'sdxl' ? '2048' : '768';
    const step = function (title, body, cls) {
      return '<div class="ns-detail-step ' + (cls || '') + '"><b>' + esc(title) + '</b><small>' + esc(body) + '</small></div>';
    };
    const down = model.downBlocks.filter(function (x) { return x.id === id; })[0];
    const up = model.upBlocks.filter(function (x) { return x.id === id; })[0];
    let steps = [];
    if (id === 'mid') {
      steps = [
        step('输入 feature', model.midIn, 'ns-detail-io'),
        step('ResnetBlock2D', 'Conv2d → GroupNorm → SiLU；timestep / ADM 条件以 scale-shift 注入；residual add', 'ns-detail-resnet'),
        step('Transformer2DModel', '空间 feature 展平为 H×W 个 token；先 Self-Attention 做空间位置间的信息混合', 'ns-detail-attn'),
        step('Cross-Attention', 'Q = 视觉 token；K / V = c_text [B,77,' + textDim + ']；attention 输出写回视觉流并 residual add', 'ns-detail-cross'),
        step('ResnetBlock2D', '再次做 Conv / Norm / SiLU 与时间条件调制；保持通道和空间尺寸', 'ns-detail-resnet'),
        step('输出 feature', model.midOut, 'ns-detail-io'),
      ];
    } else if (down) {
      steps.push(step('输入 feature', '[B, ' + down.inShape + ']', 'ns-detail-io'));
      for (let i = 0; i < down.layers; i += 1) {
        steps.push(step('ResnetBlock2D ' + (i + 1), '当前层卷积 / 归一化 / SiLU；时间条件 scale-shift；残差相加', 'ns-detail-resnet'));
        if (down.attn) steps.push(step('Transformer2DModel ' + (i + 1), 'Self-Attention → Cross-Attention；Q = feature，K/V = c_text；输出 residual add', 'ns-detail-cross'));
      }
      if (down.dsp) steps.push(step('Downsample2D', '3×3 stride=2，把空间尺寸降为约 1/2，输出送入下一个 Down block', 'ns-detail-sample'));
      steps.push(step('输出 / 保存 skip', '[B, ' + down.outShape + ']', 'ns-detail-io'));
    } else if (up) {
      steps.push(step('输入 + skip', 'up_input 与同尺度 skip 沿通道维 torch.cat(dim=1)', 'ns-detail-merge'));
      for (let i = 0; i < up.layers; i += 1) {
        steps.push(step('ResnetBlock2D ' + (i + 1), 'shortcut 先把拼接后的通道投影回目标宽度；时间条件 scale-shift；残差相加', 'ns-detail-resnet'));
        if (up.attn) steps.push(step('Transformer2DModel ' + (i + 1), 'Self-Attention → Cross-Attention；读取 c_text 的 K / V', 'ns-detail-cross'));
      }
      if (up.usp) steps.push(step('Upsample2D', '插值 / 卷积把空间尺寸放大约 2 倍，再与下一尺度的 skip 对齐', 'ns-detail-sample'));
      steps.push(step('输出 feature', '[B, ' + up.outShape + ']', 'ns-detail-io'));
    }
    return '<div class="ns-detail-diagram"><div class="ns-detail-title">内部执行顺序</div><div class="ns-detail-flow">' +
      steps.map(function (s, i) { return (i ? '<span class="ns-detail-arrow" aria-hidden="true">→</span>' : '') + s; }).join('') +
      '</div><p class="ns-detail-caption"><b>怎么看：</b>ResnetBlock2D 负责局部卷积与时间条件调制；Transformer2DModel 内含 Self-Attention，带条件的 block 还会接 Cross-Attention；Up block 的第一步是通道拼接，Down / Up 的采样层只改变 H/W。</p></div>';
  }

  function nsBlockInfo(model, id) {
    if (id === "mid") {
      return {
        kicker: model.cfgTitle,
        title: model.midLabel,
        meta: "最低分辨率（16×16）上的全局混合；输入输出形状相同",
        rows: [
          ["输入", model.midIn],
          ["ResnetBlock2D", "[B, 1280, 16, 16] → [B, 1280, 16, 16]（时间条件以 scale/shift 注入）"],
          ["Cross-Attention", "Q = 视觉 token；K/V = c_text；输出与输入同形状，residual add"],
          ["ResnetBlock2D", "[B, 1280, 16, 16] → [B, 1280, 16, 16]"],
          ["输出", model.midOut],
        ],
        notes: model.attnNoteLines,
      };
    }
    const all = model.downBlocks.concat(model.upBlocks);
    const b = all.filter(function (x) {
      return x.id === id;
    })[0];
    if (!b) return null;
    return {
      kicker: model.cfgTitle,
      title: b.title + " · " + b.cls,
      meta:
        "完整类名 " + b.cls + "（Diffusers UNet2DConditionModel）｜layers_per_block = " +
        b.layers + "｜" + b.note,
      rows: [["输入", "[B, " + b.inShape + "]"]].concat(
        b.layersDetail.map(function (t, i) {
          return ["第 " + (i + 1) + " 步", t];
        }),
      ).concat([["输出", "[B, " + b.outShape + "]"]]),
      notes: model.attnNoteLines,
    };
  }

  function nsRenderInto(host, id) {
    const root = host.closest(".ns-wrap") || document;
    const key = id.split(":")[0];
    const bid = id.split(":")[1];
    const model = key === "sd15" ? ddSd15() : ddSdxl();
    const info = nsBlockInfo(model, bid);
    if (!info) return;
    if (!host._nsPanel) return;
    const panel = host._nsPanel;
    panel.querySelector(".ia-modal-kicker").textContent = info.kicker;
    panel.querySelector("h2").textContent = info.title;
    panel.querySelector(".ia-modal-meta").textContent = info.meta;
    panel.querySelector(".ns-panel-body").innerHTML =
      nsDetailDiagram(model, bid) +
      '<div class="io-table ns-panel-table"><table><tr><th>步骤</th><th>张量流（含形状）</th></tr>' +
      info.rows
        .map(function (r) {
          return '<tr><td>' + esc(r[0]) + "</td><td><code>" + esc(r[1]) + "</code></td></tr>";
        })
        .join("") +
      "</table></div>" +
      '<p class="ns-panel-note"><strong>该 U-Net 的 cross-attention 分布：</strong>' +
      info.notes.join("；") +
      "。具体层数、head 数与通道以该 checkpoint 的 <code>unet/config.json</code> 为准。</p>";
    if (typeof panel.showModal === "function") panel.showModal();
    else panel.setAttribute("open", "");
  }

  function nsMount(root, host) {
    const panel = nsPanel();
    // 切换要看哪一张网络：默认显示 SDXL，选中另一张时隐藏前一张，避免页面过长。
    const radios = root.querySelectorAll('input[name="ns-pick"]');
    const groups = root.querySelectorAll("[data-ns-group]");
    const cfgs = root.querySelectorAll("[data-ns-cfg]");
    function applyPick() {
      let picked = "sdxl";
      radios.forEach((r) => {
        if (r.checked) picked = r.value;
      });
      groups.forEach((g) => {
        if (g.dataset.nsGroup === picked) g.removeAttribute("hidden");
        else g.setAttribute("hidden", "");
      });
      cfgs.forEach((c) => {
        if (c.dataset.nsCfg === picked) c.style.display = "block";
        else c.style.display = "none";
      });
    }
    radios.forEach((r) => r.addEventListener("change", applyPick));
    applyPick();
    root.querySelectorAll("[data-ns-block]").forEach((node) => {
      node.addEventListener("click", () => {
        node._nsPanel = panel;
        nsRenderInto(node, node.dataset.nsBlock);
      });
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          node._nsPanel = panel;
          nsRenderInto(node, node.dataset.nsBlock);
        }
      });
    });
  }

  function nsNetwork(spec) {
    const m15 = ddSd15();
    const mxl = ddSdxl();
    const tab = function (m) {
      return '<label class="ns-tabbox"><input type="radio" name="ns-pick" value="' + m.key + '"' +
        (m.key === "sdxl" ? " checked" : "") + " /><span>" + esc(m.label) + "</span></label>";
    };
    const config = function (m) {
      return (
        '<div class="ns-config" data-ns-cfg="' + m.key + '"><b>' + esc(m.cfgTitle) + "</b><ul>" +
        m.cfgLines.map((l) => "<li>" + esc(l) + "</li>").join("") +
        "</ul></div>"
      );
    };
    return (
      '<div class="ns-wrap">' +
      '<div class="ns-tabs">' +
      '<b>选择要看哪一张网络：</b>' +
      tab(mxl) +
      tab(m15) +
      '<span class="ns-tip">两张图都是完整结构；点击任意格子查看该模块内部逐层尺寸。标签说明：prefix 3–19 是 Diffusers <code>pipe.unet.named_modules()</code> 里的层序号。</span>' +
      "</div>" +
      config(mxl) +
      config(m15) +
      '<div class="ns-group" data-ns-group="sdxl"><div class="ns-cap">' + esc(mxl.label) +
      " · 完整结构（形状以 1024×1024 → latent 128×128 为例）</div>" + nsBuild(mxl) + "</div>" +
      '<div class="ns-group" data-ns-group="sd15" hidden><div class="ns-cap">' + esc(m15.label) +
      " · 完整结构（形状以 1024×1024 → latent 128×128 为例）</div>" + nsBuild(m15) + "</div>" +
      '<div class="ns-legend"><span><i class="ns-sw ns-sw-block"></i>主干 block（可点击）</span>' +
      '<span><i class="ns-sw ns-sw-attn"></i>含 cross-attention</span>' +
      '<span><i class="ns-sw ns-sw-io"></i>输入 / 输出 / 张量形状</span>' +
      '<span><i class="ns-sw ns-sw-flow"></i>主干数据流</span>' +
      '<span><i class="ns-sw ns-sw-skip"></i>skip feature 搬运（U-Net 内部按通道拼接，见下方说明）</span></div>' +
      '<div class="ns-cond-cap">同一页的文本条件路径：SD 1.5 只有一个编码器，SDXL 有两个 + pooled 条件</div>' +
      nsConditionSvg() +
      '<div class="ns-hintbar"><b>怎么读这张图：</b>① 先看左边 Down path 从上往下走，每层盒子里的 <code>out</code> 就是下一层的 <code>in</code>；' +
      '② 橙色线是 skip：Down 的输出被保存下来，送到右边同尺寸的 Up 层；Up 层第一步就是把两者沿<b>通道维</b> <code>torch.cat(dim=1)</code> 拼接，' +
      '再由 <code>conv_shortcut</code> 投回该层通道数，之后才与 ResNet 分支做<b>逐元素相加</b>；' +
      '③ <code>t</code>（时间步）与 SDXL 的 <code>pooled + size ids</code> 不改变张量形状，它们通过 scale/shift 注入每个 ResNet；' +
      '④ <code>c_text</code> 只在标注 “cross-attn” 的格子里作为 K/V 被读取。</div>' +
      "</div>"
    );
  }

  // --- 微调 / 损失（沿用原有 ia-loss-panel 样式） -------------------------
  function dfFinetune(spec) {
    const steps = spec.finetune
      .map(
        (s) =>
          '<div class="ia-finetune-step"><strong>' +
          esc(s[0]) +
          "</strong><p>" +
          rich(s[1]) +
          "</p></div>",
      )
      .join("");
    const guide = spec.finetuneData || {};
    const rows = (guide.rows || [])
      .map(
        (row) =>
          "<tr><td>" + rich(row[0]) + "</td><td>" + rich(row[1]) + "</td><td>" + rich(row[2]) + "</td></tr>",
      )
      .join("");
    const sample = guide.sample
      ? '<div class="code-block"><span class="code-label">' +
        esc(guide.sampleTitle || "JSONL · 最小样本") +
        "</span><pre><code>" +
        esc(guide.sample) +
        "</code></pre></div>"
      : "";
    const dataBlock = guide.rows
      ? '<div class="df-finetune-data"><h3>微调数据要求与示例</h3><p>' +
        rich(guide.intro || "") +
        '</p><div class="io-table"><table><tr><th>任务</th><th>最低字段</th><th>验收重点</th></tr>' +
        rows +
        "</table></div>" +
        sample +
        "</div>"
      : "";
    const communityConfig = guide.config || [];
    const configBlock = communityConfig.length
      ? '<div class="df-community-config"><h3>社区入门配置示例</h3><p>' +
        rich(guide.configIntro || "下面的数值来自社区文档，用于先跑通流程；不是 MiniMax 官方推荐值，也不是通用最低门槛。") +
        '</p><div class="df-config-grid">' +
        communityConfig
          .map(
            (item) =>
              '<div><strong>' +
              esc(item[0]) +
              '</strong><code>' +
              esc(item[1]) +
              '</code><small>' +
              rich(item[2] || "") +
              '</small></div>',
          )
          .join("") +
        "</div></div>"
      : "";
    const cases = spec.finetuneCases || [];
    const casesBlock = cases.length
      ? '<div class="df-community-cases"><h3>可核查的社区案例</h3><div class="df-case-grid">' +
        cases
          .map(
            (item) =>
              '<article class="df-case"><strong>' +
              esc(item.title) +
              '</strong><div class="df-case-meta">' +
              esc(item.meta) +
              '</div><p>' +
              rich(item.summary) +
              '</p><p class="df-case-limit"><b>局限：</b>' +
              rich(item.limit) +
              '</p><div class="df-case-link">' +
              item.link +
              "</div></article>",
          )
          .join("") +
        "</div></div>"
      : "";
    const communityBlock = guide.communityLink
      ? '<div class="df-community"><h3>社区实践入口</h3><p>' +
        rich(guide.communityIntro || "官方尚未公开完整 H3 训练配方、官方微调脚本或完整损失函数；以下社区资料提供可运行的 LoRA 路径，阅读时请把实现细节与官方资料分开。") +
        '</p><p class="df-community-link">' +
        guide.communityLink +
        "</p></div>"
      : "";
    const nextBlock = guide.nextStep
      ? '<div class="df-next-step"><b>建议下一步</b><p>' + rich(guide.nextStep) + "</p></div>"
      : "";
    const loss = spec.finetuneLoss || {};
    const lossBlock = loss.formula
      ? '<div class="df-finetune-loss"><h3>微调损失函数</h3><p>' +
        rich(loss.summary || "微调沿用基座的训练目标，只改变可训练参数的梯度路径。") +
        '</p><div class="ia-loss-formula"><strong>微调目标</strong><code>' +
        rich(loss.formula) +
        '</code></div><p class="df-loss-note">' +
        rich(loss.note || "目标量和权重必须与基座 checkpoint 的训练配置一致。") +
        "</p></div>"
      : "";
    return (
      '<div class="ia-finetune"><h3>微调执行清单</h3><div class="ia-finetune-grid">' +
      steps +
      "</div>" +
      communityBlock +
      dataBlock +
      configBlock +
      casesBlock +
      nextBlock +
      lossBlock +
      "</div>"
    );
  }

  function dfLoss(spec) {
    const data = spec.loss;
    if (!data) return "";
    const nodes = data.flow
      .map(
        (step, index) =>
          '<div class="ia-loss-node ia-loss-' +
          step[3] +
          '"><b>' +
          esc(step[0]) +
          "</b><code>" +
          esc(step[1]) +
          "</code><small>" +
          esc(step[2]) +
          "</small></div>" +
          (index < data.flow.length - 1
            ? '<span class="ia-loss-arrow">→</span>'
            : ""),
      )
      .join("");
    return (
      '<div class="ia-loss-panel"><div class="ia-loss-head"><div><h3>训练目标与损失函数</h3><p>' +
      esc(data.summary) +
      '</p></div><span>' + esc(data.processLabel || "训练：随机时间点预测一次 → 与目标比较 → 反向传播") + '</span></div><div class="ia-loss-flow">' +
      nodes +
      '</div><div class="ia-loss-formula"><strong>核心公式</strong><code>' +
      esc(data.formula) +
      '</code></div><div class="ia-loss-grid"><div><strong>目标量</strong><p>' +
      rich(data.target) +
      '</p></div><div><strong>参数更新路径</strong><p>' +
      rich(data.gradient) +
      '</p></div><div><strong>与推理阶段的区别</strong><p>' +
      rich(data.inference) +
      "</p></div></div></div>"
    );
  }

  function dfNetworkView(spec) {
    const flow = (spec.networkFlow || [])
      .map((item, index) => {
        const moduleId = item.module && spec.modules && spec.modules[item.module]
          ? item.module
          : "";
        const tag = moduleId ? "button" : "div";
        const attrs = moduleId
          ? ' type="button" data-df-module="' + esc(moduleId) + '" aria-label="点击查看 ' + esc(item.title) + ' 的张量细节"'
          : "";
        return (
          '<' + tag + attrs + ' class="df-net-node df-net-' +
          esc(item.tone || "core") +
          '"><span>' +
          String(index + 1).padStart(2, "0") +
          "</span><strong>" +
          esc(item.title) +
          "</strong><small>" +
          rich(item.detail || "") +
          "</small></" + tag + ">" +
          (index < (spec.networkFlow || []).length - 1
            ? '<b class="df-net-arrow" aria-hidden="true">→</b>'
            : "")
        );
      })
      .join("");
    const briefs = (spec.sourcesBrief || [])
      .map(
        (item) =>
          '<div class="df-net-brief"><strong>' +
          esc(item[0]) +
          "</strong><p>" +
          item[1] +
          "</p></div>",
      )
      .join("");
    const h3Map = spec.h3Network ? h3NetworkMap() : "";
    return (
      h3Map +
      '<div class="df-network-overview"><div class="df-network-label">主干总览</div><div class="df-network-flow">' +
      flow +
      '</div><p class="df-network-note">网络模块只在这里列出；带“展开内部结构”的节点可点击查看完整层级、张量和重复位置。Tokenizer、文本编码器和 VAE 属于推断接口，详见第 2 章。</p>' +
      (briefs ? '<div class="df-network-briefs">' + briefs + "</div>" : "") +
      "</div>"
    );
  }

  function h3NetworkMap() {
    const escSvg = (value) => esc(value).replace(/"/g, "&quot;");
    const box = (x, y, w, h, tone, title, lines, moduleId) =>
      '<g class="h3-svg-box h3-svg-' + tone + (moduleId ? ' h3-svg-clickable' : '') + '"' + (moduleId ? ' role="button" tabindex="0" data-df-module="' + escSvg(moduleId) + '" aria-label="点击查看 ' + escSvg(title) + ' 的张量细节"' : '') + '><rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" />' +
      '<text x="' + (x + 12) + '" y="' + (y + 22) + '" class="h3-svg-title">' + escSvg(title) + '</text>' +
      lines.map((line, i) => '<text x="' + (x + 12) + '" y="' + (y + 42 + i * 15) + '" class="h3-svg-line">' + escSvg(line) + '</text>').join("") +
      '</g>';
    const arrow = (x1, y1, x2, y2, dashed) =>
      '<path class="h3-svg-arrow' + (dashed ? ' h3-svg-dashed' : '') + '" d="M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 + '" marker-end="url(#h3-arrow)" />';
    return (
      '<div class="h3-network-map"><div class="h3-network-map-head"><div><strong>MiniMax H3 · 模块连接图</strong><p>先看三类输入如何汇入 packed 多模态序列，再看单一 H3-Omni 主干如何拆出视频与音频输出。标注的数字里，绿色来自官方公开资料与 checkpoint 核验，未公开项仍写成未知。</p></div><span>官方公开 + checkpoint 核验</span></div>' +
      '<div class="h3-map-scroll"><svg class="h3-network-svg" viewBox="0 0 1040 500" role="img" aria-label="MiniMax H3 多模态网络结构图" preserveAspectRatio="xMinYMin meet"><defs><marker id="h3-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" /></marker></defs>' +
      '<text x="20" y="20" class="h3-svg-label">输入与条件编码</text>' +
      box(20, 38, 205, 76, "condition", "文本 prompt", ["Tokenizer → H3-Encoder", "Qwen3-VL-32B · 50 层 / 5120"], "h3enc") +
      box(20, 140, 205, 76, "condition", "参考图 / 视频", ["H3-Encoder + VisualVAE", "视觉塔 27 层 / 宽 1152"], "vvae") +
      box(20, 242, 205, 76, "condition", "参考音频", ["H3-AudioVAE", "32 kHz → 40 Hz / 声道 · 32ch"], "avae") +
      box(275, 38, 220, 76, "latent", "文本 / 参考条件 token", ["来源：H3-Encoder 第 50 层", "condition_proj 5120→5376"], "h3enc") +
      box(275, 140, 220, 76, "latent", "视频 latent token", ["VisualVAE f16t4d24", "24 通道 → patch 96 维"], "vvae") +
      box(275, 242, 220, 76, "latent", "音频 latent token", ["AudioVAE latent 32 通道", "audio_patch_proj 32→5376"], "avae") +
      arrow(225, 76, 275, 76) + arrow(225, 178, 275, 178) + arrow(225, 280, 275, 280) +
      '<path class="h3-svg-converge" d="M 495 76 L 545 76 L 545 178 M 495 178 L 545 178 M 495 280 L 545 280 L 545 178" />' +
      box(565, 130, 215, 96, "packed", "packed 多模态序列", ["text + video(96) + audio(32) tokens", "MM-RoPE (t, h, w)", "拼接顺序未公开"], "omni") +
      arrow(545, 178, 565, 178) +
      '<text x="805" y="20" class="h3-svg-label">统一主干与双路输出</text>' +
      box(805, 68, 215, 112, "core", "H3-Omni-Transformer", ["50 层 dense single-stream", "hidden 5376 · 56 head × 128", "SwiGLU 14336 · AdaLN（可缓存）"], "omni") +
      arrow(780, 178, 805, 124) +
      box(805, 218, 100, 72, "output", "视频输出头", ["video update"], "vvae") +
      box(920, 218, 100, 72, "output", "音频输出头", ["audio update"], "avae") +
      arrow(870, 180, 855, 218) + arrow(950, 180, 970, 218) +
      box(805, 332, 100, 72, "decode", "VisualVAE", ["decode → frames"], "vvae") +
      box(920, 332, 100, 72, "decode", "AudioVAE", ["decode → stereo"], "avae") +
      arrow(855, 290, 855, 332) + arrow(970, 290, 970, 332) +
      box(805, 430, 100, 48, "result", "视频", ["24 FPS"]) +
      box(920, 430, 100, 48, "result", "音频", ["32 kHz stereo"]) +
      arrow(855, 404, 855, 430) + arrow(970, 404, 970, 430) +
      '</svg></div><p class="h3-network-map-note"><b>读图边界：</b>官方明确三路条件、VisualVAE / AudioVAE 压缩数字、33B single-stream 与双路输出；本次又从 ComfyUI 侧 checkpoint 核验出主干 <b>50 层 / hidden 5376 / 56 head × 128 / SwiGLU 14336</b>、视频 token <b>96</b> 维、音频 token <b>32</b> 维、条件投影 <b>5120 → 5376</b>，以及两个 VAE 与 latent upscaler 的逐层结构（详见各模块弹窗与「论文与 checkpoint 对照」表）。仍然只能靠推理代码确认的是：packed token 的精确拼接顺序、<code>token_refiner</code> 的作用位置、训练目标与 solver。</p></div>'
    );
  }

  function dfHeader(spec) {
    const know = (spec.kind || "具体 checkpoint") ;
    return (
      '<div class="ia-header"><div><div class="arch-title">' +
      esc(spec.title) +
      "</div><p>" +
      esc(spec.subtitle) +
      "</p></div><span class=\"ia-instruction\">本图说明：" +
      esc(know) +
      "</span></div>" +
      '<div class="df-term">' +
      opChip("encode") +
      opChip("cat") +
      opChip("add") +
      opChip("read") +
      opChip("write") +
      opChip("solver") +
      opChip("split") +
      "</div>" +
      '<div class="ia-legend"><span><i class="ia-dot ia-dot-condition"></i>条件 / 外部输入（编码一次，循环内被重复读取）</span><span><i class="ia-dot ia-dot-state"></i>随循环变化的张量状态</span><span><i class="ia-dot ia-dot-core"></i>主干内部计算（可点击展开）</span><span><i class="ia-dot ia-dot-loop"></i>多步循环与数值更新</span></div>'
    );
  }

  function renderDataflow(host, spec) {
    host.classList.add("interactive-architecture", "dataflow-architecture");
    const networkSection = host.closest('.page-network');
    if (spec.network) {
      // 完整网络结构图放在最前面：先看清网络长什么样，再按顺序读数据流。
      host.insertAdjacentHTML("beforebegin", '<div class="ns-host">' + nsNetwork(spec) + "</div>");
      const nsHost = host.previousElementSibling;
      if (nsHost) nsMount(nsHost, host);
    } else if (networkSection) {
      // Transformer 类模型使用同一版式，但网络图由各自的 catalog 提供。
      host.insertAdjacentHTML("beforebegin", dfNetworkView(spec));
    }
    const stages = spec.stages.map((s, i) => dfStage(s, i)).join("");
    host.innerHTML =
      '<section class="generated-section generated-inference"><h2>2. 推断流程</h2>' +
      '<p class="generated-intro">' + rich(spec.inferenceIntro || "Tokenizer、条件编码器、latent 编解码器和 scheduler 作为完整推断链路中的步骤出现；它们不是主干 block 的内部层。") + "</p>" +
      dfHeader(spec) +
      '<div class="df-flow">' + stages + "</div>" +
      dfLoop(spec.loop) +
      '<div class="ia-loop-note"><strong>循环闭合：</strong>条件编码通常在循环外完成；每轮主干重新读取固定条件，只有状态与时间步由 solver 更新。具体回路以图中闭合点为准。</div>' +
      dfCondTable(spec) +
      dfCost(spec) +
      '</section>' +
      '<section class="generated-section generated-training"><h2>3. 训练流程与损失函数</h2>' +
      '<p class="generated-intro">' +
      rich(spec.trainingIntro || "训练通常在随机时间点构造状态，只监督主干对该时间点目标的预测；不把完整采样循环放进训练。") +
      "</p>" +
      dfLoss(spec) +
      '</section>' +
      '<section class="generated-section generated-finetune" id="finetune"><h2>4. 微调方式</h2>' +
      '<p class="generated-intro">' +
      rich(spec.finetuneIntro || "先按第 1 章的模块目录确认 target_modules，再决定 LoRA、部分解冻或全量训练；VAE 与条件编码器默认冻结。") +
      "</p>" +
      dfFinetune(spec) +
      dfUnknown(spec) +
      dfSources(spec) +
      '</section>';
    // 网络结构是独立的第 1 章；把自动生成的第 2～4 章移到它后面，避免章节语义嵌套。
    if (networkSection) {
      const anchor = networkSection.nextSibling;
      Array.from(host.children).forEach(function (section) {
        networkSection.parentNode.insertBefore(section, anchor);
      });
      host.remove();
    }
    dfBindModules(networkSection ? networkSection.parentElement : host, spec);
  }

  // ---------------------------------------------------------------------------
  // SD 1.5 / SDXL
  // SD 1.5 与 SDXL 的条件编码路径不同，必须分开画：
  //   SD 1.5：1 个 CLIP-L 文本编码器，cross_attention_dim = 768，没有 pooled 文本条件；
  //   SDXL  ：CLIP-L + OpenCLIP bigG 两个文本编码器，cross_attention_dim = 2048，
  //           并且额外使用 pooled embedding + added time/size ids。
  // 形状来源：stable-diffusion-v1-5 与 stable-diffusion-xl-base-1.0 的 unet/config.json、
  // text_encoder/config.json、model_index.json（本仓库核对时读取的实际文件）。
  // ---------------------------------------------------------------------------
  const sdUnetModal = function (variant) {
    const sd15 = variant === "sd15";
    return (
      '<div class="md-title">U-Net 一次 forward 的张量流：Down 保存 skip，Up 逐级取用</div>' +
      '<div class="df-sk"><div class="df-sk-head">' +
      (sd15 ? "SD 1.5 · UNet2DConditionModel" : "SDXL · UNet2DConditionModel") +
      "<small>" +
      (sd15
        ? "block_out_channels = [320,640,1280,1280]，down_block_types = [CrossAttnDownBlock2D ×3, DownBlock2D]，layers_per_block = 2，cross_attention_dim = 768，attention_head_dim = 8。"
        : "block_out_channels = [320,640,1280]，down_block_types = [DownBlock2D, CrossAttnDownBlock2D, CrossAttnDownBlock2D]，layers_per_block = 2（注意力 Transformer 层数 [1,2,10]），cross_attention_dim = 2048，attention_head_dim = [5,10,20]。") +
      "</small></div>" +
      unetSvg(variant) +
      '<div class="md-caption">图中橙色折线 = skip feature 的搬运（不是相加）：Down block 的输出同时向下传播并送给对应 Up block。Up block 内部先做 <code>torch.cat([up_input, skip], dim=1)</code>（通道维拼接，因此要求 skip 的 H/W 与 up_input 放大后一致、C 等于该层通道数），再进入 <code>conv_shortcut</code> 把拼接后的通道投影回该层通道宽度；投影之后才与 ResNet 的残差路径做逐元素相加。真实 skip 数量、通道数和 Up/Down 配对必须用该 checkpoint 的 <code>unet/config.json</code> 与 <code>pipe.unet.named_modules()</code> 核对，本图是官方 config 下的示例。</div>'
    );
  };

  const dataflowCatalog = {
    // ======================= SD 1.5 / SDXL ==================================
    sdxl: {
      title: "SD 1.5 / SDXL · 从 prompt 到像素的完整顺序数据流",
      subtitle:
        "SD 1.5 与 SDXL 的 latent diffusion 主循环相同，但条件编码不同：下面第 02 步分成两条路径分开画，绝不能把 SDXL 的双文本编码器当成 SD 1.5 的路径。",
      kind: "一个具体 pipeline 的完整推理路径；形状示例取自官方 checkpoint config，未公开或随版本变化的部分单独标注",
      network: true,
      modalKicker: "SD 1.5 / SDXL 模块",
      sourcesBrief: [
        [
          "条件编码路径（本次修正重点）",
          "SD 1.5 只有 <code>CLIPTextModel</code>（hidden_size=768，projection_dim=768），U-Net 的 <code>cross_attention_dim=768</code>；SDXL 是 <code>CLIPTextModel</code> + <code>CLIPTextModelWithProjection</code>（bigG），U-Net 的 <code>cross_attention_dim=2048</code>，并额外把 pooled embedding 与 added time/size ids 送进 U-Net。依据：两个 checkpoint 的 <code>model_index.json</code> 与 <code>unet/config.json</code>。",
        ],
        [
          "循环里的“重新读取”",
          "文本只在循环外编码一次；循环内每个配置为 cross-attention 的 block 重新执行一次 Q/K/V 注意力，所以文本是被读取 N_block × N_step 次，而不是重新编码。",
        ],
      ],
      stages: [
        {
          id: "df-input",
          kicker: "输入",
          title: "真实输入",
          note: "文生图只需要 prompt；图生图/重绘/ControlNet 会额外提供源图、mask 或控制图。",
          nodes: [
            {
              id: "prompt",
              kind: "input",
              title: "prompt（正向 / 负向）",
              shape: "字符串",
              meta: "CFG 需要一份空或负向提示词，作为第二次 forward 的条件",
            },
            {
              id: "source",
              kind: "external",
              title: "可选：源图 / mask / 控制图",
              shape: "RGB [B,3,H,W] / [B,1,H,W]",
              meta: "I2I、inpaint、ControlNet；进入路径见第 01b 步",
            },
          ],
        },
        {
          id: "df-text",
          kicker: "第 02 步 · 只在循环外执行一次",
          title: "文本编码：SD 1.5 与 SDXL 分开看",
          note: "两条路径的差异决定 c_text 的形状和 U-Net 能不能读取 pooled 条件。选错基座模型时，这里的维度会直接报错。",
          nodes: [
            {
              id: "tokenizer",
              kind: "process",
              title: "Tokenizer",
              shape: "input_ids [B,S]，S=77",
              meta: "max_position_embeddings = 77；CLIP BPE 词表 49408",
            },
          ],
          split: {
            title: "两条互不相同的条件编码路径（本页最重要的区分）",
            nodes: [
              {
                kind: "condition",
                title: "SD 1.5 路径",
                shape: "1 个 CLIP-L",
                meta: "hidden_size 768 · cross_attention_dim 768 · 没有 pooled 文本条件",
              },
              op("read", "读取 penultimate hidden", "hidden_states[-2]，clip_skip=1 的等价形式"),
              {
                kind: "condition",
                title: "c_text (SD1.5)",
                shape: "[B,77,768]",
                meta: "直接作为 K/V 的条件，不需要任何额外投影",
              },
            ],
          },
          drop:
            '<b>SDXL 路径（与上面不同，不要合并叙述）：</b> CLIP-L（hidden_size 768，projection_dim 768）+ OpenCLIP bigG（hidden_size 1280，projection_dim 1280）。两路都取 <code>hidden_states[-2]</code>，然后 <code>torch.cat(prompt_embeds_list, dim=-1)</code> → <code>c_text [B,77,2048]</code>（768+1280，通道维拼接）。pooled embedding 只取第二个编码器的 <code>text_embeds</code>：<code>pooled [B,1280]</code>。所以 SDXL 有 <b>两个</b>文本条件入口：<code>c_text</code> 走 cross-attention，<code>pooled</code> 走时间/尺寸条件。',
        },
        {
          id: "df-size",
          kicker: "第 02b 步 · 只在循环外执行一次",
          title: "时间与尺寸条件",
          note: "SD 1.5 只有 timestep；SDXL 额外有 pooled 文本与 added time/size ids。",
          nodes: [
            {
              kind: "condition",
              title: "t / sigma（每个 step 不同）",
              shape: "标量 [B] 或 [1]",
              meta: "由 scheduler 的时间表给出，进入 time embedding",
            },
            {
              kind: "condition",
              title: "added time/size ids（仅 SDXL）",
              shape: "concat → [B,6]",
              meta: "original_size、crops_coords_top_left、target_size 各 2 个数",
            },
            op("add", "residual add", "池化文本与时间嵌入逐元素相加，形成 [B,1280] ADM 条件"),
            op(
              "add",
              "residual add",
              "ADM 条件与 time embedding 相加后注入每个 ResNet 的 scale/shift",
            ),
          ],
        },
        {
          id: "df-init",
          kicker: "第 03 步 · 循环外执行一次",
          title: "初始化状态 z_t",
          nodes: [
            {
              kind: "external",
              title: "VAE Encode（仅 I2I / inpaint）",
              shape: "RGB [B,3,H,W] → z₀ [B,4,H/8,W/8]",
              meta: "乘 scaling_factor 后进入 latent 空间；SD 系列 VAE 空间压缩 8 倍",
            },
            {
              kind: "state",
              title: "scheduler 初始化",
              shape: "z_T [B,4,H/8,W/8]",
              meta: "文生图 = 纯噪声；I2I = z₀ 按 strength 加噪到 t_start；inpaint = mask 处理后的 latent",
            },
          ],
        },
        {
          id: "df-loop-enter",
          kicker: "第 04 步 · 进入多步循环",
          title: "denoising 循环（固定条件 vs 每步变化状态）",
          loop: true,
          note: "循环体内部只更新 latent；文本条件、尺寸条件、控制残差都不重新编码。",
          nodes: [
            {
              kind: "state",
              title: "当前状态 z_t",
              shape: "[B,4,H/8,W/8]",
              meta: "第一轮是初始化结果，之后是上一轮 scheduler 的输出",
            },
            {
              kind: "condition",
              title: "固定条件（不在循环内更新）",
              shape: "c_text / pooled+t / added ids / control residual",
              meta: "每一轮都被重新读取，但不重新计算",
            },
          ],
        },
        {
          id: "df-unet",
          kicker: "第 05 步 · 一次 U-Net forward（形状示例：SDXL 1024×1024 → latent 128×128）",
          title: "U-Net 内部数据流：Down 保存 skip，Up 取用 skip",
          note: "点击蓝色模块可展开 Down/Mid/Up 的真实张量流、skip 形状与拼接方式。",
          nodes: [
            {
              id: "unet",
              kind: "core",
              title: "U-Net（conditioned）",
              shape: "输入 z_t [B,4,128,128] · 输出 eps/v [B,4,128,128]",
              meta: "SDXL：[320,640,1280] × 2 层 + mid（注意力层数 [1,2,10]）",
              detail: true,
            },
            op(
              "read",
              "attention read(K,V) × 多次",
              "每个 cross-attention block 独立计算一次 $\\mathrm{softmax}(QK^\\top/\\sqrt{d})\\,V$",
            ),
            {
              kind: "output",
              title: "model_output",
              shape: "eps 或 v [B,4,128,128]",
              meta: "prediction_type 由 scheduler config 决定：epsilon / v_prediction",
            },
          ],
        },
        {
          id: "df-cfg",
          kicker: "第 06 步 · 每一步执行",
          title: "CFG 合并（两个预测的加权，不是 latent 相加）",
          nodes: [
            {
              kind: "output",
              title: "uncond 预测 eps_u",
              shape: "[B,4,H/8,W/8]",
              meta: "空提示词 forward",
            },
            {
              kind: "output",
              title: "cond 预测 eps_c",
              shape: "[B,4,H/8,W/8]",
              meta: "真实提示词 forward",
            },
            op(
              "add",
              "加权残差：$\\epsilon = \\epsilon_u + s\\,(\\epsilon_c - \\epsilon_u)$",
              "注意这里是“有条件减无条件再放大”的代数式，不是把两个 latent 相加",
            ),
            {
              kind: "state",
              title: "guidance 预测",
              shape: "[B,4,H/8,W/8]",
              meta: "交给 scheduler.step",
            },
          ],
          drop:
            "CFG 通常让 U-Net forward 次数翻倍；<code>guidance_scale</code> 只影响这次线性组合的系数，不改变 U-Net 权重，也不进入训练损失。",
        },
        {
          id: "df-solver",
          kicker: "第 07 步 · 每一步执行",
          title: "scheduler / solver：数值更新，不理解文本",
          loop: true,
          nodes: [
            {
              kind: "state",
              title: "输入 z_t",
              shape: "[B,4,H/8,W/8]",
              meta: "当前状态",
            },
            {
              kind: "output",
              title: "输入 model_output",
              shape: "eps / v",
              meta: "含 CFG 组合结果",
            },
            op(
              "solver",
              "Scheduler.step",
              "SD 1.5 默认 PNDMScheduler；SDXL 默认 EulerDiscreteScheduler（见各自 model_index.json）",
            ),
            {
              kind: "state",
              title: "z_{t−1}",
              shape: "[B,4,H/8,W/8]",
              meta: "下一轮重新当作 z_t",
            },
          ],
        },
        {
          id: "df-decode",
          kicker: "第 08 步 · 循环结束后执行一次",
          title: "VAE 解码",
          nodes: [
            {
              kind: "state",
              title: "clean latent z₀",
              shape: "[B,4,128,128]",
              meta: "循环最后一次输出",
            },
            {
              kind: "output",
              title: "VAE Decode → RGB",
              shape: "[B,3,1024,1024]",
              meta: "反 scaling → mid ResNet → 上采样 block → conv，输出范围需要按 pipeline 转换",
            },
          ],
        },
      ],
      skeleton: null,
      loop: {
        title: "多步循环的闭合关系（图 03 → 07 的回路）",
        counter: "t = T, …, 1 → t = 0",
        steps: [
          [
            {
              kind: "loop",
              title: "回到哪一层",
              shape: "U-Net 的输入层",
              meta: "回到第 05 步，不是回到文本编码或 VAE",
            },
            op(
              "solver",
              "z_t ← z_{t−1}, t ← 下一个时间点",
              "固定条件（c_text、pooled、size ids、control residual）原样重新送入",
            ),
            {
              kind: "state",
              title: "每轮变化",
              shape: "只有 z_t 与 t",
              meta: "文本编码值不变，但每个 cross-attention 每轮都会重新读取一次",
            },
            {
              kind: "output",
              title: "退出条件",
              shape: "t = 0",
              meta: "离开循环后进入第 08 步 VAE 解码",
            },
          ],
        ],
        ret:
          "闭合点：第 07 步输出的 <b>z_{t−1}</b> 在第 05 步被重新命名为 <b>z_t</b>；<code>t</code> 由 scheduler 时间表推进。循环内不会重新执行 Tokenizer、CLIP、VAE Encode。当 <code>t = 0</code> 时跳出循环 → 第 08 步 VAE 解码。",
      },
      conditions: [
        {
          name: "c_text",
          where: "第 02 步（循环外，一次）",
          fixed: "不重算（同一 prompt 复用）",
          read: "每个 cross-attention block 每步读取一次：c_text → K、V；视觉 feature → Q",
        },
        {
          name: "pooled + t + added time/size ids",
          where: "第 02b 步（循环外，一次）",
          fixed: "pooled 与 size ids 固定；t 每步变化",
          read: "加进 time embedding 后注入每个 ResNet 的 scale/shift（ADM 条件）",
        },
        {
          name: "z_t",
          where: "第 03 步初始化",
          fixed: "每步被替换",
          read: "U-Net 的 conv_in 输入",
        },
        {
          name: "source / mask / control residual",
          where: "初始化时（I2I、inpaint）或每一步（ControlNet）",
          fixed: "取决于 pipeline：ControlNet residual 每步都要注入",
          read: "ControlNet 的多尺度 residual 与对应 U-Net Down/Mid/Up 特征逐元素相加",
        },
      ],
      conditionsNote:
        "“固定条件”指不需要在循环内重新计算；“每步读取”指主干在每一轮 forward 里都会重新执行读取它的那一次运算。两者不矛盾。",
      cost:
        "U-Net 参数量约 0.86B（SD1.5）/ 2.6B（SDXL）量级，但显存与时延主要由 attention 序列长度决定：SDXL 在 1024×1024 时 latent 为 128×128，最高分辨率 stage 的 self-attention token 数达 16384，因此 SDXL 只在低分辨率 stage 放 self-attention。CFG 会让 forward 次数翻倍。",
      loss: {
        summary:
          "训练不跑完整采样循环：随机取一个 t，把 clean latent 加噪成 z_t，让 U-Net 预测该时间点的噪声（epsilon）或速度（v），再与真实目标做回归。",
        flow: [
          ["真实图片", "x → VAE → z₀", "训练样本的 clean latent", "data"],
          ["随机扰动", "$\\epsilon \\sim \\mathcal{N}(0,I)$、采样 $t$", "$z_t = \\alpha_t z_0 + \\sigma_t \\epsilon$", "noise"],
          ["U-Net 预测", "eps_theta(z_t,t,c_text,pooled)", "c_text 走 cross-attn，pooled 走 ADM", "model"],
          ["对齐目标", "target = ε 或 v", "必须与该 checkpoint 的 prediction_type 一致", "target"],
          ["反向传播", "MSE / Huber → ∇θL", "更新 LoRA 的 A/B，或解冻的 U-Net 参数", "loss"],
        ],
        formula: "$L = \\mathbb{E}\\left[\\, w(t)\\,\\| \\epsilon_\\theta(z_t, t, c_{\\text{text}}, c_{\\text{pooled}}) - \\epsilon \\|^2 \\right]$　（v-prediction 时把 ε 换成 v）",
        target:
          "目标量是当前 t 下的噪声或速度，不是最终图片。prediction_type 与 weighting 都要从 scheduler config 读取。",
        gradient:
          "SD/SDXL LoRA 通常只对 U-Net 的 attention（to_q/to_k/to_v/to_out.0）与 MLP 的 LoRA A、B 求梯度；VAE 与文本编码器默认冻结。ControlNet 训练时冻结基座 U-Net，只训控制分支的零卷积与副本权重。",
        inference:
          "CFG、Scheduler.step 与 30 步时间表都只属于推理；训练不包含“循环”，一次 forward 只监督一个随机 t。",
      },
      finetune: [
        [
          "1. 明确基座",
          "SD 1.5 与 SDXL 的文本条件、cross_attention_dim（768 / 2048）和分辨率分布都不同，LoRA 不能跨基座混用。",
        ],
        [
          "2. 数据形式",
          "风格/主体：image + caption + 尺寸 + split；局部编辑：source/target/mask 三元组；构图控制：control 图与对齐的 target。",
        ],
        [
          "3. 可训练模块",
          "优先 U-Net attention 的 to_q/to_k/to_v/to_out.0；需要更大容量时加入 feed-forward；SDXL 的 added time/size 条件通常保持冻结。",
        ],
        [
          "4. 冻结范围",
          "VAE 冻结；文本编码器默认冻结，只有确认需要改变文字/概念映射时才单独训练 text encoder LoRA。",
        ],
        [
          "5. 训练目标",
          "图片 → VAE latent → 随机 t 加噪 → U-Net 预测 epsilon/v；只对 LoRA A/B 求梯度，prediction_type 必须与基座一致。",
        ],
        [
          "6. 验收方法",
          "固定 seed、步数、scheduler 与提示词，对比基座的主体一致性、提示遵循、文字渲染、负面场景，以及未见分辨率和旧能力保持。",
        ],
      ],
      finetuneData: {
        intro: "主体 / 风格训练用配图与精确 caption；局部编辑必须保留 source、target、mask、instruction 的配对关系。按主体或拍摄批次切分，避免近重复图片跨越训练集和验证集。",
        rows: [
          ["主体 / 风格", "image、caption、width、height、subject、split", "主体一致性、提示遵循、未见角度"],
          ["局部编辑", "source、target、mask、instruction、split", "mask 外保持、边缘融合、编辑成功率"],
          ["构图 / 控制", "control image、target、caption、布局标注", "位置、比例、文字与背景稳定性"],
        ],
        sampleTitle: "JSONL · SDXL LoRA 最小样本",
        sample: '{"image":"train/subject_001.jpg","caption":"sks person, side profile, studio light","width":1024,"height":1024,"subject":"person_a","split":"train"}',
      },
      finetuneLoss: {
        summary: "微调沿用基座在随机 t 上的 epsilon / v 回归，只让 LoRA 增量参数接收这次误差的梯度。",
        formula: "$L_{\\text{lora}} = \\mathbb{E}\\left[\\, w(t)\\,\\| f_{W+\\Delta W_{\\text{lora}}}(z_t,t,c) - \\text{target}_t \\|^2 \\right]$",
        note: "target_t 由 checkpoint 的 prediction_type 决定；VAE、文本编码器和未选中的 U-Net 权重默认冻结。",
      },
      sources: [
        {
          item: "Latent Diffusion 的 VAE + U-Net + cross-attention 设计",
          links:
            '<a href="https://arxiv.org/abs/2112.10752" target="_blank" rel="noopener">Rombach et al., LDM (arXiv:2112.10752)</a>',
          evidence:
            "论文证实 latent 空间做扩散、条件通过 cross-attention 注入；论文不给出 SDXL 的层数或 2048 维条件。",
        },
        {
          item: "SDXL 的双文本编码器、pooled 条件与 size 条件",
          links:
            '<a href="https://arxiv.org/abs/2307.01952" target="_blank" rel="noopener">SDXL (arXiv:2307.01952)</a> · <a href="https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0" target="_blank" rel="noopener">base-1.0 模型卡</a>',
          evidence:
            "论文说明使用两个文本编码器与 size/crop 条件；确切维度要看 base-1.0 的 config（cross_attention_dim=2048、projection_class_embeddings_input_dim=2816）。",
        },
        {
          item: "SD 1.5 的单一 CLIP-L 条件路径",
          links:
            '<a href="https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5" target="_blank" rel="noopener">SD 1.5 模型卡</a> · <a href="https://arxiv.org/abs/2210.08402" target="_blank" rel="noopener">SD 2 / OpenCLIP 说明</a>',
          evidence:
            "checkpoint 的 model_index.json 只有一个 text_encoder（CLIPTextModel），U-Net cross_attention_dim=768。SDXL 论文里的双编码器结论不适用于 SD 1.5。",
        },
        {
          item: "U-Net 的具体层数、skip 数量与通道",
          links:
            '<a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/unets/unet_2d_condition.py" target="_blank" rel="noopener">Diffusers UNet2DConditionModel 源码</a>',
          evidence:
            "源码决定 skip 的连接顺序；具体到某个 checkpoint 必须读它的 unet/config.json（down_block_types、block_out_channels、layers_per_block）。",
        },
        {
          item: "‘文本每步重新读取’的实现位置",
          links:
            '<a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/attention_processor.py" target="_blank" rel="noopener">Diffusers AttnProcessor / CrossAttnProcessor</a>',
          evidence:
            "cross-attention 的 K/V 来自 encoder_hidden_states；循环内每次 forward 都会重新执行该运算，但 encoder 不在循环内。",
        },
      ],
      unknown: [
        "具体 checkpoint 的 skip 数量、通道数与 Up/Down 配对顺序：必须读该 checkpoint 的 unet/config.json（down_block_types / up_block_types / block_out_channels / layers_per_block）并用 pipe.unet.named_modules() 核对。",
        "prediction_type 与 weighting：读 scheduler/scheduler_config.json 与训练脚本，不要假设所有 SDXL 微调都用 epsilon。",
        "SDXL refiner 是另一个独立 U-Net 与独立 text encoder 配置；base-only 路径不包含 refiner，两者不能混画成一张图。",
        "SDXL 官方并未公开完整训练数据与全部训练细节；微调相关结论只能以 released checkpoint 与官方训练脚本为准。",
      ],
      modules: {
        unet: {
          title: "U-Net：Down / Mid / Up 的真实张量流与 skip 合流",
          meta:
            "一次 forward 的输入是 z_t、t 与条件；输出与 z_t 同形状的 eps 或 v。下面以 SDXL（1024×1024 → latent 128×128）为形状示例，并同时标出 SD 1.5 的差异。",
          diagram: sdUnetModal("sdxl"),
          input: [
            "① latent z_t [B,4,128,128] 经 conv_in 变成 [B,320,128,128]；",
            "② timestep t 经 time embedding（+ SDXL 的 pooled 与 size ids）变成按 block 调制用的条件向量；",
            "③ c_text [B,77,2048] 只在有 cross-attention 的 block 里被读取。",
          ],
          output: [
            "conv_out 输出 eps 或 v [B,4,128,128]，与输入 z_t 形状完全相同；它不是 RGB 图片，也不是 latent 本身。",
          ],
          role: [
            "Down path 逐级降采样并保存多尺度特征，Mid 在最低分辨率做全局混合，Up path 逐级放大并把同尺度的 Down 特征按通道拼接回来，从而同时保留语义和局部细节。",
          ],
          repeat: [
            "每个 denoising step 执行一次；启用 CFG 时同一 z_t 执行两次（uncond / cond）。",
          ],
          extraTitle: "skip1 / skip2 到底是什么",
          extra:
            "skip 不是独立模块，而是 Down path 中各 block 输出的<b>中间特征图</b>。以 SDXL 的 3 个 down block 为例：down_0 输出 [B,320,128,128]、down_1 输出 [B,640,64,64]、down_2 输出 [B,1280,32,32]，三者分别送到 up_2、up_1、up_0 的同尺度输入处；mid 输出进入 up_0 之前的位置。SD 1.5 有 4 个 down block（[320,640,1280,1280]），其中 down_3 是 DownBlock2D（无 cross-attention、无 downsampler），它的输出进入 mid，因此 1.5 的中间 skip 数量与 SDXL 不同。<b>Down/Up 的具体配对与数量必须按 checkpoint config 核对</b>，本页给出的张量是官方 config 下的示例。",
        },
      },
    },

    // ======================= SD3 / MMDiT ===================================
    dit: {
      title: "SD3 / MMDiT · 从 latent patch 到 joint attention 的完整数据流",
      subtitle:
        "文本流和图像流各自独立投影与归一化，只在每个 block 的 attention 内部沿 token 序列维拼接 Q/K/V；拼接后立刻按 token 数拆回两条流继续残差路径。",
      kind: "SD3.5-large 的公开 config 与 Diffusers SD3Transformer2DModel 实现",
      modalKicker: "SD3 / MMDiT 模块",
      networkFlow: [
        { title: "VAE latent", detail: "[B,16,H′,W′]；从像素压缩而来", tone: "latent" },
        { title: "Patchify + position", detail: "2×2 patch → image tokens [B,Nimg,D]", tone: "condition" },
        { title: "联合 Transformer", detail: "文本流与图像流在 attention 内沿序列维交互", tone: "core", module: "mmdit" },
        { title: "Unpatchify + output", detail: "只取图像 token → velocity → solver → VAE decode", tone: "output" },
      ],
      sourcesBrief: [
        [
          "双流联合注意力的确切位置",
          "MMDiT block 里：<code>to_q/to_k/to_v</code> 处理图像 token，<code>add_q_proj/add_k_proj/add_v_proj</code> 处理文本 token，然后 <code>torch.cat([q_img, q_txt], dim=2)</code>（序列维）做一次 attention，再按图像 token 数切回两条流。依据：Diffusers <code>JointAttnProcessor2_0</code>。",
        ],
        [
          "文本序列从哪里来",
          "CLIP-L（768）、CLIP-G（1280）与 T5-XXL（4096）分别编码；序列条件经 <code>context_embedder</code> 投到模型宽度，pooled 条件经 <code>pooled_projections</code> 进入 <code>time_text_embed</code>。SD3.5-large 的 caption_projection_dim=2432、pooled_projection_dim=2048、joint_attention_dim=4096。",
        ],
      ],
      stages: [
        {
          id: "df-input",
          kicker: "输入",
          title: "真实输入",
          nodes: [
            {
              id: "prompt",
              kind: "input",
              title: "prompt",
              shape: "字符串",
              meta: "CLIP 侧最多 77 token；T5 侧按 tokenizer 上限截断",
            },
          ],
        },
        {
          id: "df-text",
          kicker: "第 02 步 · 循环外一次",
          title: "文本编码与两条条件入口",
          note: "序列条件进 attention；pooled 条件进时间调制。两者用途不同，不能都塞进 K/V。",
          nodes: [
            {
              id: "clip",
              kind: "core",
              title: "CLIP-L + CLIP-G",
              shape: "sequence [B,77,2048] + pooled [B,2048]",
              meta: "两个 CLIPTextModelWithProjection：768 + 1280",
              detail: true,
            },
            op("cat", "concat(channel)", "两路 CLIP hidden 沿特征维拼接"),
            {
              kind: "condition",
              title: "T5-XXL 序列条件",
              shape: "[B,N_t5,4096]",
              meta: "d_model=4096、24 层；文本序列语义的主要来源",
            },
            op(
              "encode",
              "context_embedder（Linear）",
              "把 4096 维文本隐状态投影到模型宽度（SD3.5-large: 2432）",
            ),
            {
              id: "ctext",
              kind: "condition",
              title: "c_text",
              shape: "[B,N_txt,2432]",
              meta: "N_txt = CLIP 77 + T5 序列长度（含 padding），具体长度按 pipeline 拼接方式核验",
            },
            op(
              "add",
              "pooled_projections → time modulation",
              "pooled [B,2048] 与本步的 t 一起生成 AdaLN 的 scale/shift/gate",
            ),
          ],
        },
        {
          id: "df-latent",
          kicker: "第 03 步 · 循环外一次",
          title: "图像 latent 与 patch 化",
          nodes: [
            {
              kind: "external",
              title: "VAE Encode（I2I）",
              shape: "RGB [B,3,H,W] → z₀ [B,16,H/8,W/8]",
              meta: "SD3 系列 VAE 是 16 通道 latent",
            },
            {
              kind: "state",
              title: "加噪 / 初始化",
              shape: "z_t [B,16,128,128]（1024×1024 时）",
              meta: "flow matching 路径上的插值状态",
            },
            op(
              "encode",
              "PatchEmbed(p=2) + pos_embed",
              "2×2 patch 展平后线性投影：16×2×2 = 64 → 模型宽度",
            ),
            {
              kind: "state",
              title: "image tokens",
              shape: "[B,N_img,D]，N_img=(128/2)²=4096，D=2432",
              meta: "patch 后 token 数 = (H/8/2)×(W/8/2)",
            },
          ],
        },
        {
          id: "df-block",
          kicker: "第 05 步 · 重复 num_layers 个 block（SD3.5-large: 38）",
          title: "MMDiT block 内部：双流投影 → 联合 attention → 拆流 → 各自 MLP",
          note: "点击紫色模块看每一处拼接维度、Q/K/V 来源和残差路径。",
          nodes: [
            {
              id: "mmdit",
              kind: "core",
              title: "JointTransformerBlock（MMDiT）",
              shape: "image [B,4096,2432] + text [B,N_txt,2432]",
              meta: "AdaLN-Zero 调制 · RMSNorm 作用于 Q/K · GELU FFN",
              detail: true,
            },
            op(
              "split",
              "split(seq)",
              "attention 输出按 residual.shape[1] 切回图像段与文本段",
            ),
            {
              kind: "state",
              title: "两条流各自更新",
              shape: "image [B,4096,2432] · text [B,N_txt,2432]",
              meta: "各自 out projection → residual add → 各自 FFN → residual add",
            },
          ],
        },
        {
          id: "df-out",
          kicker: "第 06 步 · 每个 block 之后",
          title: "控制残差与输出头",
          nodes: [
            {
              kind: "external",
              title: "ControlNet residual（可选）",
              shape: "与 block 输出同形状",
              meta: "block_controlnet_hidden_states 逐 block 逐元素相加",
            },
            op("add", "residual add", "把控制分支的 block 级特征加到主干输出上"),
            {
              kind: "output",
              title: "norm_out + proj_out",
              shape: "→ [B,N_img,64] → [B,16,128,128]",
              meta: "只取图像 token，还原成 latent 形状的 velocity",
            },
          ],
        },
        {
          id: "df-solver",
          kicker: "第 07 步 · 每一步",
          title: "flow solver 更新与循环",
          loop: true,
          nodes: [
            {
              kind: "state",
              title: "z_t",
              shape: "[B,16,128,128]",
              meta: "当前 flow 插值状态",
            },
            op(
              "solver",
              "FlowMatchEulerDiscreteScheduler.step",
              "z_{t−1} = z_t + (σ_{t−1} − σ_t) · v，方向与系数由 scheduler config 决定",
            ),
            {
              kind: "state",
              title: "z_{t−1}",
              shape: "[B,16,128,128]",
              meta: "回到 PatchEmbed（第 04 步）而不是回到文本编码",
            },
            {
              kind: "output",
              title: "t = 0 → VAE Decode",
              shape: "RGB [B,3,H,W]",
              meta: "SD3 VAE 解码；latent 16 通道",
            },
          ],
        },
      ],
      loop: {
        title: "多步循环的闭合关系",
        counter: "t: 1 → 0（flow matching 时间方向按 scheduler 定义）",
        steps: [
          [
            {
              kind: "loop",
              title: "回到哪一层",
              shape: "PatchEmbed 之前的 latent",
              meta: "每轮重新 patch 化并重新生成位置编码，但文本条件不重新编码",
            },
            op(
              "solver",
              "z_{t−1} → z_t",
              "把上一轮 solver 输出当作当前状态",
            ),
            {
              kind: "state",
              title: "每轮变化",
              shape: "z_t 与 t/sigma",
              meta: "c_text 与 pooled 条件固定，但每个 block 每轮都重新读取一次",
            },
            {
              kind: "output",
              title: "退出",
              shape: "σ = 0",
              meta: "VAE Decode 得到像素图",
            },
          ],
        ],
        ret:
          "闭合点：solver 输出的 <b>z_{t−1}</b> 回到 <b>PatchEmbed</b>（第 04 步），不是回到文本编码器。文本序列条件在每个 block 的 attention 里每轮被重新读取，这属于“读取重复”而不是“编码重复”。",
      },
      conditions: [
        {
          name: "encoder_hidden_states (c_text)",
          where: "循环外一次（context_embedder 投影）",
          fixed: "不重算",
          read: "每个 block 的 add_q/add_k/add_v 投影，沿序列维与图像 token 拼接",
        },
        {
          name: "pooled_projections",
          where: "循环外一次",
          fixed: "不重算",
          read: "time_text_embed：与 t 一起生成 AdaLN 的 scale/shift/gate",
        },
        {
          name: "block_controlnet_hidden_states",
          where: "每一步（由控制网络按 z_t 与 t 重新计算）",
          fixed: "每步重算",
          read: "逐 block 与主干输出逐元素相加",
        },
        {
          name: "z_t",
          where: "初始化",
          fixed: "每步替换",
          read: "PatchEmbed",
        },
      ],
      conditionsNote:
        "MMDiT 的“联合”发生在 attention 内部的序列维拼接，不是把文本 embedding 复制给每个图像 token，也不是在通道维拼接条件。",
      cost:
        "joint attention 的序列长度是 N_img + N_txt，attention 计算量随两者之和的平方增长。1024×1024 时 N_img=4096，长 T5 序列会显著增加开销。",
      loss: {
        summary:
          "SD3 使用 rectified flow / flow matching：在 clean latent 与噪声之间取直线路径上的一个点，让 Transformer 回归该点的速度。",
        flow: [
          ["真实 latent", "x → VAE → z₀", "16 通道 clean latent", "data"],
          ["路径采样", "$\\epsilon \\sim \\mathcal{N}(0,I)$、$t \\in [0,1]$", "$z_t = (1-t)\\,z_0 + t\\,\\epsilon$", "noise"],
          ["MMDiT 预测", "vθ(z_t, t, c_text, pooled)", "两个条件入口各司其职", "model"],
          ["真实速度", "$u_t = \\epsilon - z_0$", "直线路径方向", "target"],
          ["反向传播", "MSE / Huber → ∇θL", "更新 Transformer 或其 LoRA", "loss"],
        ],
        formula: "$L = \\mathbb{E}\\left[\\, \\| v_\\theta(z_t, t, c_{\\text{text}}, c_{\\text{pooled}}) - (\\epsilon - z_0) \\|^2 \\right]$",
        target:
          "目标是 velocity。若某个 checkpoint 配置成 epsilon 或 v prediction，公式必须按它的 scheduler config 改写。",
        gradient:
          "文本编码器与 VAE 通常冻结；可训练的是双流注意力投影、MLP 与联合 attention 的 LoRA，或全量 Transformer。",
        inference:
          "训练只监督随机 t 的一个点；推理时由 flow solver 沿 σ 序列积分，solver 没有可学习参数。",
      },
      finetune: [
        [
          "1. 数据形式",
          "T2I：image + caption（CLIP 与 T5 两套 tokenizer 都要处理）；文字渲染任务额外保存精确转写、语言、字体与文字区域框。",
        ],
        [
          "2. 可训练模块",
          "先打印 transformer.named_modules()：双流的 to_q/to_k/to_v/to_out、add_q_proj/add_k_proj/add_v_proj、to_add_out，以及 ff.net / ff_context.net。",
        ],
        [
          "3. 冻结范围",
          "VAE 与三个文本编码器冻结；SD3.5-large 的 T5-XXL 单独占很大显存，训练时通常留在 CPU 或低精度。",
        ],
        [
          "4. 训练目标",
          "flow matching 速度回归；latent 通道 16、patch size 2、caption_projection_dim 与 pooled_projection_dim 都要与基座 config 一致。",
        ],
        [
          "5. 验收方法",
          "同时测提示遵循、长文本与字符准确率、未见分辨率、以及 joint attention 是否在拼接长度变化时保持稳定。",
        ],
      ],
      finetuneData: {
        intro: "DiT / MMDiT 微调需要与基座相同的 VAE、patch size、文本字段和分辨率分布。文字渲染样本额外保存精确转写、语言与文字区域。",
        rows: [
          ["文生图 / 风格", "image、caption、width、height、split", "提示遵循、风格一致性、未见宽高比"],
          ["文字渲染", "image、caption、transcription、language、text boxes", "字符准确率、位置、字体与背景稳定性"],
          ["编辑 / 控制", "source、target、instruction、mask 或 control", "编辑区域成功率、非编辑区保持"],
        ],
        sampleTitle: "JSONL · MMDiT 最小样本",
        sample: '{"image":"train/poster_001.png","caption":"一张黑底白字的电影海报","transcription":"电影海报","language":"zh","split":"train"}',
      },
      finetuneLoss: {
        summary: "MMDiT 微调沿用 flow matching 的速度回归；LoRA 只改变双流投影、联合 attention 或 MLP 的参数增量。",
        formula: "$L_{\\text{lora}} = \\mathbb{E}\\left[\\, \\| v_{W+\\Delta W_{\\text{lora}}}(z_t,t,c) - (\\epsilon - z_0) \\|^2 \\right]$",
        note: "时间采样、weighting 和 prediction_type 以具体 checkpoint 的训练配置为准；VAE 与文本编码器通常冻结。",
      },
      sources: [
        {
          item: "DiT：latent patch 化 + Transformer 预测",
          links:
            '<a href="https://arxiv.org/abs/2212.09748" target="_blank" rel="noopener">Peebles & Xie, DiT (arXiv:2212.09748)</a>',
          evidence:
            "论文给出 AdaLN 调制与 patch 化的 DiT 设计；它不使用双流文本条件，不能直接解释 MMDiT 的拼接方式。",
        },
        {
          item: "MMDiT 双流与联合注意力",
          links:
            '<a href="https://arxiv.org/abs/2403.03206" target="_blank" rel="noopener">Esser et al., SD3 (arXiv:2403.03206)</a>',
          evidence:
            "论文说明文本与图像使用独立权重并联合 attention；维度和实现细节仍需对照代码与 config。",
        },
        {
          item: "拼接维度与拆流位置",
          links:
            '<a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/attention_processor.py" target="_blank" rel="noopener">Diffusers JointAttnProcessor2_0</a> · <a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/attention.py" target="_blank" rel="noopener">JointTransformerBlock</a>',
          evidence:
            "cat(dim=2)（序列维）与 hidden_states[:, :residual.shape[1]] 的切分是代码级事实。",
        },
        {
          item: "SD3.5-large 具体维度",
          links:
            '<a href="https://huggingface.co/stabilityai/stable-diffusion-3.5-large" target="_blank" rel="noopener">SD3.5-large 模型卡</a>',
          evidence:
            "num_layers=38、caption_projection_dim=2432、joint_attention_dim=4096、pooled_projection_dim=2048、patch_size=2、in/out channels=16（该 checkpoint 的 transformer/config.json）。",
        },
      ],
      unknown: [
        "不同 SD3 版本（Medium / Large / 3.5）的层数、宽度与文本编码器组合不同：必须读各自 transformer/config.json，不能把 3.5-large 的 38 层当作通用值。",
        "T5 序列与 CLIP 序列在 c_text 里的确切拼接顺序与 padding 处理：按 pipeline 的 encode_prompt 实现核对（CLIP 段是否补零、总长度上限）。",
        "SD3 论文公开的是设计与规模，未发布训练数据；可用性、许可与训练细节以模型卡为准。",
      ],
      modules: {
        mmdit: {
          title: "JointTransformerBlock（MMDiT）：双流投影 → 序列维拼接 → 拆流",
          meta:
            "SD3.5-large：D=2432、38 个 block、qk_norm=rms_norm、FFN 为 GELU。下面把每一步的张量和运算写清楚，区分“序列维拼接”和“逐元素相加”。",
          diagram:
            '<div class="md-title">一个 MMDiT block 内部的数据流（以 SD3.5-large 为例）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">image tokens x [B,4096,2432] ｜ text tokens c [B,N_txt,2432]</div>' +
            '<span>↓ norm1 / norm1_context（AdaLN-Zero，由 t + pooled 生成 scale/shift/gate）</span>' +
            '<div class="md-pill md-pill-purple">图像：to_q/to_k/to_v → Q_i,K_i,V_i [B,heads,4096,64]<br>文本：add_q_proj/add_k_proj/add_v_proj → Q_t,K_t,V_t [B,heads,N_txt,64]</div>' +
            '<span>↓ RMSNorm 作用于 Q/K（qk_norm）</span>' +
            '<div class="md-pill md-pill-amber">concat(dim=2, 序列维)：Q=[Q_i‖Q_t]、K=[K_i‖K_t]、V=[V_i‖V_t]<br>形状 [B,heads,4096+N_txt,64]</div>' +
            '<span>↓ $\\mathrm{softmax}\\!\\left(\\dfrac{QK^\\top}{\\sqrt{64}}\\right)V$（一次联合 attention）</span>' +
            '<div class="md-pill md-pill-blue">联合输出 [B,heads,4096+N_txt,64] → flatten → [B,4096+N_txt,2432]</div>' +
            '<span>↓ split(seq)：image = [:, :4096]，text = [:, 4096:]</span>' +
            '<div class="md-pill">图像：to_out[0] → residual add；文本：to_add_out → residual add</div>' +
            '<span>↓ 各自 norm2 → FFN（GELU，2432→9728→2432）→ residual add</span>' +
            '<div class="md-pill md-pill-output">x [B,4096,2432] ｜ c [B,N_txt,2432] 送入下一个 block</div>' +
            "</div>" +
            '<div class="md-caption">关键区分：<b>concat 只发生在 attention 的 Q/K/V 序列维</b>；残差路径是<b>逐元素相加</b>；文本条件不是被复制或广播到每个图像 token，而是通过联合 attention 的 K/V 被读取。最后一个 block 之后只取图像 token（<code>context_pre_only</code> 的 block 甚至不计算文本 FFN），再由 norm_out + proj_out 输出 velocity。</div>',
          input: [
            "图像 token [B,4096,2432]（由 VAE latent 16×128×128 经 2×2 patch 化得到）；",
            "文本 token [B,N_txt,2432]（CLIP 2048 与 T5 4096 经 context_embedder 投影后拼接，具体长度按 pipeline 核验）；",
            "AdaLN 条件向量：timestep embedding 与 pooled [B,2048] 相加后投影。",
          ],
          output: [
            "同一 block 更新后的图像与文本 token，各自保持原形状；最后只从图像 token 走 norm_out + proj_out 得到 latent patch velocity。",
          ],
          role: [
            "在保留模态专属参数（各自的 QKV、FFN）的同时，让图像与文本在一次 attention 内互相读取，从而支持长文本与文字渲染。",
          ],
          repeat: [
            "38 次（SD3.5-large）；每个 denoising step 完整执行一遍，CFG 时翻倍。",
          ],
          extraTitle: "为什么不能写成 “image + text”",
          extra:
            "图像 token 与文本 token 的序列长度不同（4096 与 N_txt），无法逐元素相加，只能沿序列维拼接。图中出现 “+” 的位置只有三处：AdaLN 的残差路径、attention 输出投影后的残差、FFN 后的残差，三者都要求形状完全相同。",
        },
        clip: {
          title: "CLIP-L + CLIP-G 文本编码器",
          meta: "SD3.5 使用两个 CLIPTextModelWithProjection，序列条件与 pooled 条件分别输出。",
          diagram:
            '<div class="md-title">两个 CLIP 编码器：序列条件与 pooled 条件</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill">input_ids [B,77]（两套 tokenizer）</div>' +
            '<span>↓ CLIPTextModelWithProjection ×2（768 / 1280）</span>' +
            '<div class="md-pill md-pill-purple">last_hidden_state [B,77,768] 与 [B,77,1280]；text_embeds [B,768] 与 [B,1280]</div>' +
            '<span>↓ concat(channel) 序列条件 / concat(channel) pooled 条件</span>' +
            '<div class="md-pill md-pill-output">序列 [B,77,2048] → 与 T5 条件拼接；pooled [B,2048] → 进 time_text_embed</div>' +
            "</div>" +
            '<div class="md-caption">序列条件最终被 context_embedder 投影到 2432；pooled 不需要投影到模型宽度，它只参与 AdaLN 的调制生成。</div>',
          generic: {
            title: "CLIP 文本编码器的完整 block",
            note:
              "CLIP 的结构完全公开，但详情页通常只写“CLIP-L / CLIP-G”。框内是一个完整 CLIP text transformer：两个输出入口（序列条件与 pooled 条件）都在图里。",
            mermaid: [
              "flowchart TD",
              '  c0["prompt → CLIP tokenizer<br/>input_ids [B,77]"]:::in --> c1["token embedding + 位置 embedding<br/>[B,77,D]（D=768 或 1280）"]:::core',
              '  c1 --> c2["CLIP encoder block ×L（CLIP-L 12 层 / CLIP-G 32 层）<br/>LayerNorm → 因果 self-attention（heads×d_head）→ residual<br/>LayerNorm → MLP（4D→4D, GELU）→ residual<br/>[B,77,D]"]:::attn',
              '  c2 --> c3["final LayerNorm<br/>last_hidden_state [B,77,D]"]:::out',
              '  c3 --> c4["序列条件：hidden_states[-2] / last_hidden_state<br/>→ context_embedder → 进联合 attention 的 K/V"]:::latent',
              '  c3 --> c5["pooled 条件：EOS 位置 → text_projection<br/>[B,projection_dim] → 进时间 / AdaLN 调制"]:::latent',
            ].join("\n"),
            facts:
              "<b>两个出口不能混：</b>序列条件 <code>[B,77,768]</code> 与 <code>[B,77,1280]</code> 沿通道维拼成 <code>[B,77,2048]</code> 后进 attention 的 K/V；pooled 向量 <code>[B,1280]</code> 只参与时间/AdaLN 调制，不进 K/V。注意力是<b>因果 mask</b>（文本是序列建模），与图像侧的全局注意力不同。",
            linkHref: "index.html#atlas-text-encoder",
            linkText: "通用模块图鉴 17：CLIP / T5 文本编码器的完整张量级结构 →",
          },
          input: ["prompt 经过两套 CLIP tokenizer 得到的 input_ids [B,77]。"],
          output: [
            "序列条件 [B,77,2048] 与 pooled 条件 [B,2048]；两者进入主干的位置完全不同。",
          ],
          role: ["提供词级别的语义与一个全局语义向量，分别服务 attention 与时间调制。"],
          repeat: ["每个 prompt 一次，循环内不重算。"],
        },
      },
    },

    // ======================= FLUX ==========================================
    flux: {
      title: "FLUX · double-stream → single-stream → flow solver 的完整数据流",
      subtitle:
        "两条条件路径分开：T5 序列 hidden 进文本流；CLIP pooled 与 guidance 进调制向量。single-stream 把文本 token 与图像 token 沿 token 序列维拼接为一个序列。",
      kind: "FLUX.1 的 FluxTransformer2DModel 实现与 checkpoint config（dev/schnell 差异单列）",
      modalKicker: "FLUX 模块",
      networkFlow: [
        { title: "Pack latent", detail: "VAE latent 2×2 打包 → image tokens", tone: "latent" },
        { title: "Double-stream ×19", detail: "图像 / 文本保留各自参数，同时做联合 attention", tone: "core", module: "double" },
        { title: "Single-stream ×38", detail: "concat(seq) 后共用 attention + MLP", tone: "core", module: "single" },
        { title: "Split + unpack", detail: "保留 image token → velocity → flow solver", tone: "output" },
      ],
      sourcesBrief: [
        [
          "single-stream 的拼接维度",
          "代码事实：<code>hidden_states = torch.cat([encoder_hidden_states, hidden_states], dim=1)</code>，即 <b>[B,N_txt,D] 与 [B,N_img,D] 沿 token 序列维拼接</b>得 [B,N_txt+N_img,D]；结束时 <code>text = [:, :N_txt]</code>、<code>image = [:, N_txt:]</code>。依据：Diffusers transformer_flux.py。",
        ],
        [
          "CLIP / T5 的分工",
          "T5-XXL 的序列 hidden 经 <code>txt_in</code> 进入文本流（joint_attention_dim=4096）；CLIP 的 pooled embedding（pooled_projection_dim=768）与 timestep、guidance 一起经 <code>time_text_embed</code> 生成各 block 的调制向量。两者不能互换位置。",
        ],
      ],
      stages: [
        {
          id: "df-input",
          kicker: "输入",
          title: "真实输入",
          nodes: [
            {
              id: "prompt",
              kind: "input",
              title: "prompt",
              shape: "字符串",
              meta: "CLIP 侧 77 token；T5 侧最多 512 token（超长会被截断）",
            },
          ],
        },
        {
          id: "df-text",
          kicker: "第 02 步 · 循环外一次",
          title: "文本条件：序列 hidden 与 pooled 走向不同",
          nodes: [
            {
              id: "t5",
              kind: "core",
              title: "T5-XXL 编码器",
              shape: "hidden [B,N_t5,4096]",
              meta: "N_t5 = 实际 token 数，最多 512",
              detail: true,
            },
            op(
              "encode",
              "txt_in（Linear 4096→3072）",
              "投影到模型宽度 D=3072；只处理 T5 序列，不使用 pooled",
            ),
            {
              kind: "condition",
              title: "文本 token 序列 c_txt",
              shape: "[B,N_t5,3072]",
              meta: "进入 double-stream 的文本侧与 single-stream 序列前端",
            },
            op(
              "add",
              "pooled + t + guidance → 调制向量",
              "pooled [B,768] 与 timestep embedding 相加后生成 scale/shift/gate",
            ),
          ],
          drop:
            '<b>CLIP 的实际位置：</b> FLUX.1 的 CLIP-L 不提供序列条件，只贡献 <code>pooled [B,768]</code>；它被 <code>time_text_embed</code> 投影后与 timestep（以及可选的 guidance embedding）<b>逐元素相加</b>，成为每个 block 的调制向量 <code>temb</code>。所以「CLIP 和 T5 都提供文本条件」这句话必须拆成：T5 = attention 读取的序列条件，CLIP = 调制向量的全局条件。',
        },
        {
          id: "df-latent",
          kicker: "第 03 步 · 循环外一次",
          title: "图像 latent：pack 成 token",
          nodes: [
            {
              kind: "external",
              title: "VAE Encode（I2I / 编辑）",
              shape: "RGB [B,3,H,W] → z₀ [B,16,H/8,W/8]",
              meta: "16 通道 latent",
            },
            op(
              "encode",
              "pack：2×2 邻域打包 + x_embedder",
              "[B,16,128,128] → [B,4096,64] → Linear 64→3072",
            ),
            {
              kind: "state",
              title: "image tokens x",
              shape: "[B,N_img,3072]，1024×1024 时 N_img=4096",
              meta: "packed latent 不是 4 通道；这是 FLUX 与 SD 系列最容易被写错的地方",
            },
            op(
              "encode",
              "MM-RoPE 位置坐标",
              "文本 token 用 (0,0,0..)，图像 token 用 (0,h,w) 三维坐标；axes_dims=[16,56,56]",
            ),
          ],
        },
        {
          id: "df-double",
          kicker: "第 04 步 · 重复 num_layers 个（FLUX.1-dev: 19）",
          title: "Double-stream blocks：两条流各自投影，attention 内联合",
          nodes: [
            {
              id: "double",
              kind: "core",
              title: "FluxTransformerBlock",
              shape: "image [B,4096,3072] + text [B,N_t5,3072]",
              meta: "各自 norm1/norm1_context、各自 QKV、各自 FFN、各自残差",
              detail: true,
            },
            op(
              "read",
              "attention read(dim=1 序列维)",
              "query = cat([Q_txt, Q_img], dim=1)，同理 K/V；一次 attention 后按 F/N 切回",
            ),
            {
              kind: "state",
              title: "两路输出",
              shape: "image token 与 text token（形状不变）",
              meta: "各自 out projection + residual add，再各自 FFN + residual add",
            },
          ],
        },
        {
          id: "df-single",
          kicker: "第 05 步 · 重复 num_single_layers 个（FLUX.1-dev: 38）",
          title: "Single-stream blocks：沿 token 序列维拼接后共用一套权重",
          nodes: [
            op(
              "cat",
              "concat(seq)：torch.cat([text, image], dim=1)",
              "[B,N_txt,3072] + [B,N_img,3072] → [B,N_txt+N_img,3072]",
            ),
            {
              id: "single",
              kind: "core",
              title: "FluxSingleTransformerBlock",
              shape: "[B,N_txt+N_img,3072]",
              meta: "一套 QKV + 一套 MLP；proj_out 的输入是 concat(channel)[attn_out, mlp_out]",
              detail: true,
            },
            op(
              "split",
              "split(seq)",
              "encoder_hidden_states = [:, :N_txt]，hidden_states = [:, N_txt:]",
            ),
          ],
          drop:
            "single-stream 内部还有一处容易混的运算：<code>hidden_states = torch.cat([attn_output, mlp_hidden_states], dim=2)</code> 是<b>通道维拼接</b>（3072 + 12288），随后由 <code>proj_out</code>（Linear 15360→3072）投影回来，再与残差做<b>逐元素相加</b>。这两种拼接维度不同，不能都写成 “concat”。",
        },
        {
          id: "df-out",
          kicker: "第 06 步 · 每个 step",
          title: "只取图像 token 得到 velocity",
          nodes: [
            {
              kind: "state",
              title: "取 image token",
              shape: "[B,N_img,3072]",
              meta: "丢弃文本 token；文本段只在主干内部起作用",
            },
            {
              kind: "output",
              title: "norm_out + proj_out",
              shape: "→ [B,N_img,64] → unpack → [B,16,H/8,W/8]",
              meta: "proj_out 输出 64 维 patch vector（16 通道 × 2×2）",
            },
          ],
        },
        {
          id: "df-solver",
          kicker: "第 07 步 · 每一步",
          title: "flow solver 与循环",
          loop: true,
          nodes: [
            {
              kind: "state",
              title: "z_t（packed）",
              shape: "[B,4096,64]",
              meta: "当前插值状态",
            },
            op(
              "solver",
              "scheduler.step（flow match）",
              "z_{t−1} = z_t + (σ_{t−1} − σ_t)·v；schnell 用 4 步左右，dev 用 20—50 步",
            ),
            {
              kind: "state",
              title: "z_{t−1}",
              shape: "[B,4096,64]",
              meta: "回到 x_embedder 之前的状态（第 03 步），不是回到文本编码",
            },
            {
              kind: "output",
              title: "unpack → VAE Decode",
              shape: "RGB [B,3,H,W]",
              meta: "反打包回 [B,16,H/8,W/8] 后解码",
            },
          ],
        },
      ],
      loop: {
        title: "多步循环的闭合关系",
        counter: "t = T … 1，共 num_inference_steps 步",
        steps: [
          [
            {
              kind: "loop",
              title: "回到哪一层",
              shape: "packed latent → x_embedder",
              meta: "每轮重新经过 double-stream 的全部层，再进 single-stream",
            },
            op("solver", "z_{t−1} → z_t", "同时把新的 t/sigma 送入调制向量"),
            {
              kind: "state",
              title: "每轮变化",
              shape: "z_t、t/sigma",
              meta: "T5 序列与 CLIP pooled 固定，但每个 block 每轮重新读取",
            },
            {
              kind: "output",
              title: "退出",
              shape: "σ = 0",
              meta: "unpack → VAE Decode",
            },
          ],
        ],
        ret:
          "闭合点：solver 输出的 <b>z_{t−1}</b> 回到 <b>x_embedder 之前的 packed latent</b>（第 03 步）。注意每轮都会重新做一次 pack 前的 reshape 与 RoPE 坐标构造，但 T5/CLIP 都不重新编码。",
      },
      conditions: [
        {
          name: "c_txt（T5 序列）",
          where: "循环外一次（txt_in 投影）",
          fixed: "不重算",
          read: "double-stream 的 add_q/add_k/add_v；single-stream 拼接序列的前 N_txt 段",
        },
        {
          name: "pooled（CLIP） + t + guidance",
          where: "循环外一次（pooled）；t 每步变化",
          fixed: "pooled 固定；t、guidance 按步变化",
          read: "time_text_embed → 每个 block 的 AdaLN 调制（scale/shift/gate）",
        },
        {
          name: "img_ids / txt_ids",
          where: "循环外构造",
          fixed: "图像分支每轮按 z_t 的网格重新构造（形状不变）",
          read: "RoPE：作用于 Q/K，不改变张量形状",
        },
        {
          name: "源图 latent / mask（编辑类 checkpoint）",
          where: "初始化或作为额外 token",
          fixed: "取决于具体 pipeline（Fill / Kontext / Redux 各不相同）",
          read: "拼接进 latent 序列或作为额外条件 token，必须按该 checkpoint 的 pipeline 核对",
        },
      ],
      conditionsNote:
        "guidance embedding 是模型的一个输入条件（guidance-distilled 变体），它与 CFG 不是同一件事：schnell 常用 guidance_scale=0.0 且只跑一次 forward。",
      cost:
        "D=3072、double 19 + single 38（FLUX.1-dev）；单序列 attention 长度 N_txt+N_img。1024×1024 时 N_img=4096，T5 最长 512，因此 single-stream 的 attention 序列约 4608 个 token。",
      loss: {
        summary:
          "FLUX 用 rectified flow 训练：Transformer 回归从噪声到数据直线路径上的速度；sampling 才是多步 ODE 积分。",
        flow: [
          ["真实 latent", "x → VAE → z₀ → pack", "packed image token", "data"],
          ["插值状态", "$\\epsilon \\sim \\mathcal{N}(0,I)$、$t \\in [0,1]$", "$z_t = (1-t)\\,z_0 + t\\,\\epsilon$", "noise"],
          ["Transformer", "vθ(z_t, t, c_txt, pooled, guidance)", "double → single，最后只取图像 token", "model"],
          ["速度目标", "$u_t = \\epsilon - z_0$", "路径在该点的真实方向", "target"],
          ["反向传播", "MSE → ∇θL", "更新 image 侧或 joint LoRA", "loss"],
        ],
        formula: "$L = \\mathbb{E}\\left[\\, \\| v_\\theta(z_t, t, c_{\\text{txt}}, c_{\\text{pooled}}) - (\\epsilon - z_0) \\|^2 \\right]$",
        target:
          "target 是 flow 速度，不是 VAE 像素重建误差；noise 路径、logit-normal 时间采样等细节以官方 flux 仓库训练脚本为准。",
        gradient:
          "LoRA 常见挂在 double/single 的 to_q/to_k/to_v/to_out、add_q_proj/add_k_proj/add_v_proj、to_add_out 与 ff 的 proj/linear；VAE、CLIP、T5 默认冻结。",
        inference:
          "flow solver 用模型输出的速度推进 packed latent；guidance embedding 是模型输入，不参与训练损失中的 CFG 组合。",
      },
      finetune: [
        [
          "1. 数据形式",
          "T2I：image + caption（caption 建议由 T5 友好的完整句子构成）；文字任务加精确转写与语言；编辑任务需要 source/target/instruction，并按具体 checkpoint 的 pipeline 决定是否使用 mask。",
        ],
        [
          "2. 可训练模块",
          "先打印 transformer.named_modules()；FLUX.1 的层名是 transformer_blocks.*（double）与 single_transformer_blocks.*（single），两处命名不同，不能只写一份 target_modules。",
        ],
        [
          "3. 冻结范围",
          "VAE、CLIP、T5 冻结；显存不足时先只训 single-stream 或只训 attention 投影。",
        ],
        [
          "4. 训练目标",
          "packed latent + flow velocity 回归；pack 方式（2×2 打包）必须与基座一致，否则 loss 会正常下降但输出全错。",
        ],
        [
          "5. 验收方法",
          "固定 solver、步数、guidance、分辨率与 seed；比较结构、风格、文字、长 prompt、未见宽高比和旧能力保持。",
        ],
      ],
      finetuneData: {
        intro: "FLUX 的训练样本必须同时适配 CLIP pooled 条件与 T5 序列条件；编辑样本的字段随 Fill、Kontext、Redux 等 checkpoint 变化，先按 pipeline 签名确认。",
        rows: [
          ["文生图 / 风格", "image、caption、width、height、split", "结构、风格、长 prompt、未见宽高比"],
          ["文字渲染", "image、caption、transcription、language、text boxes", "字符准确率、布局、背景稳定性"],
          ["图像编辑", "source、target、instruction，mask 按 checkpoint 决定", "编辑成功率、非编辑区保持、边缘融合"],
        ],
        sampleTitle: "JSONL · FLUX 最小样本",
        sample: '{"image":"train/sign_001.png","caption":"A red street sign reading OPEN","transcription":"OPEN","language":"en","split":"train"}',
      },
      finetuneLoss: {
        summary: "FLUX LoRA 沿用 rectified flow 的速度回归，训练时只更新选中的 double / single stream 增量参数。",
        formula: "$L_{\\text{lora}} = \\mathbb{E}\\left[\\, \\| v_{W+\\Delta W_{\\text{lora}}}(z_t,t,c_{\\text{txt}},c_{\\text{pooled}}) - (\\epsilon - z_0) \\|^2 \\right]$",
        note: "packed latent、时间采样和 weighting 必须与基座一致；VAE、CLIP、T5 默认冻结。",
      },
      sources: [
        {
          item: "FLUX.1 的 double/single stream 与 flow matching 训练",
          links:
            '<a href="https://github.com/black-forest-labs/flux" target="_blank" rel="noopener">black-forest-labs/flux 官方仓库</a>',
          evidence:
            "官方仓库给出模型定义与采样代码，是目前唯一权威的架构来源；FLUX.1 没有经过同行评审的架构论文。",
        },
        {
          item: "single-stream 沿 token 序列维拼接",
          links:
            '<a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/transformers/transformer_flux.py" target="_blank" rel="noopener">Diffusers transformer_flux.py</a>',
          evidence:
            "cat(dim=1) 与 [:, :N_txt] / [:, N_txt:] 的切分是代码级事实，可直接引用。",
        },
        {
          item: "Dimensions：19 double / 38 single / D=3072 / joint_attention_dim=4096 / pooled 768",
          links:
            '<a href="https://huggingface.co/black-forest-labs/FLUX.1-dev" target="_blank" rel="noopener">FLUX.1-dev 模型卡与 config</a>',
          evidence:
            "属于 checkpoint 配置事实；FLUX.1-schnell 的 guidance_embeds 与层数配置不同，必须分别读取。",
        },
        {
          item: "rectified flow 训练目标",
          links:
            '<a href="https://arxiv.org/abs/2209.03003" target="_blank" rel="noopener">Rectified Flow (arXiv:2209.03003)</a> · <a href="https://arxiv.org/abs/2403.03206" target="_blank" rel="noopener">SD3 (arXiv:2403.03206)</a>',
          evidence:
            "说明直线路径与速度回归的数学形式；具体时间采样分布与 weighting 属于 FLUX 训练细节，官方未完整公开。",
        },
      ],
      unknown: [
        "FLUX.1 变体（dev / schnell / Krea / Fill / Kontext / Redux）的层数、guidance_embeds、条件 token 组织不同：必须读各自 transformer/config.json 与 pipeline。",
        "官方未公开完整训练数据、时间采样分布与全部训练超参；本页只写代码与 config 能证实的内容。",
        "不同实现可能使用融合 QKV 或不同的模块命名；LoRA target_modules 必须以打印出的真实模块树为准。",
      ],
      modules: {
        double: {
          title: "FluxTransformerBlock（double-stream）：两条流各自变换，在 attention 内联合",
          meta: "FLUX.1-dev：dim=3072、24 heads × head_dim 128、RMSNorm 作用于 Q/K。",
          diagram:
            '<div class="md-title">double-stream block 内部（以 FLUX.1-dev 为例）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">image x [B,4096,3072] ｜ text c [B,N_t5,3072]</div>' +
            '<span>↓ norm1 / norm1_context（AdaLN-Zero，由 temb 生成 scale/shift/gate）</span>' +
            '<div class="md-pill md-pill-purple">图像：to_q/to_k/to_v → Q_i,K_i,V_i [B,24,4096,128]；文本：add_q_proj/add_k_proj/add_v_proj → Q_t,K_t,V_t [B,24,N_t5,128]</div>' +
            '<span>↓ RMSNorm 应用于 Q/K；RoPE 按 (0,h,w) 与文本坐标施加</span>' +
            '<div class="md-pill md-pill-amber">concat(dim=1, 序列维)：Q=[Q_t‖Q_i]、K=[K_t‖K_i]、V=[V_t‖V_i] → [B,24,N_t5+4096,128]</div>' +
            '<span>↓ $\\mathrm{softmax}\\!\\left(\\dfrac{QK^\\top}{\\sqrt{128}}\\right)V$</span>' +
            '<div class="md-pill md-pill-blue">joint 输出 [B,N_t5+4096,3072] → split(seq)：text = [:, :N_t5]，image = [:, N_t5:]</div>' +
            '<span>↓ 各自 out projection → residual add（逐元素）</span>' +
            '<div class="md-pill">image：ff.net（GELU 门控 MLP）→ residual add；text：ff_context → residual add</div>' +
            '<div class="md-pill md-pill-output">更新后的 image / text token（形状不变）</div>' +
            "</div>" +
            '<div class="md-caption">double-stream = 两套权重 + 一次联合 attention；两流的宽度都是 3072，因此也能沿序列维拼接 Q/K/V。残差路径始终是逐元素相加，形状必须一致。</div>',
          input: [
            "图像 token [B,4096,3072] 与文本 token [B,N_t5,3072]；调制向量 temb [B,3072×6]（由 t、pooled 与可选 guidance 生成）。",
          ],
          output: ["同形状的两路 token，送入下一个 double-stream block。"],
          role: [
            "在保留模态专属参数的同时做跨模态信息交换：文本用 add_* 投影、图像用 to_* 投影，attention 的 K/V 对两者都开放。",
          ],
          repeat: ["19 次（FLUX.1-dev）；每个 denoising step 完整执行。"],
          extraTitle: "和 SD3 MMDiT 的区别",
          extra:
            "数学形式相同（独立 QKV + 序列维拼接的联合 attention），但 FLUX 的 double-stream 之后还要进入 <b>single-stream</b>，把两种 token 合成一个序列共用权重；SD3 全程保持双流。这也是不能把两者架构图画成同一张的原因。",
        },
        single: {
          title: "FluxSingleTransformerBlock：拼接序列 + 注意力与 MLP 并行",
          meta: "FLUX.1-dev：38 层；proj_mlp 输出 4×dim=12288，proj_out 输入 3072+12288=15360。",
          diagram:
            '<div class="md-title">single-stream block 内部（以 FLUX.1-dev 为例）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">concat(seq)：torch.cat([text, image], dim=1) → [B,N_t5+4096,3072]</div>' +
            '<span>↓ norm（AdaLayerNormZeroSingle）→ 得到归一化 hidden 与 gate</span>' +
            '<div class="md-pill md-pill-purple">并行两支：① attn（to_q/to_k/to_v → 24 heads）；② proj_mlp → GELU → [B,N,12288]</div>' +
            '<span>↓ attention 输出 [B,N,3072]；MLP 输出 [B,N,12288]</span>' +
            '<div class="md-pill md-pill-amber">concat(channel)：torch.cat([attn_output, mlp_hidden_states], dim=2) → [B,N,15360]</div>' +
            '<span>↓ proj_out（Linear 15360→3072）→ gate 逐元素相乘</span>' +
            '<div class="md-pill">residual add：与拼接前的 hidden_states 逐元素相加</div>' +
            '<span>↓ split(seq) 还原两条流（形状仍为 [B,N_t5,3072] 与 [B,4096,3072]）</span>' +
            '<div class="md-pill md-pill-output">送入下一个 single-stream block</div>' +
            "</div>" +
            '<div class="md-caption">这里同时出现两种拼接：<b>序列维拼接</b>把文本与图像合成一个序列；<b>通道维拼接</b>把 attention 输出与 MLP 输出拼在一起再投影。写图时必须分别标明维度，否则读者无法判断形状。</div>',
          input: [
            "文本 token [B,N_t5,3072] 与图像 token [B,4096,3072]（来自最后一个 double-stream block），以及调制向量 temb。",
          ],
          output: [
            "同形状的两路 token；最后一层之后只保留图像 token 交给输出头。",
          ],
          role: [
            "让文本与图像在共享权重下继续交互，等价于一个带条件 token 的普通 Transformer 主干，参数量与显存效率更高。",
          ],
          repeat: ["38 次（FLUX.1-dev）；每个 denoising step 完整执行。"],
        },
        t5: {
          title: "T5-XXL 文本编码器",
          meta: "序列条件来源；joint_attention_dim=4096 即 T5 的 d_model。",
          diagram:
            '<div class="md-title">T5-XXL 编码文本序列</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill">input_ids [B,≤512]（T5 tokenizer，spiece）</div>' +
            '<span>↓ 24 层 encoder（d_model=4096、d_ff=10240、64 heads）</span>' +
            '<div class="md-pill md-pill-purple">last_hidden_state [B,N_t5,4096]</div>' +
            '<span>↓ txt_in（Linear 4096→3072）</span>' +
            '<div class="md-pill md-pill-output">文本 token [B,N_t5,3072] 进入主干</div>' +
            "</div>" +
            '<div class="md-caption">T5 使用 encoder-only 部分；padding 位置会被 mask 或按 pipeline 处理，具体策略按实现核对。</div>',
          generic: {
            title: "T5 encoder 的完整 block",
            note:
              "T5 的结构完全公开，但详情页通常只写“joint_attention_dim=4096”。框内是一个完整 T5 encoder：从 token embedding 到 txt_in 投影。",
            mermaid: [
              "flowchart TD",
              '  t0["prompt → T5 tokenizer（spiece）<br/>input_ids [B,N_t5]（≤512）"]:::in --> t1["token embedding + 相对位置 bias<br/>[B,N_t5,4096]"]:::core',
              '  t1 --> t2["T5 encoder block ×24<br/>RMSNorm → self-attention（64 heads × d_head 64，无因果 mask）→ residual<br/>RMSNorm → FFN（4096→10240→4096）→ residual<br/>[B,N_t5,4096]"]:::attn',
              '  t2 --> t3["final RMSNorm<br/>last_hidden_state [B,N_t5,4096]"]:::out',
              '  t3 --> t4["txt_in（Linear 4096→D_model）<br/>[B,N_t5,D_model]"]:::latent',
              '  t4 --> t5["作为文本 token 进 double-stream 与 single-stream<br/>每步被主干重新读取"]:::out',
            ].join("\n"),
            facts:
              "<b>和 CLIP 的三处差别：</b>① 归一化用 RMSNorm 而不是 LayerNorm；② 位置信息来自<b>相对位置 bias</b>，不是可学习的位置 embedding；③ encoder-only、无因果 mask，且不提供 pooled 向量，所以文本条件只有“序列”这一个入口。padding 位置如何 mask 要按 pipeline 的 <code>encode_prompt</code> 核对。",
            linkHref: "index.html#atlas-text-encoder",
            linkText: "通用模块图鉴 17：CLIP / T5 文本编码器的完整张量级结构 →",
          },
          input: ["prompt 经 T5 tokenizer 得到的 input_ids。"],
          output: ["序列 hidden [B,N_t5,4096]，投影后为 [B,N_t5,3072]。"],
          role: ["提供长文本与复杂语义的序列条件，是文字渲染与长 prompt 能力的主要来源。"],
          repeat: ["每个 prompt 一次，循环内不重算。"],
        },
      },
    },

    // ======================= Qwen-Image / Edit =============================
    qwen: {
      title: "Qwen-Image / Edit · 文本 + 图像双条件的完整数据流",
      subtitle:
        "Qwen-Image 不是 SD3 或 FLUX 的复制品：文本编码器是 Qwen2.5-VL，图像 latent 为 16 通道并打包成 64 维 patch token，Edit 路径把同一张源图分别送入 Qwen2.5-VL 与 VAE。",
      kind: "Qwen-Image / Qwen-Image-Edit-2509 的公开 config 与 Diffusers QwenImageTransformer2DModel 实现",
      modalKicker: "Qwen-Image 模块",
      networkFlow: [
        { title: "VAE latent", detail: "16 通道 latent；2×2 邻域打包为 64 维 patch token", tone: "latent" },
        { title: "Qwen2.5-VL 条件", detail: "文本与 Edit 参考图形成多模态序列", tone: "condition", module: "vl" },
        { title: "MMDiT ×60", detail: "24 heads × 128；joint attention + MLP", tone: "core", module: "trf" },
        { title: "Output + decode", detail: "64 维 patch velocity → unpack → VAE decode", tone: "output" },
      ],
      sourcesBrief: [
        [
          "Edit 的双重编码",
          "技术报告明确：源图<b>分别</b>送入 Qwen2.5-VL（语义表示）和 VAE encoder（重建表示），并加入 I2I reconstruction 任务来对齐两者 latent。所以源图有两条进入路径，不是一条。",
        ],
        [
          "打包与位置编码",
          "latent 为 16 通道，pipeline 把 2×2 邻域打包成 <code>[B,(H′/2)·(W′/2),64]</code>（16×4），transformer 的 <code>in_channels=64</code>；RoPE 使用 <code>axes_dims_rope=[16,56,56]</code>，总维度 128 与 <code>attention_head_dim=128</code> 匹配。",
        ],
      ],
      stages: [
        {
          id: "df-input",
          kicker: "输入",
          title: "真实输入",
          nodes: [
            {
              id: "prompt",
              kind: "input",
              title: "prompt / 编辑指令",
              shape: "字符串（中英文）",
              meta: "Edit 时指令描述要改什么、保留什么",
            },
            {
              id: "source",
              kind: "external",
              title: "可选：源图（Edit / I2I）",
              shape: "RGB [B,3,H,W]",
              meta: "进入两条不同的编码路径，见第 03b 步",
            },
          ],
        },
        {
          id: "df-text",
          kicker: "第 02 步 · 循环外一次",
          title: "文本条件：Qwen2.5-VL 而非 CLIP/T5",
          nodes: [
            {
              id: "vl",
              kind: "core",
              title: "Qwen2.5-VL 文本/多模态编码器",
              shape: "hidden [B,N_txt,3584]",
              meta: "joint_attention_dim=3584；输出取指定层的 hidden states",
              detail: true,
            },
            op(
              "encode",
              "txt_norm + txt_in",
              "归一化后线性投影到模型宽度 D=3072（24 heads × 128）",
            ),
            {
              kind: "condition",
              title: "c_text",
              shape: "[B,N_txt,3072]",
              meta: "与图像 token 在主干内做联合 attention；不参与时间调制",
            },
            op(
              "add",
              "time_text_embed（t + 可选 additional_t_cond）",
              "生成每个 block 的调制向量；Qwen-Image 不使用 pooled 文本向量",
            ),
          ],
        },
        {
          id: "df-latent",
          kicker: "第 03 步 · 循环外一次",
          title: "图像 latent：16 通道 → 2×2 打包成 64 维 token",
          nodes: [
            {
              kind: "external",
              title: "VAE Encode（Edit / I2I）",
              shape: "RGB [B,3,H,W] → [B,16,H/8,W/8]",
              meta: "latents_mean / latents_std 逐通道归一化；z_dim=16",
            },
            op(
              "encode",
              "pack：reshape+permute，把 2×2×16 合成 64",
              "[B,16,H′,W′] → [B,(H′/2)·(W′/2),64]",
            ),
            {
              kind: "state",
              title: "image tokens",
              shape: "[B,N_img,64]",
              meta: "1328×1328 时 H′=W′=166，N_img=83×83=6889",
            },
            op(
              "encode",
              "img_in（Linear 64→3072）+ 3D RoPE",
              "投影后与文本 token 一起进入主干；RoPE 使用 (t,h,w) 坐标",
            ),
          ],
          drop:
            "<b>不要照抄 SD/FLUX 的通道数：</b> Qwen-Image 的 transformer <code>in_channels=64</code>、<code>out_channels=16</code>、<code>patch_size=2</code>，这是“先打包再进 transformer”的设计。<code>attention_head_dim=128</code> 而 <code>axes_dims_rope=[16,56,56]</code>，两者相加正好 128。",
        },
        {
          id: "df-edit",
          kicker: "第 03b 步 · 仅 Edit / 参考图任务",
          title: "Edit：源图的两条编码路径（本次修正重点）",
          nodes: [
            op(
              "encode",
              "路径 A：Qwen2.5-VL 视觉编码",
              "源图与指令一起送入 VL 编码器，得到语义 token（与文本同一序列空间）",
            ),
            {
              kind: "condition",
              title: "语义条件 token",
              shape: "[B,N_ref,3584] → 投影后进主干",
              meta: "负责“改什么、保留什么”的语义对齐",
            },
            op(
              "encode",
              "路径 B：VAE Encode",
              "同一张源图编码为重建 latent，再打包成 64 维 token",
            ),
            {
              kind: "state",
              title: "重建条件 token",
              shape: "[B,N_img,64]",
              meta: "负责像素级外观与细节保持",
            },
          ],
          drop:
            "两条路径对齐来自技术报告的 I2I reconstruction 任务。Edit 是否支持 mask、支持几张参考图，取决于具体 pipeline 版本（Edit / Edit-2509 / Edit-Plus）：<b>本页不假设所有版本都接受 mask</b>，请核对所选 pipeline 的签名。",
        },
        {
          id: "df-block",
          kicker: "第 04 步 · 重复 num_layers 个（60）",
          title: "主干：图像与文本 token 的联合 attention",
          nodes: [
            {
              id: "trf",
              kind: "core",
              title: "QwenImageTransformer2DModel block",
              shape: "image [B,N_img,64]→[B,N_img,3072] ｜ text [B,N_txt,3072]",
              meta: "attention 内沿序列维联合；文本 mask 用于屏蔽 padding",
              detail: true,
            },
            op(
              "read",
              "attention read：图像 query 读取文本/参考 token",
              "encoder_hidden_states_mask 保证 padding 文本不参与",
            ),
            {
              kind: "output",
              title: "输出 latent velocity",
              shape: "[B,N_img,64] → unpack → [B,16,H′,W′]",
              meta: "只取图像 token；文本 token 不输出",
            },
          ],
        },
        {
          id: "df-solver",
          kicker: "第 05 步 · 每一步",
          title: "flow scheduler 与循环",
          loop: true,
          nodes: [
            {
              kind: "state",
              title: "z_t（packed）",
              shape: "[B,N_img,64]",
              meta: "当前状态",
            },
            op(
              "solver",
              "FlowMatchEulerDiscreteScheduler.step",
              "按 sigma 序列积分；具体 shift/步数由 pipeline 默认参数决定",
            ),
            {
              kind: "state",
              title: "z_{t−1}",
              shape: "[B,N_img,64]",
              meta: "回到 img_in（第 03 步）之前的 packed latent",
            },
            {
              kind: "output",
              title: "unpack → VAE Decode",
              shape: "RGB [B,3,H,W]",
              meta: "反归一化（latents_mean/std）后解码",
            },
          ],
        },
      ],
      loop: {
        title: "多步循环的闭合关系",
        counter: "t = T … 1（默认步数按 pipeline）",
        steps: [
          [
            {
              kind: "loop",
              title: "回到哪一层",
              shape: "img_in 之前的 packed latent",
              meta: "文本与参考图的编码结果不重算",
            },
            op("solver", "z_{t−1} → z_t", "t 与调制向量每轮更新"),
            {
              kind: "state",
              title: "每轮变化",
              shape: "z_t、t",
              meta: "c_text 与参考条件固定，每个 block 每轮重新读取",
            },
            {
              kind: "output",
              title: "退出",
              shape: "sigma = 0",
              meta: "unpack + 反归一化 + VAE Decode",
            },
          ],
        ],
        ret:
          "闭合点：solver 输出的 <b>z_{t−1}</b> 回到 <b>img_in 之前的 packed latent</b>（第 03 步）。Edit 的源图 latent 是否每轮重新合成（例如 mask 混合）取决于具体实现，本页不把这种推断写成事实。",
      },
      conditions: [
        {
          name: "c_text（Qwen2.5-VL hidden）",
          where: "循环外一次",
          fixed: "不重算",
          read: "每个 block 的联合 attention；padding 由 encoder_hidden_states_mask 屏蔽",
        },
        {
          name: "参考图语义 token（Edit）",
          where: "循环外一次（VL 编码）",
          fixed: "不重算",
          read: "与文本 token 同一序列空间，参与联合 attention",
        },
        {
          name: "参考图重建 latent（Edit）",
          where: "循环外一次（VAE 编码 + pack）",
          fixed: "不重算",
          read: "作为额外图像 token 或初始化条件；具体组织方式按 pipeline 版本核对",
        },
        {
          name: "t / additional_t_cond",
          where: "每一步",
          fixed: "每步变化",
          read: "time_text_embed → 调制向量",
        },
      ],
      conditionsNote:
        "Qwen-Image 的条件入口只有文本（多模态）序列与图像 latent token 序列；它不使用 CLIP pooled 向量或 SDXL 的 added time/size ids。",
      cost:
        "60 层、D=3072、24 heads；N_img 随分辨率平方增长（1328×1328 → 6889 token），全注意力下显存压力明显。官方推荐分辨率附近的 token 数才在训练分布内。",
      loss: {
        summary:
          "技术报告描述的是 flow matching（velocity）路线，并加入 T2I / TI2I / I2I reconstruction 多任务训练来对齐 Qwen2.5-VL 与 MMDiT 的 latent 表示。",
        flow: [
          ["目标图像", "x → VAE → z₀（16 通道）", "T2I 或 Edit 的 target latent", "data"],
          ["构造状态", "ε、t（Edit 另有源图条件）", "按 flow 路径得到 z_t", "noise"],
          ["Qwen Transformer", "vθ(z_t, t, c_text, c_ref)", "联合 attention 读取文本与参考", "model"],
          ["速度目标", "$u_t = \\epsilon - z_0$（按报告定义）", "以该 checkpoint 的 scheduler/训练脚本为准", "target"],
          ["反向传播", "MSE → ∇θL", "主干或 LoRA；另有 I2I 重建项", "loss"],
        ],
        formula: "$L = \\mathbb{E}\\left[\\, \\| v_\\theta(z_t, t, c_{\\text{text}}, c_{\\text{ref}}) - u_t \\|^2 \\right]$（+ I2I reconstruction 项，权重未公开）",
        target:
          "target 是 velocity；报告未完整公开时间采样分布、loss 权重与全部训练细节，这部分标注为未核实。",
        gradient:
          "VAE 与 Qwen2.5-VL 通常冻结；可训练的是 QwenImageTransformer2DModel 的 attention/MLP 投影或其 LoRA。",
        inference:
          "推理由 flow scheduler 多步积分；Edit 的 mask/参考条件如何每步参与需要按 pipeline 实现核对。",
      },
      finetune: [
        [
          "1. 数据形式",
          "T2I：image + caption（中英文都要覆盖）+ 精确画面文字转写；Edit：source + target + instruction 严格配对，mask 只在所选 pipeline 支持时使用。",
        ],
        [
          "2. 可训练模块",
          "先打印 transformer.named_modules()：注意力 q/k/v/out、MLP（ff / mlp / gate-up-down 命名随实现）、以及 img_in / txt_in 条件投影。",
        ],
        [
          "3. 冻结范围",
          "VAE 与 Qwen2.5-VL 默认冻结；Edit 任务不宜同时解冻 VL 编码器。",
        ],
        [
          "4. 训练目标",
          "flow velocity 回归；latent 归一化（latents_mean/std）、16 通道与 2×2 打包必须与基座一致。",
        ],
        [
          "5. 验收方法",
          "分别测试中文/英文长文本渲染、字符准确率、编辑区域成功率、非编辑区保持，以及未见宽高比。",
        ],
      ],
      finetuneData: {
        intro: "Qwen-Image 的 T2I 样本要覆盖中文 / 英文文本和画面文字；Edit 样本要严格配对 source、target、instruction，mask 只在所选 pipeline 明确支持时使用。",
        rows: [
          ["文生图", "image、caption、transcription、language、width、height", "中文 / 英文长文本、字符准确率、未见宽高比"],
          ["图像编辑", "source、target、instruction、mask（可选）、split", "编辑区域成功率、非编辑区保持"],
          ["参考图条件", "reference image、caption / instruction、target、split", "身份与构图一致性、条件组合稳定性"],
        ],
        sampleTitle: "JSONL · Qwen-Image Edit 最小样本",
        sample: '{"source":"edit/in_004.png","target":"edit/out_004.png","instruction":"把杯子改成红色，保留手和桌面","split":"train"}',
      },
      finetuneLoss: {
        summary: "Qwen-Image 微调沿用 flow velocity 回归；Edit 的重建项与权重是否启用由具体 pipeline 和训练代码决定。",
        formula: "$L_{\\text{lora}} = \\mathbb{E}\\left[\\, \\| v_{W+\\Delta W_{\\text{lora}}}(z_t,t,c_{\\text{text}},c_{\\text{ref}}) - u_t \\|^2 \\right] + \\lambda_{\\text{rec}}\\,L_{\\text{reconstruction}}$",
        note: "报告未完整公开时间采样和重建项权重；latent 归一化、16 通道与 2×2 打包必须保持基座一致。",
      },
      sources: [
        {
          item: "模型规模、双重编码与多任务训练",
          links:
            '<a href="https://arxiv.org/abs/2508.02324" target="_blank" rel="noopener">Qwen-Image Technical Report (arXiv:2508.02324)</a>',
          evidence:
            "报告明确 Qwen2.5-VL 与 MMDiT 的 latent 对齐、源图分别送入 VL 与 VAE、以及 T2I/TI2I/I2I 多任务训练。",
        },
        {
          item: "官方实现与 pipeline 变体",
          links:
            '<a href="https://github.com/QwenLM/Qwen-Image" target="_blank" rel="noopener">Qwen-Image 官方仓库</a>',
          evidence:
            "提供 T2I 与 Edit / Edit-Plus 的推理入口；具体版本支持的功能以仓库与模型卡为准。",
        },
        {
          item: "transformer 维度、RoPE 与打包",
          links:
            '<a href="https://huggingface.co/Qwen/Qwen-Image" target="_blank" rel="noopener">Qwen-Image transformer/config.json</a> · <a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/models/transformers/transformer_qwenimage.py" target="_blank" rel="noopener">Diffusers transformer_qwenimage.py</a>',
          evidence:
            "num_layers=60、attention_head_dim=128、num_attention_heads=24、joint_attention_dim=3584、in_channels=64、out_channels=16、patch_size=2、axes_dims_rope=[16,56,56]。",
        },
        {
          item: "latent 打包与 VAE 归一化",
          links:
            '<a href="https://github.com/huggingface/diffusers/blob/main/src/diffusers/pipelines/qwenimage/pipeline_qwenimage.py" target="_blank" rel="noopener">pipeline_qwenimage.py</a>',
          evidence:
            "<code>_pack_latents</code> 把 [B,16,H,W] reshape 成 [B,(H/2)(W/2),64]；vae/config.json 给出 z_dim=16 与逐通道 mean/std。",
        },
      ],
      unknown: [
        "Edit 各版本（Edit / Edit-2509 / Edit-Plus）是否接受 mask、支持几张参考图、以及参考 token 如何与噪声 token 组织：必须读所选 pipeline 的签名与官方示例。",
        "2560×2560 等超训练分布分辨率的质量边界未公开量化，实际效果需自行验证。",
        "Qwen-Image-2512 等后续 checkpoint 的配置可能变化：以该 checkpoint 的 config.json 为准，本页数值来自 0.34 版 diffusers 时代的 Qwen-Image config。",
        "训练数据规模、loss 权重、时间采样分布等未完整公开；本页只写报告与代码可证实的内容。",
      ],
      modules: {
        vl: {
          title: "Qwen2.5-VL 文本 / 多模态编码器",
          meta: "joint_attention_dim=3584；Edit 时同一编码器也接收源图。",
          diagram:
            '<div class="md-title">文本（与 Edit 参考图）编码</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill">prompt token ids（+ Edit 时的源图 patch）</div>' +
            '<span>↓ Qwen2.5-VL 解码器堆叠（取指定层的 hidden states）</span>' +
            '<div class="md-pill md-pill-purple">hidden [B,N_txt,3584]（含图像 patch token）</div>' +
            '<span>↓ txt_norm → txt_in（Linear 3584→3072）</span>' +
            '<div class="md-pill md-pill-output">文本条件 [B,N_txt,3072] 与图像 token 一起进联合 attention</div>' +
            "</div>" +
            '<div class="md-caption">这里用的是一个因果语言模型骨干作为条件编码器，因此“文本条件”本身就是多模态序列；它与 CLIP/T5 的结构、层数、输出维度都不同。完整通用结构（视觉塔 + merger + LLM 堆叠）见下方虚线框。</div>',
          generic: {
            title: "多模态条件编码器（ViT + merger + Qwen2.5-VL 解码器堆叠）",
            note:
              "条件编码器只用它的隐藏层，不训练生成头；框内是这类“视觉塔 + 投影器 + decoder-only LLM”的完整通用结构，Edit 时源图走的就是视觉这一路。",
            mermaid: [
              "flowchart TD",
              '  t0["prompt（中文 / 长文本 / 排版描述）<br/>input_ids [B,N_txt]"]:::in --> te["token embedding<br/>[B,N_txt,3584]"]:::core',
              '  i0["Edit 参考图<br/>[B,3,H,W]"]:::in --> pe["ViT PatchEmbed（14×14）+ 位置编码<br/>[B,N_img,D_vit]"]:::core',
              '  pe --> vit["ViT blocks：窗口注意力与全局注意力交替<br/>[B,N_img,D_vit]"]:::attn',
              '  vit --> mer["Merger：2×2 token 合并 + MLP<br/>[B,N_img/4,3584]"]:::cond',
              '  te --> seq["concat(seq)：文本 embedding 与视觉 token<br/>[B,N_txt+N_img/4,3584]"]:::latent',
              "  mer --> seq",
              '  seq --> llm["Qwen2.5-VL 解码器堆叠 ×L<br/>RMSNorm + GQA attention(RoPE) + SwiGLU<br/>[B,N,3584]"]:::attn',
              '  llm --> tap["取指定层 hidden states<br/>[B,N,3584]"]:::out',
              '  tap --> proj["txt_norm → txt_in（Linear 3584→3072）<br/>[B,N,3072]"]:::out',
              '  proj --> packed["与图像 token 一起进联合 attention<br/>每步被主干重新读取"]:::latent',
            ].join("\n"),
            facts:
              "<b>和 CLIP/T5 的差别：</b>它本身是 decoder-only 大模型，因此“文本条件”其实是<b>多模态序列</b>，能同时承载文字语义与参考图语义；取哪一层、是否再经过 <code>txt_norm</code> 必须以该 checkpoint 的 pipeline 代码为准。Edit 的另一路（VAE 重建路径）不在这个模块里，两条路径的 latent 由 I2I 重建任务对齐。",
            linkHref: "index.html#atlas-mm-encoder",
            linkText: "通用模块图鉴 18：多模态条件编码器的完整张量级结构 →",
          },
          input: [
            "prompt 的 input_ids；Edit 任务时还会把源图 patch 一并送入同一编码器。",
          ],
          output: ["hidden states [B,N_txt,3584]，经 txt_in 投影为 [B,N_txt,3072]。"],
          role: [
            "提供长文本、中文与排版语义的序列条件；Edit 时同时提供源图的语义表示（路径 A）。",
          ],
          repeat: ["每个样本编码一次；循环内不重算，但每个 block 每轮重新读取。"],
        },
        trf: {
          title: "QwenImageTransformer2DModel block",
          meta: "60 层、D=3072、24 heads × 128、RoPE 轴 [16,56,56]。",
          diagram:
            '<div class="md-title">单个主干 block（图像 + 文本联合 attention）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">image tokens [B,N_img,3072] ｜ text tokens [B,N_txt,3072]</div>' +
            '<span>↓ AdaLN / RMSNorm 调制（由 time_text_embed 生成，含 additional_t_cond）</span>' +
            '<div class="md-pill md-pill-purple">Q/K/V 投影；3D RoPE 按 (t,h,w) 作用于 Q/K</div>' +
            '<span>↓ 联合 attention：图像 query 读取 N_img+N_txt 个 token 的 K/V</span>' +
            '<div class="md-pill md-pill-amber">注意力权重按 encoder_hidden_states_mask 屏蔽文本 padding</div>' +
            '<span>↓ attention out projection → residual add</span>' +
            '<div class="md-pill">norm → MLP / FFN（逐 token 通道变换）→ residual add</div>' +
            '<div class="md-pill md-pill-output">更新后的 image / text token</div>' +
            "</div>" +
            '<div class="md-caption">联合 attention 的具体拼接维度与 mask 行为以 Diffusers 实现为准；Qwen-Image 的实现把文本 mask 显式传入 attention，这是与 SD3/FLUX 的差别之一。</div>',
          input: [
            "图像 token [B,N_img,3072]、文本 token [B,N_txt,3072]、调制向量（来自 t 与 additional_t_cond）、编码器 mask。",
          ],
          output: [
            "更新后的两路 token；最后一层之后只取图像 token，经输出头得到 64 维 patch velocity。",
          ],
          role: [
            "在统一序列空间内对齐文本语义与图像 latent，是文字渲染与编辑一致性的主要承载层。",
          ],
          repeat: ["60 次；每个 denoising step 执行一遍。"],
        },
      },
    },

    // ======================= MiniMax H3 ====================================
    // ======================= MiniMax H3 ====================================
    // 本页所有“可确证”的事实来自 MiniMax 官方开源公告与官方模型卡：
    //   · H3 由三个模块组成：H3-Context-IR（闭源服务）、H3-Base（开源）、H3-Regenerate-2K（闭源服务）
    //   · H3-Encoder 使用完整预训练的 Qwen3-VL-32B 权重，输出第 50 层 hidden states
    //   · H3-VisualVAE = f16t4d24（空间 16×、时间 4×、24 latent 通道），patch 1×2×2 后有效空间 32×、时间 4×
    //   · H3-AudioVAE：32 kHz 立体声，每通道 40 Hz latent，左右声道共用编解码器
    //   · H3-Omni-Transformer = 33B dense single-stream，约 13B 参数在 AdaLN 分支（调制输出可预计算缓存）
    //   · attention 与 FFN 都没有模态专属结构；模态专属参数只在输入/输出层与 AdaLN 分支
    //   · MM-RoPE 使用 (t, h, w) 三维位置
    //   · 两个开源 checkpoint：H3-Base FL2VA（t2va / fl2va）与 H3-Base Ref2VA（ref2va），均为 CFG-distilled
    //   · 首个开源版本只提供全注意力推理，稀疏注意力实现后续发布
    // 其余（loss 形式、solver 名称、步数、层数、hidden size、packed 序列的拼接细节）一律标为未公开。
    h3: {
      title: "MiniMax H3 · 官方公开资料可确证的统一音视频数据流",
      subtitle:
        "官方公告与模型卡写出的模块、压缩率与参数规模，加上本次直接读 ComfyUI 侧 checkpoint（safetensors 头部）核验出的层数、宽度、head 数与 VAE 内部结构；仍然没有公开的部分（loss、solver、步数、拼接顺序）在图中标为未知，而不是补成看起来合理的猜测。",
      kind:
        "官方可确证的部分 + checkpoint 核验：H3-Base 两个 checkpoint（FL2VA / Ref2VA）的推理路径与逐层结构",
      h3Network: true,
      hideModuleIndex: true,
      trainingIntro: "公开资料没有给出 H3 的训练 loss、目标参数化或时间采样流程；本章只列出可确证的训练载体，并把未知项留在损失卡片中。",
      inferenceIntro: "文本、视觉和音频编码器以及 VAE 只在推断链路中出现；H3-Context-IR 与 H3-Regenerate-2K 是闭源服务，不能画成本地开源主干模块。checkpoint 里出现的 token_refiner 与 3D latent upscaler 单列，并标明它们的证据来源。",
      modalKicker: "H3 模块",
      networkFlow: [
        { title: "Encoder + VAE", detail: "文本/参考视觉走 50 层编码器；视频 24 通道、音频 32 通道 latent", tone: "condition" },
        { title: "Packed multimodal sequence", detail: "视频 token 96 维 + 音频 token 32 维 + 条件 token；MM-RoPE (t,h,w)", tone: "latent" },
        { title: "token_refiner ×2", detail: "与主干同构的 2 层精炼模块（checkpoint 核验）", tone: "core" },
        { title: "H3-Omni 50 层", detail: "hidden 5376、56 head × 128、SwiGLU 14336、AdaLN", tone: "core" },
        { title: "双路输出", detail: "video_out 96 维 / audio_out 32 维 → 各自解码", tone: "output" },
      ],
      sourcesBrief: [
        [
          "官方公告事实（保持原样）",
          "H3-Encoder 取 <b>Qwen3-VL-32B 第 50 层</b> hidden states；H3-VisualVAE 为 <b>f16t4d24</b>（空间 16×、时间 4×、24 通道），视觉 latent 再按 <b>1×2×2</b> patch 化，因此进 Transformer 的 token 有效空间下采样 <b>32×</b>、时间仍 <b>4×</b>；H3-AudioVAE 把 <b>32 kHz</b> 音频压成每通道 <b>40 Hz</b> latent；主干是 <b>33B dense single-stream</b>，官方称约 <b>13B</b> 参数位于 AdaLN 分支（可预计算缓存）；位置编码是 <b>MM-RoPE (t,h,w)</b>。",
        ],
        [
          "本次新增：直接读 checkpoint 核验出的结构",
          "读 <code>minimax_h3_fl2va_pruned_int8_convrot</code> / <code>ref2va</code> / <code>qwen3vl_32b_minimax_h3_nvfp4_awq</code> / <code>minimax_h3_video_vae_fp16</code> / <code>minimax_h3_audio_vae_fp32</code> 的 safetensors 头部后确认：主干 <b>50 层、hidden 5376、56 head × head_dim 128</b>（<code>q_norm</code>/<code>k_norm</code> 做 QK-Norm，这份 checkpoint 是 MHA 而非 GQA）、<b>SwiGLU intermediate 14336</b>、视频 token <b>96</b> 维 / 音频 token <b>32</b> 维、条件投影 <b>5120 → 5376</b>；编码器 <b>50 层、hidden 5120</b>、视觉塔 <b>27 层 / 宽 1152 / patch 2 帧 × 16×16</b> + <b>3 个 deepstack merger</b>；视频 VAE 编码器是 <b>6 级 3D 因果卷积</b>、解码器是 <b>36 层 ViT</b>（宽 2048、4 个 register token）；音频 VAE 是 <b>DAC 风格</b>（SnakeBeta 激活、总下采样 <b>800×</b>、latent <b>32</b> 通道）。",
        ],
        [
          "仍未公开的部分",
          "H3-Context-IR（把自由输入转成结构化 Context IR）与 H3-Regenerate-2K 都<b>没有开源</b>，只提供 API；训练损失形式、时间采样分布、solver 名称与默认步数仍未给出；稀疏注意力在训练末期引入，首个开源版本只提供全注意力推理。packed 序列的精确拼接顺序与 token_refiner 的确切作用位置也要读推理代码。",
        ],
      ],
      stages: [
        {
          id: "df-input",
          kicker: "输入",
          title: "真实输入（按 checkpoint 的能力边界）",
          nodes: [
            {
              id: "prompt",
              kind: "input",
              title: "文本指令",
              shape: "结构化文本（含 [Shot]、音效与音乐描述）",
              meta:
                "官方建议先用 H3-Context-IR 把自由输入转成结构化 prompt；该模块是闭源的多阶段服务",
            },
            {
              id: "media",
              kind: "external",
              title: "首/尾帧或参考素材",
              shape:
                "图片 ≤9 张 · 视频 ≤3 段（每段 2–15s，总 ≤15s） · 音频 ≤3 段（必须伴随图像或视频输入，不能单独使用） · 全部文件合计 ≤12",
              meta:
                "FL2VA 支持 0 / 1 / 2 张图（T2VA / 首帧或尾帧 / 首尾帧）；Ref2VA 支持多模态参考与视频编辑",
            },
          ],
        },
        {
          id: "df-encode",
          kicker: "第 02 步 · 循环外一次",
          title: "各模态分别编码，再组织成统一 packed 序列",
          note:
            "三种编码器的分工是官方明确的：文本走 H3-Encoder；视觉走 H3-Encoder + H3-VisualVAE；音频只走 H3-AudioVAE。",
          nodes: [
            {
              id: "h3enc",
              kind: "core",
              title: "H3-Encoder（Qwen3-VL-32B）",
              shape: "文本 + 视觉 patch → [B,N,5120]，50 层堆叠，取第 50 层 hidden states",
              meta: "视觉塔：27 层、宽 1152、patch 2 帧 × 16×16、3 个 deepstack merger（4608 → 5120）；该 repack 里没有 model.norm 与 lm_head，说明只当编码器用",
              detail: true,
            },
            {
              id: "vvae",
              kind: "core",
              title: "H3-VisualVAE（f16t4d24）",
              shape: "编码器 6 级 3D 因果卷积 → 24 通道 latent（conv_out 48 = μ+logσ²），latents_mean/std 各 24",
              meta: "解码器不是卷积：36 层 ViT（宽 2048、门控 FF 8192、4 个 register token），proj_out 3072 = 3×4×16×16，每个 latent 位置还原成 (4 帧,16×16) 像素块",
              detail: true,
            },
            {
              id: "avae",
              kind: "core",
              title: "H3-AudioVAE",
              shape: "32 kHz 每声道 → 40 Hz latent，32 通道；总下采样 2×4×4×5×5 = 800",
              meta: "DAC 风格：Snake/SnakeBeta 激活、编码器 5 级步长卷积、解码器 7 级转置卷积 + 21 个残差块 + 抗镜像低通滤波",
              detail: true,
            },
            op(
              "cat",
              "unified packed multimodal sequence",
              "条件 token（5120 → 5376）、视频 token（96 维）、音频 token（32 维）组织成一条序列；位置关系由 MM-RoPE (t,h,w) 表达，精确拼接顺序未公开",
            ),
          ],
        },
        {
          id: "df-state",
          kicker: "第 03 步 · 循环外一次",
          title: "初始化两路 latent 状态",
          nodes: [
            {
              kind: "state",
              title: "视频 latent 状态",
              shape: "[B,24,T/4,H/16,W/16]；逐通道乘 latents_mean / latents_std",
              meta: "T2VA 从噪声开始；FL2VA / Ref2VA 用首尾帧或参考内容约束",
            },
            {
              kind: "state",
              title: "音频 latent 状态",
              shape: "[B,32,40×秒数]（≤15 s → ≤600 步/声道）",
              meta: "32 通道 latent，与视频 latent 在同一循环中同步更新，这是原生音画同步的机制来源",
            },
            {
              kind: "note",
              title: "未公开",
              meta:
                "初始化的加噪公式、噪声调度与 sigma 序列均未在公开说明中给出；checkpoint 里的 adaln_t_table 是 1025×8，可作为时间步离散化的线索，但对应关系要读推理代码",
            },
          ],
        },
        {
          id: "df-transformer",
          kicker: "第 04 步 · 每一步",
          title: "H3-Omni-Transformer：50 层 dense single-stream 联合预测",
          nodes: [
            {
              id: "omni",
              kind: "core",
              title: "H3-Omni-Transformer",
              shape:
                "50 层 · hidden 5376 · 56 head × head_dim 128 · SwiGLU 14336（checkpoint 核验）",
              meta:
                "每层 18 个张量：qkv_proj 21504×5376、out_proj 5376×7168、q_norm/k_norm 128、mlp.fc1 28672×5376、mlp.fc2 5376×14336、norm1/norm2 5376、adaln_proj 96768×8；attention 与 FFN 不含模态专属结构",
              detail: true,
            },
            {
              id: "refiner",
              kind: "core",
              title: "token_refiner ×2",
              shape: "与主干同构的 2 层（D=5376），另带 final_norm；合计约 771M 参数",
              meta: "checkpoint 里独立存在（token_refiner.blocks.0/1）；它精炼的是哪一段 token 要读推理代码，本页不写成“文本精炼器”",
              detail: true,
            },
            op(
              "read",
              "联合预测视频与音频 latent",
              "两路 latent 在同一序列中交互，不需要后期 mux 对齐",
            ),
            {
              kind: "output",
              title: "两路预测输出",
              shape: "video_out 96 维 / audio_out 32 维（final_layer 的 adaln_proj 10752×8）",
              meta:
                "输出维度已核实；但参数化形式（epsilon / v / velocity）仍未公开，公开说明只说“联合预测视频与音频 latent”",
            },
          ],
        },
        {
          id: "df-solver",
          kicker: "第 05 步 · 每一步",
          title: "联合采样循环",
          loop: true,
          nodes: [
            {
              kind: "state",
              title: "z_video(t), z_audio(t)",
              shape: "两路 latent",
              meta: "每一步都被替换",
            },
            op(
              "solver",
              "joint sampler（名称与公式未公开）",
              "两路 latent 同步更新；本页不写任何未确证的 scheduler 名称",
            ),
            {
              kind: "state",
              title: "z(t−1)（两路）",
              shape: "同上",
              meta: "回到主干输入层，条件序列不重新编码",
            },
            {
              kind: "output",
              title: "退出后解码",
              shape: "视频帧（24 FPS）+ 32 kHz 立体声",
              meta: "视觉与音频分别解码，再按时间轴封装",
            },
            {
              id: "upscaler",
              kind: "external",
              title: "可选：3D latent upscaler（2K 路径）",
              shape:
                "24 通道 latent 在 latent 空间放大：18 个 in_blocks + 18 个 out_blocks、约 345M 参数",
              meta:
                "ComfyUI 侧提供的 checkpoint；官方 H3-Regenerate-2K 仍是闭源 API，两者要分开写",
              detail: true,
            },
          ],
        },
      ],
      loop: {
        title: "多步循环的闭合关系",
        counter: "步数与时间表：未公开（读推理脚本默认参数）",
        steps: [
          [
            {
              kind: "loop",
              title: "回到哪一层",
              shape: "联合主干的输入层",
              meta: "两路 latent 与 packed 条件序列一起重新送入",
            },
            op(
              "solver",
              "两路 latent 同步更新",
              "视频与音频共享同一个循环，不存在“先生成视频再配音”的两阶段",
            ),
            {
              kind: "state",
              title: "每轮变化",
              shape: "z_video、z_audio、t",
              meta: "条件序列（文本 / 参考）固定，但每轮被主干重新读取",
            },
            {
              kind: "output",
              title: "退出",
              shape: "进入两路解码器",
              meta: "视频解码 + 音频解码",
            },
          ],
        ],
        ret:
          "闭合点与具体实现细节（步数、sigma 表、guidance 形式）在公开资料中<b>未给出</b>。本图只标出可确证的关系：两路 latent 在<b>同一循环</b>中同步更新，条件序列在循环外编码一次。",
      },
      conditions: [
        {
          name: "文本条件（H3-Encoder 第 50 层）",
          where: "循环外一次",
          fixed: "不重算",
          read: "作为 packed 序列的文本段参与主干 attention",
        },
        {
          name: "参考图 / 参考视频",
          where: "循环外（H3-Encoder + H3-VisualVAE 两条路径）",
          fixed: "不重算",
          read: "作为额外 token 或条件段；拼进 packed 序列的具体方式未公开",
        },
        {
          name: "参考音频",
          where: "循环外（H3-AudioVAE）",
          fixed: "不重算",
          read: "必须与图像或视频输入一起使用，不能作为唯一输入",
        },
        {
          name: "z_video、z_audio",
          where: "初始化",
          fixed: "每步替换",
          read: "主干的两路输入状态",
        },
        {
          name: "guidance / CFG",
          where: "推理配置",
          fixed: "发布的 checkpoint 是 CFG-distilled 权重",
          read: "因此推理行为不等同于普通 CFG 双 forward；具体做法看推理脚本",
        },
      ],
      conditionsNote:
        "官方还提供一个重要的显存事实：AdaLN 分支的调制输出可以预计算并缓存，所以在“仅推理”部署时不加载这部分参数。本次核验看到的具体形态是：共享的 <code>adaln_t_table</code>（<b>1025 × 8</b>，按时间步查表）+ 每层一个 <code>adaln_proj.linear</code>（<b>96768 × 8</b> = 18 × 5376），50 层合计约 <b>43.65M</b>（占该 repack 的 0.22%）。这与官方“约 13B 在 AdaLN 分支”不是同一份权重：社区 int8 剪枝版已经把调制网络压成查表 + 小线性层，引用时请分开写。",
      cost:
        "官方完整模型是 33B dense；本地 ComfyUI repack（<code>*_pruned_int8_convrot</code>）按张量形状统计约 <b>20.1B</b>（int8，文件约 20 GB），是剪枝版，不能当作 33B 原版。官方示例用 4 卡 SGLang（<code>--ulysses-degree 4</code>）部署。输出为 768p、24 FPS、4–15 秒、32 kHz 立体声；2K 由闭源的 H3-Regenerate-2K 以 in-context 方式重生成得到（本地另有一个 3D latent upscaler checkpoint，见第 1 章模块）。",
      loss: {
        summary:
          "公开资料没有给出 H3 的训练损失形式。下面只列出可确证的目标载体；具体项与权重必须在标注处核验，不得推测。",
        processLabel: "训练目标、采样时间与损失权重：未公开",
        flow: [
          ["多模态样本", "video + audio + text（+参考）", "按时间轴对齐", "data"],
          ["编码", "H3-Encoder / H3-VisualVAE / H3-AudioVAE", "各模态 latent 与条件", "noise"],
          ["联合主干", "fθ(video latent, audio latent, packed context)", "50 层 dense single-stream", "model"],
          ["目标项", "未公开", "是否含显式同步项也未公开", "target"],
          ["反向传播", "∇θL", "官方称发布完整权重以支持微调", "loss"],
        ],
        formula:
          "L = ？（官方公开说明未给出损失形式；不得改写成 epsilon / velocity 的 MSE，也不得虚构同步损失项）",
        target:
          "<b>未公开</b>。需要查看训练代码或技术报告；目前只能确认 AdaLN 分支与输入/输出层含模态专属参数（checkpoint 证据：每层 adaln_proj、final_layer 的 video_out / audio_out）。",
        gradient:
          "官方发布完整权重并说明支持进一步开发与微调，但未公布官方微调脚本的可训练参数范围；checkpoint 里的线性层名已经可以核对：<code>blocks.N.attn.qkv_proj</code>、<code>blocks.N.attn.out_proj</code>、<code>blocks.N.mlp.fc1</code>、<code>blocks.N.mlp.fc2</code>、<code>token_refiner.blocks.N.*</code>（以及 int8 版附带的 <code>*_scale</code>）。实际 target_modules 仍必须打印 named_modules() 后决定。",
        inference:
          "H3-Context-IR 与 H3-Regenerate-2K 未开源（只在 API 提供），因此本地只能复现 768p 的 H3-Base 路径；2K 需要官方 API 配合。",
      },
      finetuneIntro:
        "官方尚未公开完整 H3 训练配方、官方微调脚本及完整损失函数。可以按社区 Musubi Tuner 的 MiniMax H3 文档尝试可运行的 LoRA 流程；它覆盖 FL2VA 与 Ref2VA 两类条件训练，但其中的参数、缓存和 loss 记录属于社区实现。",
      finetune: [
        [
          "1. 准备配对素材",
          "准备目标视频、对应音频、字幕或结构化文本，以及 Ref2VA 每个样本对应的参考图/参考视频。目标媒体与字幕必须一一配对；明确音视频时间轴、帧率、分辨率、采样率和时长。",
        ],
        [
          "2. 配置数据集与任务",
          "按 Musubi 文档配置数据集和训练任务，先选 FL2VA（文本/首尾帧条件）或 Ref2VA（参考素材条件）。按作品或主体切分 train / validation，避免相邻片段或同一镜头泄漏到两边。",
        ],
        [
          "3. 缓存条件",
          "先缓存视频 latent、音频 latent 与文本条件，检查缓存文件和样本索引是否一一对应；参考素材也按样本缓存或关联，避免训练时才发现时间轴或路径错误。",
        ],
        [
          "4. 启动 LoRA",
          "默认冻结编码器与 VAE，只训练确认过的主干适配器；打印 named_modules() 核对 target_modules 和梯度范围，不要因模块名含 Transformer 就把 LoRA 挂到所有线性层。",
        ],
        [
          "5. 记录训练信号",
          "社区训练器可以记录视频、音频等模态损失，也可选蒸馏或基座保持目标；这些是训练器的可观察实现，不是 MiniMax 官方公布的 H3 训练目标。",
        ],
        [
          "6. 独立验证选 checkpoint",
          "用未参与训练、按作品或主体隔离的验证集比较 checkpoint，检查画面、动作、身份、闪烁、语音、口型和音画同步；不要只按训练 loss 或公开案例的步数选权重。",
        ],
      ],
      finetuneData: {
        intro: "最低要求是目标媒体与字幕配对；Ref2VA 参考素材按样本对应。音视频时间轴、帧率、分辨率、采样率和时长要明确，并按作品或主体切分训练集与验证集，避免相邻片段泄漏。",
        rows: [
          ["FL2VA 目标样本", "target video、audio、subtitle / prompt、fps、resolution、sample_rate、duration、split", "视频动作、语音清晰度、音画同步"],
          ["Ref2VA 样本", "reference media、target video、audio、subtitle / prompt、sample 对应关系、split", "参考身份 / 构图、动作与条件一致性"],
          ["所有样本的最低检查", "明确时间轴、帧率、分辨率、采样率、时长；按作品或主体分组切分", "独立验证集无相邻片段或同主体泄漏"],
        ],
        sampleTitle: "JSONL · H3 多模态样本字段示例",
        sample: '{"video":"clips/001.mp4","audio":"clips/001.wav","subtitle":"subs/001.srt","prompt":"[Shot] a person speaks softly","fps":24,"width":768,"height":432,"sample_rate":32000,"duration":8.0,"reference":"refs/subject_a.png","split":"train"}',
        communityIntro: "社区项目 Musubi Tuner 的 MiniMax H3 文档提供可运行的 H3 LoRA 流程，包含 FL2VA 与 Ref2VA 两类条件训练。它是实践入口，不代表 MiniMax 官方已经发布同等内容。",
        communityLink: '<a href="https://github.com/AkaneTendo25/musubi-tuner/blob/minimax-h3/docs/minimax_h3.md" target="_blank" rel="noopener">Musubi Tuner · MiniMax H3 文档（社区）</a>',
        configIntro: "这是社区文档中的入门配置示例，用来先跑通流程；rank / alpha、精度、优化器、学习率、batch size 和 checkpoint 选择都应按你的数据与显存重新验证。",
        config: [
          ["LoRA rank / alpha", "16 / 16", "示例容量与缩放，不是官方推荐值"],
          ["精度", "BF16", "依赖硬件与训练器支持"],
          ["优化器", "AdamW8bit", "降低优化器状态显存"],
          ["学习率", "1e-4", "社区入门示例，需观察 loss 与验证集"],
          ["batch size", "1", "常见显存约束下的示例"],
          ["gradient checkpointing", "启用", "以计算换显存，速度会受影响"],
        ],
        nextStep: "先用少量、配对准确的数据跑通缓存和 LoRA；检查训练器的 loss、梯度和验证样例，再扩大数据或增加训练步数。公开案例的硬件和步数不是最低门槛，也不是通用建议。",
      },
      finetuneLoss: {
        summary: "官方没有公开 H3 的完整训练配方、官方微调脚本、目标参数化或完整损失函数，因此不能断言使用 epsilon MSE、velocity MSE 或某个特定音画同步损失。",
        formula: "L_finetune = 官方未知；社区训练器的 loss / 蒸馏 / 基座保持项以其配置和日志为准",
        note: "社区实现可以把视频、音频等模态损失分别记录，或启用可选的蒸馏与基座保持目标；这些实现不能改写成 MiniMax 官方训练目标。验收时同时看 loss、梯度和独立验证样例。",
      },
      finetuneCases: [
        {
          title: "Cseti CrossView Warp LoRA",
          meta: "Ref2VA · rank/alpha 32/32 · AdamW8bit · learning rate 1e-4 · 计划 6,000 steps，发布第 3,500 步权重 · 记录 96 GB RTX PRO 6000",
          summary: "这是一个 Ref2VA 的跨视角 warp LoRA 案例，参数和训练进度可在模型页核查。",
          limit: "单一项目的配置与硬件记录，不能推出最低显存、通用步数或普适效果。",
          link: '<a href="https://huggingface.co/Cseti/MiniMax-H3_Ref2VA-LoRA-CrossView-Warp_v1" target="_blank" rel="noopener">查看 Hugging Face 模型页</a>',
        },
        {
          title: "Akatz Labs Character Swap LoRA",
          meta: "rank/alpha 16/16 · AdamW8bit · learning rate 5e-5 · 1,000 steps",
          summary: "该案例公开了 Character Swap LoRA 的训练设置，可作为参数记录的对照。",
          limit: "其替换目标主要是静态图像，不能据此推断长视频角色替换能力。",
          link: '<a href="https://huggingface.co/akatz-ai/MiniMax-H3-Character-Swap-LoRA" target="_blank" rel="noopener">查看 Hugging Face 模型页</a>',
        },
        {
          title: "Alibaba PAI Acc LoRAs",
          meta: "推理加速蒸馏案例",
          summary: "这是面向推理加速的蒸馏 LoRA 发布，目标是减少推理成本。",
          limit: "它不等同于普通任务 LoRA，不能直接作为主体、风格或角色任务的训练配方。",
          link: '<a href="https://huggingface.co/alibaba-pai/MiniMax-H3-Acc-LoRAs" target="_blank" rel="noopener">查看 Hugging Face 模型页</a>',
        },
      ],
      sources: [
        {
          item: "系统组成、VAE 压缩率、主干规模、MM-RoPE、开源范围",
          links:
            '<a href="https://www.minimax.io/news/minimax-h3-open-source" target="_blank" rel="noopener">MiniMax H3 开源公告（官方）</a>',
          evidence:
            "官方页面明确给出：三模块结构（Context-IR / Base / Regenerate-2K）、H3-Encoder = Qwen3-VL-32B 第 50 层、VisualVAE f16t4d24 + 1×2×2 patch（有效空间 32×）、AudioVAE 32 kHz / 40 Hz、33B dense single-stream 与约 13B AdaLN 参数、MM-RoPE、稀疏注意力仅在训练末期引入且首个开源版本只有全注意力。",
        },
        {
          item: "权重、任务族与输入规格",
          links:
            '<a href="https://huggingface.co/MiniMaxAI/MiniMax-H3" target="_blank" rel="noopener">MiniMaxAI/MiniMax-H3 模型卡</a>',
          evidence:
            "给出 FL2VA / Ref2VA 两个 checkpoint 的目录结构、输入上限（≤9 图 / ≤3 视频 / ≤3 音频 / 合计 ≤12）与 BF16 精度；层数与 hidden size 仍需读 transformer/config.json。",
        },
        {
          item: "推理集成与默认参数",
          links:
            '<a href="https://docs.sglang.io/cookbook/diffusion/MiniMax/MiniMax-H3" target="_blank" rel="noopener">SGLang 部署文档</a> · <a href="https://github.com/huggingface/diffusers/blob/minimax-h3/docs/source/en/api/pipelines/minimax_h3.md" target="_blank" rel="noopener">Diffusers H3 pipeline 文档</a>',
          evidence:
            "说明推理入口与部署方式；scheduler / solver 名称与步数必须从这里读取，不能推测。",
        },
        {
          item: "本次核验：主干逐层结构（本地 checkpoint）",
          links:
            "<code>diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors</code> · <code>minimax_h3_ref2va_pruned_int8_convrot.safetensors</code>",
          evidence:
            "读 safetensors 头部（932 个张量）得到：<code>blocks.0–49</code> 共 <b>50 层</b>；每层 18 个张量 —— <code>attn.qkv_proj</code> 21504×5376（= 3 × 7168）、<code>attn.out_proj</code> 5376×7168、<code>q_norm</code>/<code>k_norm</code> 128、<code>mlp.fc1</code> 28672×5376、<code>mlp.fc2</code> 5376×14336、<code>norm1</code>/<code>norm2</code> 5376、<code>adaln_proj</code> 96768×8；顶层有 <code>adaln_t_table</code> 1025×8、<code>condition_proj</code> 5376×5120、<code>video_patch_proj</code> 5376×96、<code>audio_patch_proj</code> 5376×32、<code>final_layer.video_out</code> 96 / <code>audio_out</code> 32、<code>rope.inv_freq</code> 16、<code>token_refiner</code> 2 层。按形状统计约 <b>20.1B</b> 参数（剪枝 + int8）。",
        },
        {
          item: "本次核验：条件编码器与两个 VAE",
          links:
            "<code>text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors</code> · <code>vae/minimax_h3_video_vae_fp16.safetensors</code> · <code>vae/minimax_h3_audio_vae_fp32.safetensors</code>",
          evidence:
            "编码器：50 层 / hidden 5120 / vocab 151936 / GQA <b>64:8</b> / SwiGLU 12800，视觉塔 27 层宽 1152 + <code>patch_embed</code> Conv3d(2,16,16) + <b>3 个 deepstack merger</b>。视频 VAE：编码器 <b>6 级 3D 因果卷积</b>（<code>conv_out</code> 48 = 2×24、<code>latents_mean/std</code> 24）、解码器 <b>36 层 ViT</b>（宽 2048、<code>proj_out</code> 3072 = 3×4×16×16、4 个 register token）。音频 VAE：DAC 风格（SnakeBeta 激活、步长 2/4/4/5/5 合计 <b>800×</b>、latent <b>32</b> 通道、7 级转置卷积 + 21 个残差块 + 抗镜像低通滤波）。",
        },
        {
          item: "本次核验：2K 路径的 3D latent upscaler",
          links:
            "<code>latent_upscale_models/minimax_h3_latent_upscaler_3d_fp16.safetensors</code>",
          evidence:
            "<code>conv_in</code> 512×24×3×3×3、<b>18 个 in_blocks + 18 个 out_blocks</b>（偶数块是带时间条件的 ResBlock3D：<code>emb_layers</code> 1024×64；奇数块是时间轴深度可分离卷积 <code>dwconv</code> 512×1×5×1×1 + <code>pwconv</code> 1×1×1）、<code>conv_out</code> 24×512×3×3×3，约 345M 参数。它是社区侧提供的放大模块；官方 Regenerate-2K 仍只通过 API 提供。",
        },
      ],
      unknown: [
        "训练损失形式、时间采样分布、guidance/CFG 蒸馏的具体做法：官方公开说明未给出。",
        "solver 名称、默认步数与 sigma 表：读推理脚本或 pipeline 默认参数；<code>adaln_t_table</code> 的 1025 个时间步只能作为线索，不能当结论。",
        "各模态 token 在 packed 序列中的拼接顺序、<code>token_refiner</code> 的作用位置、MM-RoPE 在 (t,h,w) 上的轴分配：公开说明只给出“统一 packed 序列 + MM-RoPE (t,h,w)”。",
        "稀疏注意力的实现细节（官方称训练末期引入，首个开源版本只提供全注意力）。",
        "H3-Context-IR 与 H3-Regenerate-2K 为闭源服务；本地 H3-Base 直接输出 768p，2K 需要官方 API（本地 latent upscaler 属于社区路径，不是官方 Regenerate-2K 本身）。",
        "官方 33B 原始权重与本页核验的 20.1B 剪枝 int8 版之间的逐层差异：以官方仓库的 Revision 为准。",
        "微调脚本、推荐 target_modules 与完整许可条款：以模型卡 License 与官方示例为准，本页不代替许可审查。",
      ],
      modules: {
        h3enc: {
          title: "H3-Encoder（Qwen3-VL-32B）",
          meta:
            "checkpoint 核验：LLM 50 层、hidden 5120、vocab 151936、GQA 64:8、SwiGLU 12800；视觉塔 27 层、宽 1152、patch Conv3d(2,16,16)、3 个 deepstack merger。",
          diagram:
            '<div class="md-title">H3-Encoder：文本 + 视觉条件的张量路径（checkpoint 核验）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">文本 token ids <code>[B,N_text]</code>（vocab 151936）<br />图像 / 视频帧 <code>[B,3,T,H,W]</code></div>' +
            '<span>↓ 视觉塔 PatchEmbed：<code>proj</code> Conv3d(k=2×16×16) 3→1152，tubelet = 2 帧 × 16×16 像素</span>' +
            '<div class="md-pill md-pill-purple">+ <code>pos_embed</code>（2304 = 48×48）<br />ViT block ×<b>27</b>：attn qkv 3456、proj 1152，MLP 1152→4304→1152<br /><code>[B,N_img,1152]</code></div>' +
            '<span>↓ merger：2×2 相邻 token 拼接 → 4608 → Linear 4608×4608 → GELU → Linear <b>4608→5120</b></span>' +
            '<div class="md-pill md-pill-amber">视觉 token <code>[B,N_img/4,5120]</code><br />另有 <b>3 个 deepstack merger</b>（<code>deepstack_merger_list.0–2</code>）从 ViT 不同深度各出一路 5120 维 token</div>' +
            '<span>↓ 与文本 embedding 在序列维拼接，进入 Qwen3-VL 解码器堆叠 ×<b>50</b></span>' +
            '<div class="md-pill md-pill-purple">每层：input_layernorm → GQA（q 64 head / kv 8 head × d_head 128，带 q_norm/k_norm）→ post_attention_layernorm → SwiGLU（gate/up 12800）<br />取<b>第 50 层</b> hidden states <code>[B,N,5120]</code></div>' +
            '<span>↓ <code>condition_proj</code>：Linear <b>5120 → 5376</b>（与主干 hidden 对齐）</span>' +
            '<div class="md-pill md-pill-output">条件 token <code>[B,N_cond,5376]</code><br />作为 packed 序列的一段</div>' +
            '<div class="md-side-note">这份 H3 专用 repack 里<b>没有 <code>model.norm</code> 与 <code>lm_head</code></b>，说明它只当编码器用；因此官方说的“第 50 层”就是这个 50 层堆叠的最后一层输出（index 49），不是「最后一层之后再过 final norm」。</div>' +
            "</div>" +
            '<div class="md-caption">deepstack 是 Qwen3-VL 特有的结构：除了主 merger，还从 ViT 的三个深度各取一份特征做同样的 merge，一起交给 LLM，用来补回被 merger 压掉的细粒度视觉信息。这类多模态编码器的完整通用结构见下方虚线框。</div>',
          generic: {
            title: "多模态条件编码器（ViT + merger + decoder-only LLM）",
            note:
              "官方只公开“使用完整预训练的 Qwen3-VL-32B 权重、向主干提供第 50 层 hidden states”。框内是这类多模态条件编码器的完整通用结构。",
            mermaid: [
              "flowchart TD",
              '  t0["文本 prompt<br/>input_ids [B,N_txt]"]:::in --> te["token embedding<br/>[B,N_txt,D_llm]"]:::core',
              '  i0["参考图 / 视频帧<br/>[B,3,H,W] 或 [B,3,T,H,W]"]:::in --> pe["PatchEmbed：Conv2d/Conv3d(k=14,s=14)<br/>[B,N_img,D_vit] + 位置编码"]:::core',
              '  pe --> vit["ViT blocks ×L_v<br/>窗口注意力与全局注意力交替<br/>[B,N_img,D_vit]"]:::attn',
              '  vit --> mer["Merger：2×2 token 合并 + MLP<br/>[B,N_img/4,D_llm]"]:::cond',
              '  te --> seq["concat(seq)：文本 embedding 与视觉 token<br/>[B,N_txt+N_img/4,D_llm]"]:::latent',
              "  mer --> seq",
              '  seq --> llm["decoder-only LLM 堆叠 ×L<br/>RMSNorm + GQA attention(RoPE) + SwiGLU<br/>[B,N,D_llm]"]:::attn',
              '  llm --> tap["取指定层的 hidden states<br/>（H3-Encoder：第 50 层）<br/>[B,N,D_enc]"]:::out',
              '  tap --> proj["条件投影 / 对齐（形式与维度未公开）<br/>[B,N,D_model]"]:::out',
              '  proj --> packed["作为 packed 序列的条件段<br/>每步被主干重新读取"]:::latent',
            ].join("\n"),
            facts:
              "<b>三个必须写清楚的边界：</b>① 视觉 token 先过 ViT 塔、再经 merger 降采样，之后才和文本 embedding 在<b>序列维</b>拼接；② 官方说的<b>第 50 层</b>就是这个 50 层堆叠的最后一层输出（index 49）——该 repack 里没有 <code>model.norm</code>，所以不存在“再过一次 final norm”这一步；③ 从 <code>D_enc</code> 到主干宽度 <code>D_model</code> 的投影在 H3 里已核实是 <code>condition_proj</code> 的 5120 → 5376，其它模型仍要读 config。",
            linkHref: "index.html#atlas-mm-encoder",
            linkText: "通用模块图鉴 18：多模态条件编码器的完整张量级结构 →",
          },
          input: ["文本 token，以及视觉输入经该编码器处理的 token。"],
          output: ["第 50 层 hidden states，投影为条件 token 序列。"],
          role: [
            "统一理解文本与视觉输入，输出主干可读取的条件表示；这是“原生多模态理解”的来源。",
          ],
          repeat: ["每个样本一次；循环内不重算。"],
        },
        vvae: {
          title: "H3-VisualVAE（f16t4d24）",
          meta:
            "时间因果视频自编码器：空间 16×、时间 4×、24 通道 latent；编码器是 3D 因果卷积，解码器是 36 层 ViT（checkpoint 核验）。",
          diagram:
            '<div class="md-title">H3-VisualVAE：视频帧到视觉 latent token（checkpoint 核验）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">视频帧 <code>x_v [B,3,T,H,W]</code><br />RGB、时间长度 <code>T</code>、空间尺寸 <code>H×W</code></div>' +
            '<span>↓ 编码器：<code>conv_in</code> 3→128（k=3×3×3）；<b>6 级 down</b>，每级 2 个 ResBlock3D（<code>conv1/conv2</code> + <code>norm1/norm2</code>，通道变化用 <code>nin_shortcut</code> 1×1×1）；其中 <b>4 级带 downsampler</b>（通道 128→256→512→512→1024）</span>' +
            '<div class="md-pill md-pill-purple"><code>norm_out</code> 1024 → <code>conv_out</code> <b>48</b>×1024×3×3×3（= 2×24：μ 与 logσ²）<br />→ <code>quant_conv</code> 1×1×1 → 重参数化采样 → <code>post_quant_conv</code> 24×24×1×1×1<br />latent <code>z_v [B,24,T/4,H/16,W/16]</code>，逐通道乘 <code>latents_mean</code> / <code>latents_std</code>（各 24 个）</div>' +
            '<span>↓ patch 1×2×2：reshape / permute（时间 × 高 × 宽）</span>' +
            '<div class="md-pill md-pill-amber">token 网格 <code>N_v=(T/4)(H/32)(W/32)</code><br />每个 token 携带 <code>24×1×2×2=96</code> 个值 → <code>video_patch_proj</code> <b>5376×96</b></div>' +
            '<div class="md-pill md-pill-output">视频 token <code>[B,N_v,5376]</code><br />与条件 token（5120→5376）、音频 token（32→5376）一起进 packed 序列</div>' +
            '<div class="md-side-note"><b>解码器不是卷积</b>：<code>x_embedder</code> 24→2048 → <b>36 层 ViT</b>（宽 2048、<code>to_qkv</code> 6144、门控 FF <code>w1</code> 16384=<code>w2</code>×2、<code>norm1/norm2</code> + 可学习 <code>scale1/scale2</code>、<code>mask_token</code>、<b>4 个 register token</b>）→ <code>proj_out</code> <b>3072</b>×2048。参数分布：编码侧约 <b>180M</b>、解码侧约 <b>2.42B</b>。</div>' +
            "</div>" +
            '<div class="md-caption">上面是这份 checkpoint 的真实层序（读 safetensors 头部得到），不再只是通用参考实现。两个值得注意的地方：① 解码器是纯 ViT，<b>没有 U-Net 式 skip</b>，因为每个 latent 位置直接展开成 (4 帧, 16×16) 像素块；② 官方说“另用 ViT 解码器降低解码成本”，但参数上解码器反而更大（2.42B vs 180M）——它省的是高分辨率下的卷积计算量，而不是参数。</div>',
          generic: {
            title: "H3-VisualVAE（f16t4d24，checkpoint 核验）",
            note:
              "虚线框内是这条 VAE 的真实结构：编码器 6 级 3D 因果卷积（4 级下采样、通道 128→1024），尾部输出 48 通道（μ 与 logσ²）；解码器是 36 层 ViT，proj_out 3072 直接展开成 (4 帧,16×16) 像素块。",
            mermaid: [
              "flowchart TD",
              '  x["视频帧 x<br/>[B,3,T,H,W]"]:::in --> cin["conv_in：CausalConv3d 3→128（k=3×3×3）<br/>[B,128,T,H,W]"]:::core',
              '  cin --> l0["encoder.down.0：2×ResBlock3D（128）<br/>+ downsampler（空间 2×、时间 2×）<br/>[B,128,T/2,H/2,W/2]"]:::core',
              '  l0 --> l1["encoder.down.1：2×ResBlock3D（128→256）+ nin_shortcut<br/>+ downsampler（空间 2×、时间 2×）<br/>[B,256,T/4,H/4,W/4]"]:::core',
              '  l1 --> l2["encoder.down.2：2×ResBlock3D（256）<br/>+ downsampler（只压空间）<br/>[B,256,T/4,H/8,W/8]"]:::core',
              '  l2 --> l3["encoder.down.3：2×ResBlock3D（256→512）+ nin_shortcut<br/>+ downsampler（只压空间）<br/>[B,512,T/4,H/16,W/16]"]:::core',
              '  l3 --> l4["encoder.down.4：2×ResBlock3D（512）<br/>encoder.down.5：2×ResBlock3D（512→1024）<br/>这两级不再下采样"]:::core',
              '  l4 --> q["norm_out 1024 → conv_out 48（= 2×24）<br/>quant_conv 1×1×1 → μ, logσ² [B,24,T/4,H/16,W/16]"]:::out',
              '  q --> z["重参数化采样 z = μ + σ ⊙ ε<br/>再按 latents_mean / latents_std 逐通道缩放"]:::op',
              '  z --> patch["patch 1×2×2 → [B,N_v,96]<br/>video_patch_proj：Linear 96→5376"]:::latent',
              '  z --> vdec["ViT 解码器：x_embedder 24→2048<br/>36×（to_qkv 6144 + 门控 FF 8192）<br/>4 个 register token + mask_token"]:::attn',
              '  vdec --> vout["norm_out → proj_out 3072（= 3×4×16×16）<br/>每个 latent 位置展开成 (4 帧, 16×16) 像素块 → RGB"]:::out',
            ].join("\n"),
            facts:
              "<b>每一项都能在 checkpoint 里对上：</b>6 级 down、<b>4 级带 downsampler</b>（空间合计 16×）、通道 128→256→512→512→1024、<code>conv_out</code> 48 = 2×24、<code>latents_mean/std</code> 各 24、解码器 <b>36 层 ViT</b>（<code>proj_out</code> 3072）、4 个 register token。<b>张量名看不出来的两点：</b>时间轴的 2 次下采样具体落在哪两级、重建损失的形式与权重——都要读代码。左右声道无关，这是视频 VAE。",
            linkHref: "index.html#atlas-video-vae",
            linkText: "通用模块图鉴 15：时间因果视频 VAE 的通用结构与算例 →",
          },
          input: ["视频或图像帧序列 [B,3,T,H,W]。"],
          output: [
            "24 通道 latent；按 1×2×2 patch 化后进入主干。解码由 ViT 解码器完成。",
          ],
          role: [
            "把像素视频压缩成可学习的时空 latent，是长序列计算量可控的前提；官方还提到对 latent 空间做了多项优化以兼顾重建质量与可学习性。",
          ],
          repeat: ["I2V / V2V / 参考视频任务编码一次；纯 T2VA 不需要。"],
        },
        avae: {
          title: "H3-AudioVAE",
          meta:
            "32 kHz 立体声；每声道 40 Hz latent、32 通道；左右声道共用同一编解码器。checkpoint 显示它是 DAC 风格的波形 VAE（SnakeBeta 激活）。",
          diagram:
            '<div class="md-title">H3-AudioVAE：波形到音频 latent token（checkpoint 核验）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">立体声 waveform <code>x_a [B,2,S]</code><br />采样率 32 kHz；<code>S=32000×时长(秒)</code></div>' +
            '<span>↓ 左右声道分别处理（<code>conv_in</code> 是 <b>1→64</b> k=7，即每次只吃一个声道），权重共享</span>' +
            '<div class="md-pill md-pill-purple">编码器 5 级下采样：每级 3 个残差单元（Snake → k=7 卷积 → Snake → k=1 卷积）+ 步长卷积<br />步长 <b>2 / 4 / 4 / 5 / 5</b>，通道 64→128→256→512→1024→2048<br />合计 <code>2×4×4×5×5 = 800</code></div>' +
            '<div class="md-pill md-pill-amber"><code>block.6</code> Snake(2048) → <code>block.7</code> Conv1d k=3 → <code>mean_proj</code> / <code>logs_proj</code>（32×32×1）<br />latent <code>z_a [B,32,40×秒数]</code>，逐通道乘 <code>latents_mean/std</code>（32 个）</div>' +
            '<span>↓ 主干输入投影：<code>audio_patch_proj</code> <b>5376×32</b>（每个音频 token 32 个值）</span>' +
            '<div class="md-pill md-pill-output">音频 token <code>[B,N_a,5376]</code><br />与视频 token（96→5376）、条件 token（5120→5376）在同一 packed 序列中交互</div>' +
            '<div class="md-side-note">解码器同样不是纯卷积：<code>pre_block</code> 先在 latent / 特征序列上做一次注意力（<code>qkv</code> 6144×2048、带 <code>zero_k_bias</code>，另有一条 32 维支路），<code>dec_in_proj</code>（2048×32×1）把 32 通道 latent 投到 2048 维，<code>conv_pre</code> 1024×2048×7 之后进入 <b>7 级转置卷积</b>（通道 1024→512→256→128→64→32→16→8）与 <b>21 个残差块</b>（每级 3 个，SnakeBeta），最后由 <code>activation_post</code>（Snake + 1×1×12 低通滤波）与 <code>conv_post</code> 输出单声道波形。</div>' +
            "</div>" +
            '<div class="md-caption">15 秒音频对应每声道约 <b>600</b> 个 latent 时间位置（40×15）；由于 latent 是 32 通道，每声道的时间位置数与 token 数不是一回事，packed 序列里的 token 划分方式仍以推理代码为准。整条音频 VAE 约 151M 参数（编码 73.7M / 解码 77.5M），比视频 VAE 的 2.6B 小一个数量级。</div>',
          generic: {
            title: "H3-AudioVAE（checkpoint 核验）",
            note:
              "虚线框内是这条音频 VAE 的真实结构：单声道各自过共享权重，编码器 5 级步长卷积把 32 kHz 压到 40 Hz（合计 800×），latent 32 通道；解码器先做一次注意力再 7 级转置卷积回波形。",
            mermaid: [
              "flowchart TD",
              '  x["立体声波形<br/>[B,2,S] · 32 kHz"]:::in --> stem["encoder.block.0：Conv1d 1→64（k=7）<br/>（每声道单独输入，权重共享）"]:::core',
              '  stem --> e1["encoder.block.1：3×（Snake→k=7 卷积→Snake→k=1 卷积）<br/>+ 步长卷积 k=4（stride 2）<br/>[64→128 通道，S/2]"]:::core',
              '  e1 --> e2["encoder.block.2：3×残差单元 + 步长卷积 k=8（stride 4）<br/>128→256 通道，S/8"]:::core',
              '  e2 --> e3["encoder.block.3：3×残差单元 + 步长卷积 k=8（stride 4）<br/>256→512 通道，S/40"]:::core',
              '  e3 --> e4["encoder.block.4：3×残差单元 + 步长卷积 k=10（stride 5）<br/>512→1024 通道，S/200"]:::core',
              '  e4 --> e5["encoder.block.5：3×残差单元 + 步长卷积 k=10（stride 5）<br/>1024→2048 通道，S/800 = 40 Hz"]:::core',
              '  e5 --> q["block.6 Snake(2048) → block.7 Conv1d k=3<br/>mean_proj / logs_proj → μ, logσ² [B,32,40·秒]"]:::out',
              '  q --> z["重参数化采样 + latents_mean/std 逐通道缩放<br/>32 通道 latent"]:::op',
              '  z --> enc2["audio_patch_proj：Linear 32→5376<br/>作为 packed 序列的音频 token"]:::latent',
              '  z --> pre["解码：pre_block（注意力 qkv 6144×2048 + zero_k_bias）<br/>dec_in_proj 2048×32×1"]:::attn',
              '  pre --> dec["conv_pre 1024×2048×7<br/>7 级转置卷积（1024→512→256→128→64→32→16→8）<br/>21 个残差块（每级 3 个，SnakeBeta）"]:::core',
              '  dec --> out["activation_post（Snake + 1×1×12 低通滤波）<br/>conv_post 1×8×7 → 单声道波形，再按声道合成"]:::out',
            ].join("\n"),
            facts:
              "<b>可以从 checkpoint 直接确认的：</b>每个声道单独过共享权重（<code>conv_in</code> 是 1→64）、<b>5 级下采样步长 2/4/4/5/5 合计 800</b>（32000 ÷ 40 ✓）、<b>latent 32 通道</b>（<code>latents_mean/std</code> 各 32）、DAC 风格的 Snake/SnakeBeta 激活、解码器 7 级转置卷积 + 21 个残差块 + 抗镜像低通滤波，整条 VAE 约 151M 参数。<b>仍需读代码的：</b><code>pre_block</code> 里 32 维支路的确切作用、量化方式（是否有残差 VQ）以及 packed 序列中音频 token 的划分细节。",
            linkHref: "index.html#atlas-audio-vae",
            linkText: "通用模块图鉴 16：音频 VAE 的通用结构与算例 →",
          },
          input: [
            "立体声音频。参考音频必须与图像或视频输入一起使用（官方限制：音频不能作为唯一输入）。",
          ],
          output: ["每通道 40 Hz 的 latent 序列；解码后为 32 kHz 立体声。"],
          role: ["把音频压缩成与视频 latent 可联合建模的时序表示。"],
          repeat: ["参考音频编码一次；生成时音频 latent 每步更新。"],
        },
        omni: {
          title: "H3-Omni-Transformer",
          meta:
            "checkpoint 核验：50 层、hidden 5376、56 head × head_dim 128、q_norm/k_norm、SwiGLU 14336、每层一个 adaln_proj；MM-RoPE (t,h,w)。",
          diagram:
            '<div class="md-title">H3-Omni-Transformer：单一序列内的张量流（checkpoint 核验）</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">条件 token <code>[B,N_c,5376]</code>（condition_proj 5120→5376）<br />+ 视频状态 <code>[B,N_v,5376]</code>（96→5376）+ 音频状态 <code>[B,N_a,5376]</code>（32→5376）</div>' +
            '<span>↓ concat(seq)：组成统一 packed 序列（精确顺序未公开）</span>' +
            '<div class="md-pill md-pill-purple"><code>x [B,N_total,5376]</code>；<code>N_total=N_c+N_v+N_a</code></div>' +
            '<span>↓ <code>rope.inv_freq</code> 共 16 个频率：对 Q/K 施加 MM-RoPE (t,h,w)</span>' +
            '<div class="md-pill md-pill-amber">融合 QKV 投影 <code>qkv_proj 21504×5376</code>（= 3 × 7168）<br /><code>Q,K,V [B,56,N_total,128]</code>；<code>q_norm</code>/<code>k_norm</code> 各 128（对 head_dim 做 QK-Norm）</div>' +
            '<span>↓ attention read：<code>softmax(QKᵀ/√128)·V</code> → <code>out_proj 5376×7168</code></span>' +
            '<div class="md-pill">residual add + <code>norm1</code>（5376，仅 weight）</div>' +
            '<span>↓ 模态专属 AdaLN 调制：<code>adaln_proj 96768×8</code>（= 18 × 5376），输入是共享查表 <code>adaln_t_table</code>（1025 × 8）</span>' +
            '<div class="md-pill md-pill-amber"><code>$x_2 = x_1 \\odot (1 + \\mathrm{scale}) + \\mathrm{shift}$</code><br />这是 AdaLN 的标准表达；18 组调制向量如何分配给各个子层要看推理代码</div>' +
            '<span>↓ 共享 FFN：SwiGLU <code>fc1 28672×5376</code>（gate+up = 2×14336）→ <code>fc2 5376×14336</code> → residual add（<code>norm2</code>）</span>' +
            '<div class="md-pill md-pill-output">每层输出 <code>[B,N_total,5376]</code>，共 <b>50 层</b><br />按 token 类型 split(seq)</div>' +
            '<span>↓ <code>final_layer</code>：norm 5376 + adaln_proj 10752×8（= 2×5376），两路输出头 <code>video_out 96×5376</code> / <code>audio_out 32×5376</code></span>' +
            '<div class="md-pill md-pill-output">video update <code>[B,N_v,96]</code> + audio update <code>[B,N_a,32]</code></div>' +
            '<div class="md-side-note"><b>仍然不能确定：</b>18 组 AdaLN 调制向量的分配方式、各模态 token 的确切边界、输出参数化（epsilon / v / velocity）和训练 loss。checkpoint 已经能确认的是：50 层、hidden 5376、56×128 的 MHA + QK-Norm（这份 repack 不是 GQA）、SwiGLU 14336、单个融合 qkv_proj、每层独立 adaln_proj。</div>' +
            '<div class="md-side-note"><b>关于“约 13B 参数在 AdaLN 分支”：</b>这份社区 int8 剪枝版里 AdaLN 相关只占约 <b>43.65M</b>（0.22%），形态是「1025×8 的时间步查表 + 每层 96768×8 的小线性层」。引用官方那句说法时要注明它指的是官方完整权重，不能和这份剪枝 repack 混写。</div>' +
            "</div>" +
            '<div class="md-caption">理解方式：视频和音频不是两条独立 Transformer 主干，而是带有不同输入 / 输出层的 token 段，共享同一套 attention 与 FFN；<code>concat</code> 发生在序列维，<code>residual add</code> 要求形状一致，<code>split</code> 只按 token 边界拆回各模态。</div>',
          generic: {
            title: "H3-Omni-Transformer 的一个 block（50 层同构，checkpoint 核验）",
            note:
              "checkpoint 核验：50 层、hidden 5376、单个融合 qkv_proj（21504×5376 = 3×7168，即 56 head × 128）、q_norm/k_norm 做 QK-Norm、SwiGLU 14336、每层一个 adaln_proj 96768×8；框内是这一层的完整张量流。",
            mermaid: [
              "flowchart TD",
              '  x["packed 序列 [B,N_total,5376]<br/>条件 token + 视频 token + 音频 token"]:::in --> norm["AdaLN 调制（每层一份 adaln_proj 96768×8 = 18×5376）<br/>输入是共享查表 adaln_t_table（1025×8）"]:::norm',
              '  norm --> qkv["融合 QKV 投影：qkv_proj 21504×5376<br/>[B,56,N_total,128]"]:::core',
              '  qkv --> qk["q_norm / k_norm（各 128）<br/>对 head_dim 做 QK-Norm"]:::op',
              '  qk --> rope["MM-RoPE (t,h,w) 作用于 Q/K<br/>rope.inv_freq 共 16 个频率"]:::op',
              '  rope --> attn["joint attention：所有 token 共享 K/V<br/>softmax(QKᵀ/√128)·V"]:::attn',
              '  attn --> res1["out_proj 5376×7168 → residual add（norm1）"]:::core',
              '  res1 --> ffn["共享 FFN（SwiGLU）：fc1 28672×5376<br/>（gate + up = 2×14336）→ fc2 5376×14336"]:::core',
              '  ffn --> res2["residual add（norm2）"]:::out',
              '  res2 --> repeat["该层输出 [B,N_total,5376]<br/>共 50 层（blocks.0–49）"]:::core',
              '  repeat --> split["final_layer：norm 5376 + adaln_proj 10752×8<br/>按 token 边界 split(seq)"]:::op',
              '  split --> vhead["video_out 96×5376<br/>video update [B,N_v,96]（= 24×1×2×2）"]:::out',
              '  split --> ahead["audio_out 32×5376<br/>audio update [B,N_a,32]"]:::out',
            ].join("\n"),
            facts:
              "<b>已经从 checkpoint 确认：</b>50 层 single-stream（视频与音频共享 attention 与 FFN）、hidden 5376、<b>56 head × head_dim 128</b> 的 MHA + QK-Norm（这份 repack 不是 GQA，不要照抄官方示意图里的 GQA 说法）、SwiGLU intermediate 14336、单个融合 qkv_proj、每层独立 <code>adaln_proj</code>、视频/音频输出头分别是 96 / 32 维。<b>仍要读代码：</b>18 组 AdaLN 调制向量如何分配给各子层、各模态 token 边界、输出参数化与训练 loss。<b>关于“约 13B 在 AdaLN 分支”：</b>那是官方完整权重的说法；这份社区 int8 剪枝版里 AdaLN 相关只有约 43.65M（0.22%），形态是查表 + 每层小线性层。",
            linkHref: "index.html#atlas-single-stream",
            linkText: "通用模块图鉴 13.2：单流 AdaLN 主干的通用结构对照 →",
          },
          input: [
            "packed 多模态序列（文本/参考条件 token + 视频 latent token + 音频 latent token）与 MM-RoPE 位置信息。",
          ],
          output: ["视频与音频两路 latent 的预测更新量（参数化形式未公开）。"],
          role: [
            "在同一序列内联合建模视频与音频，使口型、动作与声音节奏在生成阶段建立关系，而不是后期 mux。",
          ],
          repeat: ["每个 sampling step 执行一次；步数未公开。"],
        },
        refiner: {
          title: "token_refiner ×2",
          meta:
            "checkpoint 里独立存在的一组精炼模块：2 层，结构与主干 block 同构（D=5376、56×128、SwiGLU 14336），另有 token_refiner.final_norm；合计约 771M 参数。",
          diagram:
            '<div class="md-title">token_refiner：与主干同构的 2 层</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">输入 token 序列（哪一段 token 由推理代码决定）</div>' +
            '<span>↓ token_refiner.blocks.0 / blocks.1：norm1 → attn（qkv_proj 21504×5376、out_proj 5376×7168、q_norm/k_norm 128）→ norm2 → SwiGLU（fc1 28672×5376、fc2 5376×14336）</span>' +
            '<div class="md-pill md-pill-purple">每层结构与主干 block 完全一致，只是没有 adaln_proj（时间调制）这一支</div>' +
            '<span>↓ token_refiner.final_norm</span>' +
            '<div class="md-pill md-pill-output">精炼后的 token，形状不变</div>' +
            "</div>" +
            '<div class="md-caption">它在论文与公告里都没有出现，是从 checkpoint 的张量名发现的模块。可以确定的是层数、宽度与参数量；它作用在「条件 token」还是「整条 packed 序列」上，必须读推理代码，本页不推测。</div>',
          input: ["某一段 token 序列。"],
          output: ["同形状的精炼后 token（2 层堆叠 + final_norm）。"],
          role: [
            "在主干之外做一次额外的 token 精炼。三处证据：命名独立于 blocks.*、结构与主干同构、参数量约 771M（相当于 2 个主干层）。",
          ],
          repeat: ["每次前向一次（是否在每个采样步重算取决于推理实现）。"],
        },
        upscaler: {
          title: "3D latent upscaler（2K 路径，社区侧 checkpoint）",
          meta:
            "约 345M 参数；conv_in 512×24×3×3×3、18 个 in_blocks + 18 个 out_blocks、conv_out 24×512×3×3×3，偶数块带时间条件（emb_layers 1024×64），奇数块是时间轴深度可分离卷积。",
          diagram:
            '<div class="md-title">3D latent upscaler：24 通道 latent 在 latent 空间放大</div>' +
            '<div class="md-flow md-vertical">' +
            '<div class="md-pill md-pill-blue">latent [B,24,T,H,W]（768p 路径的输出）</div>' +
            '<span>↓ <code>conv_in</code> 512×24×3×3×3 → [B,512,T,H,W]</span>' +
            '<div class="md-pill md-pill-purple">时间步 → <code>embed.0/2</code>（64×1 → 64 → 64）→ 每块的 <code>emb_layers</code> 1024×64</div>' +
            '<span>↓ 18 个 in_blocks：偶数块 = 带时间条件的 ResBlock3D（in_layers/out_layers/out_norm）；奇数块 = 时间轴块（dwconv 512×1×5×1×1 + norm + pwconv 512×512×1×1×1）</span>' +
            '<div class="md-pill md-pill-amber">18 个 out_blocks（同样的奇偶交替）</div>' +
            '<span>↓ <code>conv_out</code> 24×512×3×3×3</span>' +
            '<div class="md-pill md-pill-output">放大后的 latent [B,24,T′,H′,W′] → 交给同一套 VisualVAE 解码</div>' +
            "</div>" +
            '<div class="md-caption">这是 ComfyUI 侧提供的放大模块，官方公告里的 H3-Regenerate-2K 仍是闭源 API。两件事不要混写：本地能跑这个 upscaler，不代表能在本地复现官方 2K 服务的全部行为（它可能还依赖额外的条件与迭代重生成）。</div>',
          input: ["24 通道视频 latent（例如 768p 路径的输出）。"],
          output: ["24 通道放大后的 latent。"],
          role: [
            "在 latent 空间放大分辨率，避免直接在像素域超分；时间轴用深度可分离卷积专门处理，空间与通道由 ResBlock3D 处理。",
          ],
          repeat: ["每次生成一次，不在采样循环内。"],
        },
      },
    },
  };

  function resolveDataflowSpec(key) {
    return dataflowCatalog[key] || null;
  }

  const architectureHost = reader.querySelector("[data-architecture]");
  if (architectureHost) {
    const spec = resolveDataflowSpec(architectureHost.dataset.architecture);
    if (spec) {
      renderDataflow(architectureHost, spec);
    } else {
      architectureHost.innerHTML =
        '<div class="df-unknown"><strong>该模型的架构图尚未整理</strong><p>本页缺少 <code>' +
        String(architectureHost.dataset.architecture) +
        "</code> 的数据流定义；在补齐论文与 checkpoint 依据前不绘制推测图。</p></div>";
    }
  }

  // 页面正文里用 <div data-skeleton="sdxl|sd15"></div> 插入同一个 U-Net 骨架图，
  // 避免同一张图在模块弹窗和正文里出现两种不一致的画法。
  reader.querySelectorAll("[data-skeleton]").forEach((slot) => {
    slot.innerHTML = unetSvg(slot.dataset.skeleton);
  });

  // 页面正文里的通用模块完整结构插槽（与模块弹窗共用 genericStructures 的定义）。
  reader.querySelectorAll("[data-generic]").forEach((slot) => {
    const spec = genericStructures[slot.dataset.generic];
    if (spec) slot.innerHTML = gnBlock(spec);
  });

  const currentPage = location.pathname.split("/").pop();
  const overviewPages = new Set([
    "image-models.html",
    "video-models.html",
    "image-flux-qwen.html",
  ]);
  if (overviewPages.has(currentPage)) {
    reader.querySelectorAll("a[href]").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const path = href.split("#")[0];
      if (path && path !== currentPage && path.endsWith(".html")) {
        link.target = "_blank";
        link.rel = "noopener";
      }
    });
  }

  if (reader.querySelector(".detail-nav")) return;
  const sections = Array.from(reader.querySelectorAll(".detail-section"));
  if (!sections.length) return;

  // Keep cross-page links stable even when a legacy detail page was authored without an explicit anchor.
  sections.forEach((section) => {
    const heading = section.querySelector("h2");
    if (heading && /LoRA|微调|微调/.test(heading.textContent) && !section.id)
      section.id = "finetune";
  });

  const nav = document.createElement("nav");
  nav.className = "detail-nav";
  nav.setAttribute("aria-label", "本页目录");
  sections.forEach((section, index) => {
    const heading = section.querySelector("h2");
    if (!heading) return;
    if (!section.id) section.id = "detail-section-" + (index + 1);
    const link = document.createElement("a");
    link.href = "#" + section.id;
    link.textContent = heading.textContent.trim();
    nav.append(link);
  });

  const terms = reader.querySelector(".detail-terms");
  const diagram = reader.querySelector(".arch-diagram");
  (terms || diagram || reader.querySelector(".lead")).insertAdjacentElement(
    "afterend",
    nav,
  );

  if (location.pathname.endsWith("image-dit.html")) {
    const block = sections.find((section) =>
      /Transformer block/.test(section.textContent),
    );
    if (block && !block.querySelector(".model-clarification")) {
      const note = document.createElement("p");
      note.className = "model-clarification callout";
      note.innerHTML =
        "<strong>把 MLP 放回 SD3 的真实位置：</strong>在每个 image/text stream 的 attention residual 之后，先做 norm/AdaLN，再进入 feed-forward/MLP，最后与 stream 输入做 residual add。这里的 MLP 是 token 维度上的升维、激活/门控、降维；它不在 VAE、scheduler 或 patchify 中，也不等于所有实现都使用 SwiGLU。具体是 GEGLU、普通 FFN 还是融合实现，要看该 checkpoint 的 transformer 源码和参数名。";
      block.append(note);
    }
  }

  if (location.hash === "#finetune") {
    requestAnimationFrame(() =>
      document.getElementById("finetune")?.scrollIntoView({ block: "start" }),
    );
  }
})();
