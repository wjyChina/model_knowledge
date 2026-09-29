/* ===========================================================================
   mathlite.js —— 站点内置的数学排版器（LaTeX 风格的上下标）
   ---------------------------------------------------------------------------
   解决两件事：

   1) 自动把正文里已经写好的数学记号渲染成真正的上下标，而不是让读者看到
      “N_img”“z_t”“R^(B×3×H×W)”这种纯文本：
        N_img      → N 下标 img
        z_{t-1}    → z 下标 t-1
        z_t        → z 下标 t
        W_u^T      → W 下标 u、上标 T
        R^(B×3×H×W)→ R 上标 (B×3×H×W)
        ‖·‖^2      → ‖·‖ 上标 2
      只有“数学符号 + 下标/上标”才会被转换；像 named_modules、target_modules、
      conv_in、layers_per_block、to_q、q_proj、x_embedder、v_prediction 这类
      真实标识符不会被误改（见 BASE_STRICT / BASE_SOFT / SUB_BLACKLIST）。

   2) 支持 $...$ 行内 LaTeX（子集），公式可以按 LaTeX 习惯书写：
        $z_t = \sqrt{\bar\alpha_t}\,z_0 + \sqrt{1-\bar\alpha_t}\,\epsilon$
        $L_{\text{lora}} = \mathbb{E}\left[\|f_{W+\Delta W}(z_t,t,c)-v\|^2\right]$
      支持 \frac{}{}、\sqrt{}、\bar/\hat/\tilde/\vec、希腊字母、常用算子、
      \text{} / \mathrm{}、\left \right 定界符、_ ^ 上下标。

   公共 API：
     MathLite.renderIn(root)     就地渲染 root（默认 document）内的数学记号
     MathLite.autoText(raw)      纯文本 → HTML 片段（含上下标）
     MathLite.tex(src)           $...$ 里的 LaTeX 子集 → HTML
     MathLite.atomsToSvg(line)   SVG <text> 用的上下标（mermaid 图里复用）
   =========================================================================== */
