/* ===========================================================================
   mermaid-lite.js —— 站点内置的轻量 mermaid 子集渲染器
   ---------------------------------------------------------------------------
   用途：把页面里 <pre class="mermaid-lite">…</pre> 中的 flowchart 文本渲染成
   自绘 SVG 网络图（分层布局、节点、连线、箭头、边标签），不依赖任何外部库，
   因此在完全离线、file:// 打开的情况下也能正常显示。

   支持的 mermaid 子集：
     flowchart TD | TB | BT | LR | RL      （默认 TD，自上而下）
     graph TD                              （等价写法）
     A[文本]       矩形节点
     A(文本)       圆角节点
     A((文本))     胶囊 / 圆形节点
     A{文本}       菱形节点（判断 / 运算）
     A[[文本]]     子程序（双边框）节点
     A:::tone      颜色分组（tone: in / cond / latent / core / attn / norm / out / op / warn）
     A --> B       实线箭头
     A -.-> B      虚线箭头
     A --- B       实线无箭头
     A ==> B       粗箭头
     A -->|标签| B 带标签的箭头
     A -- 标签 --> B  等价写法（会被归一化为 A -->|标签| B）
     A --> B --> C 链式写法
     %% 注释 / subgraph…end / classDef / style   （解析时忽略，不影响节点与连线）

   公共 API：
     window.MermaidLite.render(preEl)   渲染单个 <pre class="mermaid-lite">
     window.MermaidLite.renderAll(root) 渲染 root（默认 document）内的全部图
     window.MermaidLite._parse(src)     仅解析，返回图数据（便于测试）
     window.MermaidLite._layout(graph)  仅布局，返回带坐标的图数据
     window.MermaidLite._svg(graph)     由图数据生成 SVG 字符串
   =========================================================================== */
