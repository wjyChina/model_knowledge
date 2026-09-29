# H3 checkpoint 核验记录

本文件记录 MiniMax H3 的结构数字是怎么从本地 checkpoint 读出来的，作为模型详情页（`video-h3.html`）与通用知识里 H3 相关结论的依据。读取方式只解析 safetensors 头部、不加载权重；路径来自 `D:\Comfy-Desktop\ComfyUI-Shared\models\`（ComfyUI 侧 repack，不是官方原始权重）。核验流程与写法约定见 `MODEL_DETAIL_GUIDE.md` 第八节。

## 1. H3-Base 主干：minimax_h3_fl2va / ref2va_pruned_int8_convrot.safetensors

- 932 个张量，按张量形状统计 **约 20.1B 参数**（社区剪枝 + int8；官方宣布的完整模型是 33B dense，两者不要混写）
- **blocks.0 … blocks.49 → 50 层**，每层 18 个张量
- 每层 386.2M：attention(qkv+out) 154.1M + MLP 231.2M
- hidden **D = 5376**；`attn.qkv_proj` 21504×5376 = 3 × 7168；`attn.out_proj` 5376×7168
  → **56 个 head × head_dim 128**（这份 checkpoint 是 MHA，不是 GQA）
- `attn.q_norm` / `attn.k_norm` = 128 维 → QK-Norm（对 head_dim 做归一化）
- `mlp.fc1` 28672×5376（gate + up = 2 × 14336），`mlp.fc2` 5376×14336
  → **SwiGLU，intermediate = 14336 = 5376 × 8/3**
- `norm1` / `norm2` = 5376（只有 weight）
- `adaln_t_table` **1025×8**；每层 `adaln_proj.linear` **96768×8**（= 18 × 5376）
  → AdaLN 相关合计 **43.65M ≈ 0.22%**：这份 repack 把「每步调制」物化成 1025 步 × 8 维查表 + 每层小线性层
- `final_layer`：`norm` 5376、`adaln_proj.linear` 10752×8（= 2 × 5376）、
  `video_out` **96**×5376、`audio_out` **32**×5376 → **视频 token 96 维（= 24×1×2×2）、音频 token 32 维**
- 输入投影：`video_patch_proj` 5376×96、`audio_patch_proj` 5376×32、`condition_proj` **5376×5120**
  → **H3-Encoder 输出宽度 = 5120**
- `token_refiner`：**2 层**（结构与主干同构，770.7M）+ `final_norm`
- `rope.inv_freq`：**16** 个频率（对应 32 / 128 个 head 维参与旋转）

## 2. H3-Encoder：qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors

- `model.layers` **50 层**（0–49），每层 34 个张量；**没有 `model.norm`、没有 `lm_head`** → 纯编码器
- hidden **5120**，vocab **151936**
- GQA：`q_proj` 8192（64 × 128）、`k_proj` / `v_proj` 1024（8 × 128）→ **64:8**
- `q_norm` / `k_norm` = 128 → QK-Norm；SwiGLU：gate/up → 12800，down 5120×12800
- 视觉塔：`patch_embed.proj` **Conv3d 1152×3×2×16×16**（tubelet = 2 帧 × 16×16 像素）
  → ViT hidden **1152**；`pos_embed` **2304 = 48×48**；**27 个 ViT block**（qkv 3456、MLP 1152→4304→1152）
- `merger`：norm 1152 + fc1 4608×4608 + fc2 5120×4608
- **`visual.deepstack_merger_list` 3 个**（各 norm 4608 + fc1 4608×4608 + fc2 5120×4608）
  → Qwen3-VL 的 deepstack：把 ViT 三个深度的特征各自 merge 后一起交给 LLM

## 3. Video VAE：minimax_h3_video_vae_fp16.safetensors（2.60B）

- **编码器：3D 因果卷积**。`conv_in` 3→128（k=3×3×3）；`encoder.down.0..5` **共 6 级**，每级 2 个
  ResBlock3D（conv1/conv2 k=3×3×3 + norm1/norm2，通道变化时用 `nin_shortcut` 1×1×1）
- 通道：128 → 256 → 512 → 512 → 1024；**4 个下采样**在 level 0/1/2/3，level 4/5 只加深 → 空间 16×、时间 4×
- 尾部：`norm_out` 1024 → `conv_out` **48**×1024×3×3×3（= 2 × 24：μ 与 logσ²）→ `quant_conv` 48×48×1×1×1
- `post_quant_conv` 24×24×1×1×1、**`latents_mean` / `latents_std` 各 24** → 逐通道 latent 缩放
- **解码器是 ViT**：`x_embedder` 24→2048、**36 个 transformer_blocks**（qkv 6144、out 2048、
  门控 FF：w1 16384 = 2×8192、w2 8192→2048、norm1/norm2 + 可学习 `scale1`/`scale2`）
- `mask_token`、**`register_tokens` 4 个**、`norm_out` 2048、`proj_out` **3072**×2048
  → 3072 = 3 × 4 × 16 × 16：**每个 latent 位置展开成 (4 帧, 16×16) 的 RGB 块**
- 参数分布：编码侧 180M / 解码侧 2.42B

## 4. Audio VAE：minimax_h3_audio_vae_fp32.safetensors（151M）

- **DAC 风格**：Snake / SnakeBeta 激活（`alpha`、`beta` 可学习）
- `encoder.block.0` = Conv1d **1**→64 k=7（每个声道单独处理）
- `encoder.block.1..5`：3 个残差单元（Snake + k=7 + Snake + k=1）×3 + 步长卷积
  k=4/8/8/10/10 → **stride 2/4/4/5/5**，通道 64→128→256→512→1024→2048
  → 总下采样 **2×4×4×5×5 = 800** = 32000 / 40 ✓
- 尾部：`block.6`（Snake 2048）、`block.7`（Conv1d k=3）、`mean_proj` / `logs_proj` 32×32×1
  → **latent 32 通道**，`latents_mean/std` 32
- 解码器：`pre_block`（注意力 qkv 6144×2048 + 32 维支路 + `zero_k_bias`）、`dec_in_proj` 2048×32×1、
  `conv_pre` 1024×2048×7、**7 级 `decoder.ups`**（1024→512→256→128→64→32→16→8）
- **21 个 `decoder.resblocks`**（每级 3 个，SnakeBeta + convs1/convs2）
- `activation_post`：Snake + **低通滤波器 1×1×12**（上采样抗镜像）→ `conv_post` 1×8×7

## 5. Latent upscaler（3D）：minimax_h3_latent_upscaler_3d_fp16.safetensors（345M）

- `conv_in` 512×24×3×3×3（24 通道 latent → 512）、`conv_out` 24×512×3×3×3
- **18 个 `in_blocks` + 18 个 `out_blocks`**：
  - 偶数块 = 带时间条件的 ResBlock（`in_layers` / `out_layers` / `out_norm` + `emb_layers` 1024×64）
  - 奇数块 = 纯时间轴块（`dwconv` 512×1×**5**×1×1 深度可分离时间卷积 + `norm` + `pwconv` 1×1×1）
- `embed.0`/`embed.2`：64×1 → 64 → 64（标量时间步 → 64 维嵌入，再经 `emb_layers` 到 1024）
- 编解码各 172.6M

## 6. 目录里还有的其它 checkpoint（供后续核验）

同目录下另有可核验的权重，可作为下一批对象：

- `diffusion_models/flux2_dev_fp8mixed.safetensors`、`flux-2-klein-9b-fp8.safetensors` + `vae/flux2-vae.safetensors` + `text_encoders/mistral_3_small_flux2_fp8.safetensors`（FLUX.2，本手册目前只覆盖 FLUX.1）
- `diffusion_models/qwen_image_edit_2511_int8_convrot.safetensors`、`qwen_image_edit_2509_fp8_e4m3fn.safetensors` + `vae/qwen_image_vae.safetensors` + `text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors`
- `vae/Wan2_1_VAE_bf16.safetensors`、`text_encoders/umt5-xxl-enc-bf16.safetensors`（Wan 侧）
- `checkpoints/animagine-xl-3.1.safetensors`（SDXL 系，可用来核验 SDXL U-Net 的层数与通道）
- `clip_vision/clip_vision_h.safetensors`（CLIP-H 图像塔）