(function (global) {
  "use strict";

  // ------------------------------------------------------------------ 词表
  var GREEK = {
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
    zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
    lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
    varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
    varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
    Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
    Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  };

  var OPS = {
    cdot: "·", times: "×", odot: "⊙", oplus: "⊕", otimes: "⊗", ast: "∗",
    approx: "≈", sim: "∼", simeq: "≃", cong: "≅", equiv: "≡", neq: "≠",
    le: "≤", leq: "≤", ge: "≥", geq: "≥", ll: "≪", gg: "≫",
    in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆", supset: "⊃",
    mid: "|", bigm: "|", top: "ᵀ", bot: "⊥",
    to: "→", rightarrow: "→", leftarrow: "←", mapsto: "↦", implies: "⟹",
    iff: "⟺", rightleftharpoons: "⇌",
    sum: "∑", prod: "∏", int: "∫", nabla: "∇", partial: "∂", infty: "∞",
    pm: "±", mp: "∓", propto: "∝", angle: "∠", perp: "⊥", parallel: "∥",
    ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", ddots: "⋱",
    cup: "∪", cap: "∩", setminus: "∖", emptyset: "∅",
    lVert: "‖", rVert: "‖", Vert: "‖", lvert: "|", rvert: "|", vert: "|",
    langle: "⟨", rangle: "⟩", quad: "\u2003", qquad: "\u2003\u2003",
    thinspace: "\u2009", neg: "¬", forall: "∀", exists: "∃",
    mathbb: null, mathcal: null, mathrm: null, text: null, operatorname: null,
  };

  // 单字母基准之外，允许“数学变量名”当作基准的名词。
  var BASE_STRICT = { eps: 1, vel: 1, pi: 1 };
  // 这些词只有在下标是短记号时才当数学变量（避免 target_video / target_014 被误改）。
  // shift / scale / gate 是 AdaLN 的调制参数（shift_msa、gate_mlp…），
  // 它们的下标必须命中 SHORT_SUBS 才转换，所以 gate_proj 这类模块名不受影响。
  var BASE_SOFT = {
    target: 1, noise: 1, clean: 1, latent: 1, pred: 1, loss: 1,
    weight: 1, score: 1, reward: 1, teacher: 1, student: 1,
    shift: 1, scale: 1, gate: 1,
  };
  var SHORT_SUBS = {
    t: 1, T: 1, i: 1, j: 1, n: 1, k: 1, v: 1, c: 1, x: 1, y: 1,
    "0": 1, "1": 1, theta: 1, lat: 1, ref: 1, gt: 1, msa: 1, mlp: 1,
  };
  // 真实代码标识符（形如 X_yyy，基准恰好是单个字母）必须排除。
  var SUB_BLACKLIST = { proj: 1, prediction: 1, embedder: 1 };

  var GREEK_CHARS = "αβγδεζηθικλμνξοπρστυφχψωΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ";
  var COMBINING = "\u0304\u0305\u0306\u0307\u0308\u030a"; // ̄ ̄ ̂ ̇ ̈ ̊
  var ARG = "(\\{[^{}]*\\}|\\([^()]*\\)|[A-Za-z0-9]{1,24})";
  // 基准按「希腊字母串 → 白名单词 → 单个拉丁字母」的顺序尝试：
  // 多字母词必须排在单字母前面，否则 eps_c 会被拆成 e + ps_c。
  var SOFT_BASES = Object.keys(BASE_SOFT).concat(Object.keys(BASE_STRICT)).join("|");
  var BASE_ALT = "([" + GREEK_CHARS + COMBINING + "]+|" + SOFT_BASES + "|[A-Za-z])";

  // 注意：autoText 会递归处理下标/上标内部的内容，如果共用一个带 g 的 RegExp，
  // 内层调用会改写 lastIndex、把外层的扫描位置重置，从而出现重复扫描。
  // 因此这里只保留 source，每次就地新建一个独立的 RegExp。
  var TOKEN_SOURCE =
    "(?:" +
    "(\u2016|\\|\\|)\\^" + ARG + // 1 范数符号，2 指数
    "|" +
    "(?<![A-Za-z0-9_\\\\])" + BASE_ALT + "(?:_" + ARG + ")?(?:\\^" + ARG + ")?" + // 3 基准，4 下标，5 上标
    ")";

  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function stripDelim(arg) {
    var value = String(arg || "");
    var first = value.charAt(0);
    var last = value.charAt(value.length - 1);
    if ((first === "{" && last === "}") || (first === "(" && last === ")")) {
      return value.slice(1, -1);
    }
    return value;
  }

  function isBase(base) {
    if (!base) return false;
    if (base.length === 1 && /[A-Za-z]/.test(base)) return true;
    if (new RegExp("^[" + GREEK_CHARS + COMBINING + "]+$").test(base)) return true;
    var lower = base.toLowerCase();
    return !!(BASE_STRICT[lower] || BASE_SOFT[lower]);
  }

  function isAllowedSub(base, sub) {
    if (!sub) return true;
    var raw = stripDelim(sub);
    if (SUB_BLACKLIST[raw.toLowerCase()]) return false;
    var lower = String(base || "").toLowerCase();
    if (BASE_SOFT[lower] && !BASE_STRICT[lower]) {
      return !!SHORT_SUBS[raw];
    }
    return true;
  }

  // ------------------------------------------------------ 自动上下标（文本）
  // 返回 HTML 片段：只有上下标部分会插入标签，其余文本按原样转义。
  function autoText(raw) {
    var text = String(raw == null ? "" : raw);
    if (!text) return "";
    var out = "";
    var last = 0;
    var match;
    var re = new RegExp(TOKEN_SOURCE, "g");
    while ((match = re.exec(text))) {
      if (!match[0]) {
        re.lastIndex += 1;
        continue;
      }
      if (match[1]) {
        // ‖·‖^n
        out += esc(text.slice(last, match.index));
        out += esc(match[1]) + "<sup>" + autoText(stripDelim(match[2])) + "</sup>";
        last = match.index + match[0].length;
        continue;
      }
      var base = match[3];
      var sub = match[4];
      var sup = match[5];
      if (!sub && !sup) continue;
      if (!isBase(base) || !isAllowedSub(base, sub)) continue;
      // 防止把更长的标识符截断：例如 L_reconstruction 不能被切成 L_reconstructi + on
      if (/[A-Za-z0-9_]/.test(text.charAt(match.index + match[0].length))) continue;
      out += esc(text.slice(last, match.index));
      out += esc(base);
      if (sub) out += "<sub>" + autoText(stripDelim(sub)) + "</sub>";
      if (sup) out += "<sup>" + autoText(stripDelim(sup)) + "</sup>";
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  // ------------------------------------------------------ $...$ 的 LaTeX 子集
  function readArg(src, i) {
    while (src.charAt(i) === " ") i += 1;
    if (src.charAt(i) === "{") {
      var depth = 0;
      var start = i + 1;
      for (var j = i; j < src.length; j += 1) {
        var ch = src.charAt(j);
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) return { content: src.slice(start, j), end: j + 1 };
        }
      }
      return { content: src.slice(start), end: src.length };
    }
    if (src.charAt(i) === "\\") {
      var m = /^\\[A-Za-z]+/.exec(src.slice(i));
      if (m) return { content: m[0], end: i + m[0].length };
      return { content: src.slice(i, i + 2), end: i + 2 };
    }
    var rest = /^[0-9]+/.exec(src.slice(i));
    if (rest) return { content: rest[0], end: i + rest[0].length };
    return { content: src.charAt(i), end: i + 1 };
  }

  function accent(kind, body) {
    return '<span class="m-acc m-acc-' + kind + '"><span class="m-acc-base">' + body + "</span></span>";
  }

  function tex(src) {
    var s = String(src == null ? "" : src);
    var i = 0;
    var out = "";
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === "\\") {
        var cmd = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
        if (!cmd) { i += 1; continue; }
        var name = cmd[1];
        i += cmd[0].length;
        if (Object.prototype.hasOwnProperty.call(GREEK, name)) {
          out += '<i class="m-greek">' + GREEK[name] + "</i>";
          continue;
        }
        if (name === "frac" || name === "dfrac" || name === "tfrac") {
          var num = readArg(s, i); i = num.end;
          var den = readArg(s, i); i = den.end;
          out += '<span class="m-frac"><span class="m-frac-n">' + tex(num.content) +
            '</span><span class="m-frac-d">' + tex(den.content) + "</span></span>";
          continue;
        }
        if (name === "sqrt") {
          var deg = null;
          if (s.charAt(i) === "[") {
            var close = s.indexOf("]", i);
            deg = s.slice(i + 1, close);
            i = close + 1;
          }
          var rad = readArg(s, i); i = rad.end;
          out += '<span class="m-sqrt">' + (deg ? '<sup class="m-sqrt-deg">' + tex(deg) + "</sup>" : "") +
            '<span class="m-sqrt-sign">√</span><span class="m-sqrt-body">' + tex(rad.content) + "</span></span>";
          continue;
        }
        if (name === "text" || name === "mathrm" || name === "operatorname" || name === "mathbb" || name === "mathcal") {
          var txt = readArg(s, i); i = txt.end;
          if (name === "mathbb") {
            out += '<span class="m-rm m-mathbb">' + esc(doubleStruck(txt.content)) + "</span>";
          } else {
            out += '<span class="m-rm">' + esc(txt.content) + "</span>";
          }
          continue;
        }
        if (name === "bar" || name === "hat" || name === "tilde" || name === "vec" || name === "dot" || name === "ddot" || name === "overline" || name === "widehat" || name === "widetilde") {
          var acc = readArg(s, i); i = acc.end;
          var kind = name === "overline" ? "bar" : name === "widehat" ? "hat" : name === "widetilde" ? "tilde" : name;
          out += accent(kind, tex(acc.content));
          continue;
        }
        if (name === "left" || name === "right") {
          var delim = s.charAt(i);
          if (delim === "\\") {
            var dm = /^\\([A-Za-z.]+|.)/.exec(s.slice(i));
            if (dm) {
              delim = dm[1] === "." ? "" : OPS[dm[1]] || dm[1];
              i += dm[0].length;
            }
          } else {
            i += 1;
          }
          out += '<span class="m-delim">' + esc(delim) + "</span>";
          continue;
        }
        if (name === "log" || name === "ln" || name === "exp" || name === "sin" || name === "cos" ||
            name === "tan" || name === "max" || name === "min" || name === "softmax" || name === "argmax" ||
            name === "KL" || name === "E" || name === "Var" || name === "Cov" || name === "diag" || name === "clip") {
          out += '<span class="m-op-name">' + name + "</span>";
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(OPS, name) && OPS[name]) {
          out += '<span class="m-op">' + OPS[name] + "</span>";
          continue;
        }
        if (name === "," || name === ";" || name === ":" || name === "!" || name === " ") {
          out += name === "!" ? "" : " ";
          continue;
        }
        if (name === "{" || name === "}" || name === "%" || name === "&" || name === "#" || name === "_") {
          out += esc(name);
          continue;
        }
        if (name === "|") {
          out += '<span class="m-op">‖</span>';
          continue;
        }
        out += '<span class="m-op">' + esc(name) + "</span>";
        continue;
      }
      if (ch === "{") {
        var grp = readArg(s, i);
        out += tex(grp.content);
        i = grp.end;
        continue;
      }
      if (ch === "^" || ch === "_") {
        var arg = readArg(s, i + 1);
        i = arg.end;
        out += (ch === "^" ? "<sup>" : "<sub>") + tex(arg.content) + (ch === "^" ? "</sup>" : "</sub>");
        continue;
      }
      if (/[A-Za-z]/.test(ch)) {
        out += "<i>" + ch + "</i>";
        i += 1;
        continue;
      }
      if (ch === " ") { out += " "; i += 1; continue; }
      if (ch === "|") { out += '<span class="m-delim">|</span>'; i += 1; continue; }
      if (ch === "-") { out += '<span class="m-op">−</span>'; i += 1; continue; }
      if (ch === "*") { out += '<span class="m-op">·</span>'; i += 1; continue; }
      out += esc(ch);
      i += 1;
    }
    return out;
  }

  // ------------------------------------------------------ 加工一段文本
  // 先处理 $...$，其余部分做自动上下标。
  function transform(raw) {
    var text = String(raw == null ? "" : raw);
    if (text.indexOf("$") < 0) return autoText(text);
    var out = "";
    var index = 0;
    var re = /\$([^$]+)\$/g;
    var m;
    while ((m = re.exec(text))) {
      out += autoText(text.slice(index, m.index));
      out += '<span class="m-math">' + tex(m[1]) + "</span>";
      index = m.index + m[0].length;
    }
    out += autoText(text.slice(index));
    return out;
  }

  // ------------------------------------------------------ SVG 文本（mermaid）
  function atomsToSvg(raw) {
    var text = String(raw == null ? "" : raw);
    var out = "";
    var last = 0;
    var match;
    var re = new RegExp(TOKEN_SOURCE, "g");
    while ((match = re.exec(text))) {
      if (!match[0]) {
        re.lastIndex += 1;
        continue;
      }
      if (match[1]) {
        out += esc(text.slice(last, match.index));
        out += esc(match[1]) + svgShift("sup", stripDelim(match[2]));
        last = match.index + match[0].length;
        continue;
      }
      var base = match[3];
      var sub = match[4];
      var sup = match[5];
      if (!sub && !sup) continue;
      if (!isBase(base) || !isAllowedSub(base, sub)) continue;
      if (/[A-Za-z0-9_]/.test(text.charAt(match.index + match[0].length))) continue;
      out += esc(text.slice(last, match.index));
      out += esc(base);
      if (sub) out += svgShift("sub", stripDelim(sub));
      if (sup) out += svgShift("sup", stripDelim(sup));
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  // 注意：类名用 ml-msub / ml-msup，不要用 ml-sub —— 后者在 mermaid 里是
  // “子程序形状”的连线类名，会带上 stroke 颜色，导致下标被描边染色。
  function svgShift(kind, content) {
    return (
      '<tspan class="ml-m' + kind + '" baseline-shift="' + kind + '" font-size="8.8">' +
      esc(content) + "</tspan>"
    );
  }

  var DOUBLE_STRUCK = {
    A: "𝔸", B: "𝔹", C: "ℂ", D: "𝔻", E: "𝔼", F: "𝔽", G: "𝔾", H: "ℍ", I: "𝕀",
    J: "𝕁", K: "𝕂", L: "𝕃", M: "𝕄", N: "ℕ", O: "𝕆", P: "ℙ", Q: "ℚ", R: "ℝ",
    S: "𝕊", T: "𝕋", U: "𝕌", V: "𝕍", W: "𝕎", X: "𝕏", Y: "𝕐", Z: "ℤ", 1: "𝟙",
  };

  function doubleStruck(text) {
    return String(text).replace(/[A-Z1]/g, function (ch) {
      return DOUBLE_STRUCK[ch] || ch;
    });
  }

  // ------------------------------------------------------ DOM 处理
  var SKIP_TAGS = { PRE: 1, SCRIPT: 1, STYLE: 1, SVG: 1, TEXTAREA: 1, NOSCRIPT: 1, MATH: 1 };
  var SKIP_CLASS = { "m-math": 1, "ml-src": 1 };

  function shouldSkip(element) {
    if (!element || element.nodeType !== 1) return false;
    if (SKIP_TAGS[element.tagName]) return true;
    if (element.classList) {
      for (var key in SKIP_CLASS) {
        if (element.classList.contains(key)) return true;
      }
    }
    return false;
  }

  function collectTextNodes(root) {
    var nodes = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !/[_^$]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        var parent = node.parentNode;
        while (parent && parent !== root) {
          if (shouldSkip(parent)) return NodeFilter.FILTER_REJECT;
          parent = parent.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  var pass = 0;

  function renderIn(root) {
    var scope = root && root.nodeType === 1 ? root : document.body;
    if (!scope) return 0;
    var nodes = collectTextNodes(scope);
    var count = 0;
    nodes.forEach(function (node) {
      var html = transform(node.nodeValue);
      if (html === esc(node.nodeValue)) return;
      var holder = document.createElement("span");
      holder.innerHTML = html;
      var fragment = document.createDocumentFragment();
      while (holder.firstChild) fragment.appendChild(holder.firstChild);
      node.parentNode.replaceChild(fragment, node);
      count += 1;
    });
    pass += 1;
    return count;
  }

  var api = {
    renderIn: renderIn,
    autoText: autoText,
    tex: tex,
    transform: transform,
    atomsToSvg: atomsToSvg,
    _config: { BASE_STRICT: BASE_STRICT, BASE_SOFT: BASE_SOFT, SHORT_SUBS: SHORT_SUBS, SUB_BLACKLIST: SUB_BLACKLIST },
  };

  if (global) global.MathLite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    var run = function () {
      renderIn(document.body);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
    else run();
    // app.js / detail.js 可能在 load 之后才追加内容（目录、术语表、搜索结果），
    // 这里再补一次；渲染是幂等的，重复执行不会把已经生成的标签再处理一遍。
    window.addEventListener("load", function () {
      run();
      window.setTimeout(run, 120);
    });
  }
})(typeof window !== "undefined" ? window : null);