(function (global) {
  "use strict";

  var PAD = 18;
  var GAP_MAIN = 46; // 层与层之间的间距（要容得下边标签）
  var GAP_CROSS = 28; // 同层节点之间的间距
  var FONT = 12;
  var LINE_H = 16;
  var uid = 0;

  // ------------------------------------------------------------------ 工具
  function escXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function splitLines(text) {
    return String(text == null ? "" : text)
      .replace(/<br\s*\/?>/gi, "\n")
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line, index, all) {
        return line.length > 0 || all.length === 1;
      });
  }

  // 粗略的字宽估算：中日韩字符按 11.6px，其余按 6.8px。
  function textWidth(line) {
    var width = 0;
    for (var i = 0; i < line.length; i++) {
      width += line.charCodeAt(i) > 0x2e80 ? 11.6 : 6.8;
    }
    return width;
  }

  function round(value) {
    return Math.round(value * 10) / 10;
  }

  // ------------------------------------------------------------------ 解析
  var NODE_HEAD = /^\s*([A-Za-z0-9_][A-Za-z0-9_.-]*)/;
  // 带引号的写法优先匹配，这样标签里可以安全地出现 [ ] ( ) { } 等形状符号。
  var NODE_SHAPE =
    /^(\(\([\s\S]*?\)\)|\[\[[\s\S]*?\]\]|\["[^"]*"\]|\[[\s\S]*?\]|\("[^"]*"\)|\([\s\S]*?\)|\{"[^"]*"\}|\{[\s\S]*?\}|>[\s\S]*?\])/;
  var TONE_RE = /^\s*:::([A-Za-z0-9_-]+)/;
  var EDGE_RE =
    /^\s*(-\.->|-->|--->|---|==>|===|--\s*[^->|\s][^|]*?\s*-->)\s*(?:\|([^|]*)\|)?\s*/;
  var SKIP_RE =
    /^(subgraph|end|classDef|class|style|linkStyle|click|direction|accTitle|accDescr|%%)\b/i;

  function parseShapeToken(token) {
    var text = token;
    var shape = "rect";
    if (/^\(\([\s\S]*\)\)$/.test(token)) {
      shape = "pill";
      text = token.slice(2, -2);
    } else if (/^\[\[[\s\S]*\]\]$/.test(token)) {
      shape = "subroutine";
      text = token.slice(2, -2);
    } else if (/^\[[\s\S]*\]$/.test(token)) {
      shape = "rect";
      text = token.slice(1, -1);
    } else if (/^\([\s\S]*\)$/.test(token)) {
      shape = "round";
      text = token.slice(1, -1);
    } else if (/^\{[\s\S]*\}$/.test(token)) {
      shape = "diamond";
      text = token.slice(1, -1);
    } else if (/^>[\s\S]*\]$/.test(token)) {
      shape = "asym";
      text = token.slice(1, -1);
    }
    text = text.replace(/^["']/, "").replace(/["']$/, "").trim();
    return { text: text, shape: shape };
  }

  function parse(src) {
    var graph = { dir: "TD", nodes: [], edges: [], index: {} };
    var lines = String(src == null ? "" : src).split(/\r?\n/);

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line || line.indexOf("%%") === 0) return;
      var header = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)?\s*$/i);
      if (header) {
        graph.dir = (header[1] || "TD").toUpperCase();
        return;
      }
      if (SKIP_RE.test(line)) return;
      // 把 “A -- 标签 --> B” 归一化成 “A -->|标签| B”
      line = line.replace(/--\s*([^-|>][^|]*?)\s*-->/g, "-->|$1|");

      var pending = null;
      var guard = 0;
      while (line.trim() && guard++ < 80) {
        var head = line.match(NODE_HEAD);
        if (!head) break;
        var id = head[1];
        line = line.slice(head[0].length);

        var node = graph.index[id];
        if (!node) {
          node = { id: id, label: id, shape: "rect", tone: "" };
          graph.nodes.push(node);
          graph.index[id] = node;
        }
        var shape = line.match(NODE_SHAPE);
        if (shape) {
          var parsed = parseShapeToken(shape[1]);
          node.label = parsed.text;
          node.shape = parsed.shape;
          line = line.slice(shape[0].length);
        }
        var tone = line.match(TONE_RE);
        if (tone) {
          node.tone = tone[1];
          line = line.slice(tone[0].length);
        }

        if (pending) {
          graph.edges.push({
            from: pending.from,
            to: id,
            label: pending.label,
            dashed: pending.dashed,
            thick: pending.thick,
            arrow: pending.arrow,
          });
        }

        var edge = line.match(EDGE_RE);
        pending = null;
        if (edge) {
          var op = edge[1];
          pending = {
            from: id,
            label: (edge[2] || "").trim(),
            dashed: op.indexOf(".") >= 0,
            thick: op.indexOf("=") >= 0,
            arrow: op.indexOf(">") >= 0,
          };
          line = line.slice(edge[0].length);
        }
      }
    });

    return graph;
  }

  // ------------------------------------------------------------------ 布局
  function measure(graph) {
    graph.nodes.forEach(function (node) {
      node.lines = splitLines(node.label);
      var widest = 0;
      node.lines.forEach(function (line) {
        widest = Math.max(widest, textWidth(line));
      });
      node.w = Math.max(104, Math.round(widest) + 28);
      node.h = Math.max(40, node.lines.length * LINE_H + 20);
    });
    return graph;
  }

  function assignLayers(graph) {
    var layer = {};
    var indeg = {};
    graph.nodes.forEach(function (node) {
      layer[node.id] = 0;
      indeg[node.id] = 0;
    });
    graph.edges.forEach(function (edge) {
      if (indeg[edge.to] !== undefined) indeg[edge.to] += 1;
    });

    var queue = graph.nodes
      .filter(function (node) {
        return indeg[node.id] === 0;
      })
      .map(function (node) {
        return node.id;
      });
    var remaining = Object.assign({}, indeg);
    var settled = 0;

    while (queue.length) {
      var current = queue.shift();
      settled += 1;
      graph.edges.forEach(function (edge) {
        if (edge.from !== current) return;
        if (layer[edge.to] < layer[current] + 1) layer[edge.to] = layer[current] + 1;
        remaining[edge.to] -= 1;
        if (remaining[edge.to] === 0) queue.push(edge.to);
      });
    }

    if (settled < graph.nodes.length) {
      // 存在环：把未结算的节点依次排在最后一层之后，保证不会重叠。
      var maxLayer = 0;
      graph.nodes.forEach(function (node) {
        maxLayer = Math.max(maxLayer, layer[node.id]);
      });
      var rest = graph.nodes.filter(function (node) {
        return remaining[node.id] > 0;
      });
      rest.forEach(function (node, index) {
        layer[node.id] = maxLayer + 1 + index;
      });
    }
    return layer;
  }

  function orderLayers(graph, layer) {
    var layers = [];
    graph.nodes.forEach(function (node) {
      var index = layer[node.id];
      if (!layers[index]) layers[index] = [];
      layers[index].push(node.id);
    });

    var position = {};
    layers.forEach(function (ids, layerIndex) {
      if (layerIndex > 0) {
        var previous = layers[layerIndex - 1] || [];
        var barycenter = {};
        ids.forEach(function (id) {
          var sum = 0;
          var count = 0;
          graph.edges.forEach(function (edge) {
            if (edge.to === id && previous.indexOf(edge.from) >= 0) {
              sum += previous.indexOf(edge.from);
              count += 1;
            }
          });
          barycenter[id] = count ? sum / count : previous.length / 2;
        });
        ids.sort(function (a, b) {
          return barycenter[a] - barycenter[b];
        });
        layers[layerIndex] = ids;
      }
      ids.forEach(function (id, index) {
        position[id] = index;
      });
    });

    return layers.filter(function (ids) {
      return ids && ids.length;
    });
  }

  function layout(graph) {
    measure(graph);
    var layer = assignLayers(graph);
    var layers = orderLayers(graph, layer);
    var horizontal = graph.dir === "LR" || graph.dir === "RL";
    var reverse = graph.dir === "BT" || graph.dir === "RL";
    var ordered = reverse ? layers.slice().reverse() : layers;
    var byId = graph.index;

    var crossSize = function (ids) {
      var total = 0;
      ids.forEach(function (id, index) {
        total += horizontal ? byId[id].h : byId[id].w;
        if (index) total += GAP_CROSS;
      });
      return total;
    };
    var mainSize = function (ids) {
      var size = 0;
      ids.forEach(function (id) {
        size = Math.max(size, horizontal ? byId[id].w : byId[id].h);
      });
      return size;
    };

    var totalCross = 0;
    ordered.forEach(function (ids, index) {
      totalCross = Math.max(totalCross, crossSize(ids));
      if (index) totalCross += 0;
    });

    // 有跳层虚线（skip）时，在“交叉轴”方向额外留出总线与边标签的位置，
    // 否则绕行的箭头和标签会跑出 viewBox 被裁掉。
    var hasSkip = graph.edges.some(function (edge) {
      return edge.dashed;
    });
    var skipMargin = hasSkip ? 190 : 0;

    var mainCursor = PAD;
    ordered.forEach(function (ids) {
      var layerMain = mainSize(ids);
      var cursor = PAD + (totalCross - crossSize(ids)) / 2 + skipMargin / 2;
      ids.forEach(function (id) {
        var node = byId[id];
        if (horizontal) {
          node.x = mainCursor + (layerMain - node.w) / 2;
          node.y = cursor;
          cursor += node.h + GAP_CROSS;
        } else {
          node.x = cursor;
          node.y = mainCursor + (layerMain - node.h) / 2;
          cursor += node.w + GAP_CROSS;
        }
      });
      mainCursor += layerMain + GAP_MAIN;
    });

    graph.width = (horizontal ? mainCursor - GAP_MAIN : totalCross + skipMargin) + PAD;
    graph.height = (horizontal ? totalCross + skipMargin : mainCursor - GAP_MAIN) + PAD;
    graph.horizontal = horizontal;
    graph.byId = byId;
    return graph;
  }

  // ------------------------------------------------------------------ 绘图
  // 跳层的虚线边（skip feature）不能走贝塞尔直线：当源和目标在同一列时，
  // 曲线会完全落在节点背后而看不见。这里让它绕到右侧（LR 时绕到下方）的总线，
  // 再水平插进目标节点，既可见又不会和主干箭头混淆。
  function pathForEdge(source, target, horizontal, edge, index) {
    var skip = !!(edge && edge.dashed);
    var busOffset = 26 + (((index || 0) % 4) * 10);

    if (!horizontal) {
      var gapY = target.y - (source.y + source.h);
      if (gapY >= -1 && !(skip && gapY > 46)) {
        var sx = source.x + source.w / 2;
        var sy = source.y + source.h;
        var tx = target.x + target.w / 2;
        var ty = target.y;
        var dy = Math.max(16, (ty - sy) * 0.5);
        return {
          d:
            "M " + round(sx) + " " + round(sy) +
            " C " + round(sx) + " " + round(sy + dy) +
            " " + round(tx) + " " + round(ty - dy) +
            " " + round(tx) + " " + round(ty),
          lx: (sx + tx) / 2,
          ly: (sy + ty) / 2,
        };
      }
      var busX = Math.max(source.x + source.w, target.x + target.w) + busOffset;
      var sy2 = source.y + source.h / 2;
      var ty2 = target.y + target.h / 2;
      return {
        d:
          "M " + round(source.x + source.w) + " " + round(sy2) +
          " L " + round(busX) + " " + round(sy2) +
          " L " + round(busX) + " " + round(ty2) +
          " L " + round(target.x + target.w) + " " + round(ty2),
        // 标签贴着「从源节点出发的那一段」放，不同 skip 的起点不同，标签就不会互相压住。
        lx: (source.x + source.w + busX) / 2,
        ly: sy2 - 12,
      };
    }
    var gapX = target.x - (source.x + source.w);
    if (gapX >= -1 && !(skip && gapX > 46)) {
      var sxL = source.x + source.w;
      var syL = source.y + source.h / 2;
      var txL = target.x;
      var tyL = target.y + target.h / 2;
      var dx = Math.max(16, (txL - sxL) * 0.5);
      return {
        d:
          "M " + round(sxL) + " " + round(syL) +
          " C " + round(sxL + dx) + " " + round(syL) +
          " " + round(txL - dx) + " " + round(tyL) +
          " " + round(txL) + " " + round(tyL),
        lx: (sxL + txL) / 2,
        ly: (syL + tyL) / 2,
      };
    }
    var busY = Math.max(source.y + source.h, target.y + target.h) + busOffset;
    var sxB = source.x + source.w / 2;
    var txB = target.x + target.w / 2;
    return {
      d:
        "M " + round(sxB) + " " + round(source.y + source.h) +
        " L " + round(sxB) + " " + round(busY) +
        " L " + round(txB) + " " + round(busY) +
        " L " + round(txB) + " " + round(target.y + target.h),
      lx: (sxB + txB) / 2,
      ly: busY + 2,
    };
  }

  // 节点文字：如果页面加载了 mathlite.js，就把 N_img / z_t 这类记号渲染成
  // SVG 内的真正上下标（<tspan baseline-shift>），否则退回纯文本。
  function labelText(line) {
    if (global && global.MathLite && global.MathLite.atomsToSvg) {
      return global.MathLite.atomsToSvg(line);
    }
    return escXml(line);
  }

  function nodeSvg(node) {
    var cls = "ml-node ml-shape-" + node.shape + (node.tone ? " ml-tone-" + node.tone : "");
    var body = "";
    var centerX = node.w / 2;
    var firstBaseline = node.h / 2 - ((node.lines.length - 1) * LINE_H) / 2 + 4.5;

    if (node.shape === "diamond") {
      body +=
        '<polygon class="ml-box" points="' +
        round(centerX) + ",0 " + round(node.w) + "," + round(node.h / 2) + " " +
        round(centerX) + "," + round(node.h) + " 0," + round(node.h / 2) + '"/>';
    } else if (node.shape === "subroutine") {
      body +=
        '<rect class="ml-box" x="0" y="0" width="' + node.w + '" height="' + node.h + '" rx="6"/>' +
        '<line class="ml-sub" x1="8" y1="0" x2="8" y2="' + node.h + '"/>' +
        '<line class="ml-sub" x1="' + (node.w - 8) + '" y1="0" x2="' + (node.w - 8) + '" y2="' + node.h + '"/>';
    } else {
      var radius = node.shape === "pill" ? node.h / 2 : node.shape === "round" ? 14 : node.shape === "asym" ? 4 : 7;
      body +=
        '<rect class="ml-box" x="0" y="0" width="' + node.w + '" height="' + node.h + '" rx="' + radius + '"/>';
    }

    var text = node.lines
      .map(function (line, index) {
        return (
          '<text class="ml-node-text" x="' + round(centerX) + '" y="' + round(firstBaseline + index * LINE_H) +
          '" text-anchor="middle">' + labelText(line) + "</text>"
        );
      })
      .join("");

    return (
      '<g class="' + cls + '" transform="translate(' + round(node.x) + "," + round(node.y) + ')">' +
      body + text + "</g>"
    );
  }

  function svg(graph, label) {
    var id = "ml" + ++uid;
    var solid = "ml-arrow-" + id;
    var dashed = "ml-arrow-dash-" + id;
    var width = Math.max(320, Math.ceil(graph.width + PAD));
    var height = Math.max(140, Math.ceil(graph.height + PAD));

    var defs =
      '<defs><marker id="' + solid + '" markerWidth="9" markerHeight="9" refX="7.6" refY="3.4" orient="auto">' +
      '<path d="M0,0 L8,3.4 L0,6.8 z" fill="#2f7768"/></marker>' +
      '<marker id="' + dashed + '" markerWidth="9" markerHeight="9" refX="7.6" refY="3.4" orient="auto">' +
      '<path d="M0,0 L8,3.4 L0,6.8 z" fill="#c4863f"/></marker></defs>';

    var edges = graph.edges
      .map(function (edge, edgeIndex) {
        var source = graph.byId[edge.from];
        var target = graph.byId[edge.to];
        if (!source || !target) return "";
        var geo = pathForEdge(source, target, graph.horizontal, edge, edgeIndex);
        var cls = "ml-edge" + (edge.dashed ? " ml-edge-dashed" : "") + (edge.thick ? " ml-edge-thick" : "");
        var marker = edge.arrow === false ? "" : ' marker-end="url(#' + (edge.dashed ? dashed : solid) + ')"';
        var out =
          '<path class="' + cls + '" d="' + geo.d + '" fill="none"' + marker + "/>";
        if (edge.label) {
          var labelWidth = Math.round(textWidth(edge.label)) + 12;
          var labelX = geo.lx;
          // 绕行虚线的标签别压在源节点边框上：推到节点右侧。
          if (edge.dashed && !graph.horizontal) {
            labelX = Math.max(labelX, source.x + source.w + labelWidth / 2 + 4);
          }
          out +=
            '<g class="ml-edge-label"><rect x="' + round(labelX - labelWidth / 2) + '" y="' + round(geo.ly - 9) +
            '" width="' + labelWidth + '" height="18" rx="3"/><text x="' + round(labelX) + '" y="' + round(geo.ly + 4) +
            '" text-anchor="middle">' + escXml(edge.label) + "</text></g>";
        }
        return out;
      })
      .join("");

    var nodes = graph.nodes.map(nodeSvg).join("");

    return (
      '<svg class="ml-svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + " " + height +
      '" role="img" aria-label="' +
      escXml(label || "mermaid 网络图") + '" preserveAspectRatio="xMinYMin meet">' +
      defs + '<g class="ml-edges">' + edges + "</g>" + '<g class="ml-nodes">' + nodes + "</g></svg>"
    );
  }

  function build(source, label) {
    var graph = parse(source);
    if (!graph.nodes.length) throw new Error("mermaid-lite: 没有解析到任何节点");
    layout(graph);
    return { graph: graph, svg: svg(graph, label) };
  }

  // ------------------------------------------------------------------ 渲染
  // <pre> 里如果直接写了 <br/>，浏览器会把它解析成真正的元素，textContent 会丢掉它；
  // 因此先把 <br> 还原成字面量 "<br/>"（mermaid 语句本身仍保持单行），
  // 再由 splitLines 在节点内部换行。写成 &lt;br/&gt; 的情况同样兼容。
  function readSource(element) {
    var clone = element.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll("br"), function (br) {
      br.parentNode.replaceChild(document.createTextNode("<br/>"), br);
    });
    return clone.textContent || "";
  }

  function render(element) {
    if (!element || element.getAttribute("data-ml-done") === "1") return null;
    var source = readSource(element);
    var label = element.getAttribute("data-ml-label") || "mermaid 网络图";
    var result;
    try {
      result = build(source, label);
    } catch (error) {
      element.setAttribute("data-ml-error", String(error && error.message ? error.message : error));
      return null;
    }
    var host = document.createElement("div");
    host.className = "ml-wrap";
    host.innerHTML =
      '<div class="ml-graph">' + result.svg + "</div>" +
      '<details class="ml-src"><summary>mermaid 源码（可复制到 mermaid 编辑器渲染）</summary><pre></pre></details>';
    host.querySelector("pre").textContent = source.replace(/^\s+|\s+$/g, "");
    element.setAttribute("data-ml-done", "1");
    element.parentNode.replaceChild(host, element);
    // 虚线框里还有图例和说明时，把“mermaid 源码”折叠块移到框的最后，避免打断正文。
    var frame = host.parentNode;
    if (frame && frame.classList && frame.classList.contains("gn-frame")) {
      frame.appendChild(host.querySelector(".ml-src"));
    }
    return result.svg;
  }

  function renderAll(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var targets = scope.querySelectorAll("pre.mermaid-lite:not([data-ml-done])");
    var count = 0;
    Array.prototype.forEach.call(targets, function (element) {
      if (render(element)) count += 1;
    });
    return count;
  }

  var api = {
    render: render,
    renderAll: renderAll,
    _parse: parse,
    _layout: function (graph) {
      return layout(graph);
    },
    _svg: svg,
    _build: build,
  };

  if (global) global.MermaidLite = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        renderAll(document);
      });
    } else {
      renderAll(document);
    }
  }
})(typeof window !== "undefined" ? window : null);
