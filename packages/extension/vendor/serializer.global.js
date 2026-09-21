"use strict";
var H2DSerializer = (() => {
  // ../ir/src/version.ts
  var IR_VERSION = 2;

  // src/diagnostics.ts
  var DiagnosticSink = class {
    constructor(screenId) {
      this.screenId = screenId;
    }
    screenId;
    items = [];
    seen = /* @__PURE__ */ new Set();
    /** `needsPlaceholder` обязателен намеренно: значение по умолчанию
     *  приглашает забыть, а забытая заглушка означает, что неподдерживаемая
     *  фича приедет в Figma обычной пустой коробкой. Пусть каждый вызов
     *  решает явно.
     *
     *  Семантика — только ЗАМЕНА: `true` означает, что узел по `nodeId`
     *  обязан быть `kind: 'placeholder'`. Коды, которые лишь помечают узел
     *  с реальным содержимым, передают `false`. */
    report(level, code, message, nodeId, needsPlaceholder) {
      const key = `${code}|${nodeId ?? "<null>"}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      this.items.push({
        level,
        code,
        message,
        nodeId,
        screenId: this.screenId,
        needsPlaceholder
      });
    }
    /** Отдаёт копию: вызывающий не должен иметь возможности испортить
     *  накопленное, и читать отчёт можно многократно. */
    drain() {
      return [...this.items];
    }
  };

  // ../ir/src/codes.ts
  var DIAGNOSTIC_CODES = {
    unsupportedCanvas: "unsupported.canvas",
    /** `<video>` и его `poster`. Кадр видео — не изображение страницы,
     *  и переносить его как картинку значило бы выдать один момент
     *  времени за содержимое.
     *
     *  Код заведён поздно и закрывает долг, записанный ещё в плане 4:
     *  до него `<video>` приезжал обычным пустым фреймом БЕЗ единой
     *  записи в отчёте — последняя молчаливая потеря в проекте. */
    unsupportedVideo: "unsupported.video",
    unsupportedCrossOriginIframe: "unsupported.cross-origin-iframe",
    unsupportedClosedShadowRoot: "unsupported.closed-shadow-root",
    unsupportedClipPath: "unsupported.clip-path",
    unsupportedFilter: "unsupported.filter",
    unsupportedTransform3d: "unsupported.transform-3d",
    unsupportedRepeatingGradient: "unsupported.repeating-gradient",
    /** Признано в плане 1, реализуется в плане 2. Пока обязано
     *  порождать диагностику, а не тихо исчезать. */
    deferredGradient: "deferred.gradient",
    deferredTransform: "deferred.transform",
    deferredBlur: "deferred.blur",
    deferredBlend: "deferred.blend",
    deferredVector: "deferred.vector",
    deferredPseudoElement: "deferred.pseudo-element",
    /** Байты изображения недоступны: CORS, отравленная канва, сетевой
     *  отказ или битый источник. Узел обязан стать заглушкой, а не
     *  пустым фреймом. До плана 4 `<img>` молча приезжал пустым фреймом
     *  без единой записи в отчёте — 27628 расходящихся пикселей из
     *  320000 на зонде, невидимых и для валидатора, и для pixel-diff,
     *  потому что ни одна фикстура изображений не содержала. */
    imageUnreadable: "fidelity.image-unreadable",
    /** Изображение ужато: `figma.createImage` ограничен 4096px по стороне.
     *  Ужатие необратимо, поэтому факт обязан быть в отчёте. */
    imageRescaled: "fidelity.image-rescaled",
    /** Формат переупакован в PNG: Figma принимает PNG/JPG/GIF, а страница
     *  могла отдать WebP или AVIF. Переупаковка меняет байты и может
     *  менять качество — молчать нельзя. */
    imageRecoded: "fidelity.image-recoded",
    /** `mask-image` или `border-image`. Figma выражает маску иначе, чем
     *  CSS, и перенос без способа сверить результат был бы догадкой. */
    deferredMask: "deferred.mask",
    /** Несколько слоёв `background-image` в одном объявлении. Контракт их
     *  представляет (`fills` — список), но порядок и смешение слоёв не
     *  измерены, поэтому перенесён только случай одного слоя. */
    deferredMultiLayerBackground: "deferred.multi-layer-background",
    /** `repeat-x`, `repeat-y`, `round`, `space`: повтор по одной оси или
     *  с подгонкой шага. Контракт держит один режим на обе оси и этого не
     *  выражает. Выдать за обычную плитку нельзя — залило бы весь бокс
     *  вместо одной полосы. */
    deferredRepeatMode: "deferred.repeat-mode",
    colorUnparsed: "fidelity.color-unparsed",
    /** Текст есть, но ни одного бокса строки не получено. Отдельный код
     *  нужен потому, что молчаливая потеря текста невидима и для
     *  валидатора, и для pixel-diff: оба сравнивают то, что доехало. */
    textLost: "fidelity.text-lost",
    /** Фон страницы задан на `<html>`, а обход начинается с `<body>`.
     *  Заливка перенесена на корневой узел. Молчать нельзя: без
     *  переноса тёмная страница приезжала бы на белом фоне, и ни
     *  валидатор, ни pixel-diff этого не увидели бы — обход просто
     *  не дошёл бы до элемента, где фон объявлен. */
    pageBackgroundMoved: "fidelity.page-background-moved",
    colorClamped: "fidelity.color-clamped",
    fontFallback: "fidelity.font-fallback",
    gridFlattened: "fidelity.grid-flattened",
    ellipticalCorner: "fidelity.elliptical-corner",
    mixedBorderColors: "fidelity.mixed-border-colors",
    strokeStyleFlattened: "fidelity.stroke-style-flattened",
    stickyFlattened: "fidelity.sticky-flattened",
    paintOrderInterleaved: "fidelity.paint-order-interleaved",
    /** Порядок отрисовки приближён: позиционированный узел с
     *  `z-index: auto` контекста не создаёт, и его z-индексированные
     *  потомки должны подниматься к предку-контексту, а резолвер
     *  считает такой узел атомарным. Сознательное упрощение, но
     *  молчать о нём нельзя: порядок может отличаться от браузерного. */
    paintOrderApproximated: "fidelity.paint-order-approximated",
    /** ИСПРАВЛЕНО в плане 3 (`rect` в координатах родителя, вложенные
     *  группы в референс-рендерере) и с этого момента не порождается.
     *  Код сохранён — не удалён — потому что коды диагностик стабильны:
     *  бандл прошлой редакции IR (версия 1) мог нести этот код, и
     *  читающая сторона обязана уметь его распознать при работе со
     *  старыми бандлами.
     *
     *  Раньше: узел лежал внутри трансформированного предка. Сам предок
     *  переносился верно, а вот потомок — нет: его `rect` снимался как
     *  осепараллельный габарит УЖЕ повёрнутого элемента, потому что
     *  `getBoundingClientRect()` включает трансформы предков.
     *
     *  Код появился как исправление честности, а не геометрии. Пока
     *  трансформы были отложены, родитель нёс `deferred.transform`, и
     *  инвариант заставлял бандл объяснить, что поддерево не
     *  перенесено. Когда родитель стал переноситься верно, объяснение
     *  исчезло, а неверность потомков осталась — то есть улучшение
     *  корректности породило молчаливую потерю. */
    transformDescendant: "fidelity.transform-descendant",
    /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
     *  что и `transformDescendant`.
     *
     *  Раньше: узел с режимом наложения лежал внутри ИЗОЛИРУЮЩЕЙ группы.
     *
     *  В CSS наложение композитит с подложкой в пределах ближайшей
     *  изолирующей группы, а референс-рендерер плющил дерево в плоский
     *  список и границ изоляции не имел вовсе — он смешивал со всем,
     *  что нарисовано раньше. Измерено на зонде: элемент с
     *  `mix-blend-mode: multiply` внутри `isolation: isolate` в браузере
     *  оставался своим цветом, а у нас чернел.
     *
     *  Как и `transformDescendant`, код появился из-за того, что
     *  реализация фичи сняла общую диагностику `deferred.blend`,
     *  прикрывавшую заодно и этот случай. */
    blendIsolation: "fidelity.blend-isolation",
    /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
     *  что и `transformDescendant`.
     *
     *  Раньше: узел лежал внутри размытого предка. `filter: blur()` в
     *  CSS размывает элемент ВМЕСТЕ с поддеревом, а плоский рендерер
     *  вешал фильтр только на сам узел, и потомки оставались резкими.
     *  Измерено зондом: 2362 расходящихся пикселя.
     *
     *  Остаточный случай, который код НЕ покрывает и для которого
     *  диагностика осталась активной: потомок предка с НЕподдерживаемой
     *  трансформой (`skew`, 3D) — она не входит в накопленную матрицу
     *  предков, поэтому `rect` такого потомка снимается от уже искажённого
     *  бокса. См. `fidelity.transform-descendant`-подобный случай,
     *  фикстуру `broken-transform` (вне гейта) и [[group-effects]] в вики. */
    blurDescendant: "fidelity.blur-descendant",
    /** ИСПРАВЛЕНО в плане 3. Не порождается; сохранён по той же причине,
     *  что и `transformDescendant`.
     *
     *  Раньше: узел лежал внутри полупрозрачного предка. `opacity < 1`
     *  применялась к группе целиком: браузер сначала рисовал поддерево,
     *  затем композитил его как единое целое. Плоский рендерер применял
     *  прозрачность к каждому узлу отдельно, из-за чего перекрывающиеся
     *  потомки просвечивали друг через друга. Измерено зондом: 6000
     *  расходящихся пикселей при пустом отчёте. Дефект молчал с плана 1:
     *  в фикстуре boxes у полупрозрачного блока нет детей. */
    opacityGroup: "fidelity.opacity-group"
  };
  var ALL_DIAGNOSTIC_CODES = Object.values(DIAGNOSTIC_CODES);

  // src/css/color.ts
  var TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };
  var RGB_FUNCTIONAL = /^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i;
  var parseAlpha = (raw) => {
    if (raw === void 0) return 1;
    if (raw.endsWith("%")) return Number.parseFloat(raw) / 100;
    return Number.parseFloat(raw);
  };
  var resolveViaCanvas = (value) => {
    if (typeof OffscreenCanvas === "undefined") return null;
    try {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d");
      if (ctx === null) return null;
      const probe = (sentinel) => {
        ctx.fillStyle = sentinel;
        ctx.fillStyle = value;
        return String(ctx.fillStyle);
      };
      if (probe("#ff00ff") !== probe("#00ff00")) return null;
      ctx.fillStyle = value;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      const r = data[0];
      const g = data[1];
      const b = data[2];
      const a = data[3];
      if (r === void 0 || g === void 0 || b === void 0 || a === void 0) {
        return null;
      }
      return { r, g, b, a: Math.round(a / 255 * 1e3) / 1e3 };
    } catch {
      return null;
    }
  };
  var parseColor = (value) => {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "none") return null;
    if (trimmed === "transparent") return TRANSPARENT;
    const m = RGB_FUNCTIONAL.exec(trimmed);
    if (m?.[1] !== void 0 && m[2] !== void 0 && m[3] !== void 0) {
      return {
        r: Number.parseFloat(m[1]),
        g: Number.parseFloat(m[2]),
        b: Number.parseFloat(m[3]),
        a: parseAlpha(m[4])
      };
    }
    return resolveViaCanvas(trimmed);
  };
  var isInvisible = (color) => color.a === 0;

  // src/css/length.ts
  var parsePx = (value) => {
    const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
    if (match?.[1] === void 0) return 0;
    return Number.parseFloat(match[1]);
  };

  // src/css/corner.ts
  var firstRadius = (value) => {
    const first = value.trim().split(/\s+/)[0];
    return first === void 0 ? 0 : parsePx(first);
  };
  var readCorner = (cs) => ({
    tl: firstRadius(cs.borderTopLeftRadius),
    tr: firstRadius(cs.borderTopRightRadius),
    br: firstRadius(cs.borderBottomRightRadius),
    bl: firstRadius(cs.borderBottomLeftRadius)
  });
  var isEllipticalCorner = (cs) => [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius
  ].some((value) => value.trim().split(/\s+/).length > 1);

  // src/css/data-url.ts
  var decodeBase64Prefix = (payload, bytesNeeded) => {
    const charsNeeded = Math.ceil(bytesNeeded / 3) * 4;
    const slice = payload.slice(0, charsNeeded);
    if (slice.length < charsNeeded) return null;
    try {
      const binary = atob(slice);
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
      return out.length >= bytesNeeded ? out : null;
    } catch {
      return null;
    }
  };
  var be32 = (bytes, at) => ((bytes[at] ?? 0) << 24 | (bytes[at + 1] ?? 0) << 16 | (bytes[at + 2] ?? 0) << 8 | (bytes[at + 3] ?? 0)) >>> 0;
  var le16 = (bytes, at) => (bytes[at] ?? 0) | (bytes[at + 1] ?? 0) << 8;
  var sizeFromDataUrl = (url) => {
    if (!url.startsWith("data:")) return null;
    const comma = url.indexOf(",");
    if (comma === -1) return null;
    const header = url.slice(5, comma);
    if (!header.includes("base64")) return null;
    const payload = url.slice(comma + 1);
    if (header.startsWith("image/png")) {
      const bytes = decodeBase64Prefix(payload, 24);
      if (bytes === null) return null;
      const w = be32(bytes, 16);
      const h = be32(bytes, 20);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    if (header.startsWith("image/gif")) {
      const bytes = decodeBase64Prefix(payload, 10);
      if (bytes === null) return null;
      const w = le16(bytes, 6);
      const h = le16(bytes, 8);
      return w > 0 && h > 0 ? { w, h } : null;
    }
    if (header.startsWith("image/jpeg") || header.startsWith("image/jpg")) {
      const bytes = decodeBase64Prefix(payload, 1024);
      if (bytes === null) return null;
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 255) {
          at += 1;
          continue;
        }
        const marker = bytes[at + 1] ?? 0;
        if (marker >= 192 && marker <= 207 && marker !== 196 && marker !== 200 && marker !== 204) {
          const h = (bytes[at + 5] ?? 0) << 8 | (bytes[at + 6] ?? 0);
          const w = (bytes[at + 7] ?? 0) << 8 | (bytes[at + 8] ?? 0);
          return w > 0 && h > 0 ? { w, h } : null;
        }
        at += 2 + ((bytes[at + 2] ?? 0) << 8 | (bytes[at + 3] ?? 0));
      }
      return null;
    }
    return null;
  };

  // src/css/gradient.ts
  var splitTopLevel = (value) => {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim() !== "") parts.push(current);
    return parts;
  };
  var SIDE_ANGLES = {
    top: 0,
    right: 90,
    bottom: 180,
    left: 270
  };
  var cornerAngle = (box) => Math.atan2(box.h, box.w) * 180 / Math.PI;
  var directionAngle = (raw, box) => {
    const text = raw.trim().toLowerCase();
    const deg = /^(-?[\d.]+)deg$/.exec(text);
    if (deg?.[1] !== void 0) return Number.parseFloat(deg[1]);
    const turn = /^(-?[\d.]+)turn$/.exec(text);
    if (turn?.[1] !== void 0) return Number.parseFloat(turn[1]) * 360;
    const rad = /^(-?[\d.]+)rad$/.exec(text);
    if (rad?.[1] !== void 0) return Number.parseFloat(rad[1]) * 180 / Math.PI;
    if (!text.startsWith("to ")) return null;
    const sides = text.slice(3).trim().split(/\s+/).sort().join(" ");
    const corner = cornerAngle(box);
    switch (sides) {
      case "top":
        return SIDE_ANGLES["top"] ?? 0;
      case "right":
        return SIDE_ANGLES["right"] ?? 90;
      case "bottom":
        return SIDE_ANGLES["bottom"] ?? 180;
      case "left":
        return SIDE_ANGLES["left"] ?? 270;
      case "right top":
        return corner;
      case "bottom right":
        return 180 - corner;
      case "bottom left":
        return 180 + corner;
      case "left top":
        return 360 - corner;
      default:
        return null;
    }
  };
  var endpoints = (angleDeg, box) => {
    const rad = angleDeg * Math.PI / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);
    const length = Math.abs(box.w * dx) + Math.abs(box.h * dy);
    const cx = box.w / 2;
    const cy = box.h / 2;
    const half = length / 2;
    const norm = (value) => Math.round(value * 1e6) / 1e6 + 0;
    return {
      from: { x: norm((cx - dx * half) / box.w), y: norm((cy - dy * half) / box.h) },
      to: { x: norm((cx + dx * half) / box.w), y: norm((cy + dy * half) / box.h) },
      length
    };
  };
  var splitStop = (raw) => {
    const text = raw.trim();
    const functional = /^(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i;
    const fn = functional.exec(text);
    if (fn !== null) {
      return { color: fn[0], position: text.slice(fn[0].length).trim() };
    }
    const space = text.indexOf(" ");
    if (space === -1) return { color: text, position: "" };
    return { color: text.slice(0, space), position: text.slice(space + 1).trim() };
  };
  var parsePosition = (text, length) => {
    if (text === "") return null;
    const pct = /^(-?[\d.]+)%$/.exec(text);
    if (pct?.[1] !== void 0) return Number.parseFloat(pct[1]) / 100;
    const px = /^(-?[\d.]+)px$/.exec(text);
    if (px?.[1] !== void 0) return Number.parseFloat(px[1]) / length;
    return null;
  };
  var resolveOffsets = (raws) => {
    const offsets = raws.map((stop) => stop.offset);
    if (offsets[0] === null) offsets[0] = 0;
    const last = offsets.length - 1;
    if (offsets[last] === null) offsets[last] = 1;
    let index = 0;
    while (index < offsets.length) {
      if (offsets[index] !== null) {
        index += 1;
        continue;
      }
      let end = index;
      while (end < offsets.length && offsets[end] === null) end += 1;
      const before = offsets[index - 1] ?? 0;
      const after = offsets[end] ?? 1;
      const gapCount = end - index + 1;
      for (let step = 0; step < end - index; step += 1) {
        offsets[index + step] = before + (after - before) * (step + 1) / gapCount;
      }
      index = end;
    }
    const result = [];
    let previous = 0;
    for (let i = 0; i < raws.length; i += 1) {
      const stop = raws[i];
      const offset = offsets[i];
      if (stop === void 0 || offset === null || offset === void 0) continue;
      const clamped = Math.min(1, Math.max(previous, Math.max(0, offset)));
      previous = clamped;
      result.push({ offset: Math.round(clamped * 1e4) / 1e4, color: stop.color });
    }
    return result;
  };
  var parseLinearGradient = (value, box) => {
    const text = value.trim();
    if (!/^linear-gradient\(/i.test(text)) return null;
    if (box.w <= 0 || box.h <= 0) return null;
    const inner = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    const args = splitTopLevel(inner);
    if (args.length === 0) return null;
    const firstArg = args[0];
    if (firstArg === void 0) return null;
    let angle = 180;
    let stopArgs = args;
    const asDirection = directionAngle(firstArg, box);
    if (asDirection !== null) {
      angle = asDirection;
      stopArgs = args.slice(1);
    }
    if (stopArgs.length < 2) return null;
    const geometry = endpoints(angle, box);
    if (geometry.length <= 0) return null;
    const raws = [];
    for (const arg of stopArgs) {
      const { color: colorText, position } = splitStop(arg);
      const color = parseColor(colorText);
      if (color === null) return null;
      raws.push({ color, offset: parsePosition(position, geometry.length) });
    }
    return {
      kind: "linear",
      from: geometry.from,
      to: geometry.to,
      stops: resolveOffsets(raws)
    };
  };

  // src/css/image.ts
  var splitLayers = (value) => {
    const layers = [];
    let depth = 0;
    let start = 0;
    let quote = null;
    for (let i = 0; i < value.length; i += 1) {
      const ch = value[i];
      if (quote !== null) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      else if (ch === "," && depth === 0) {
        layers.push(value.slice(start, i).trim());
        start = i + 1;
      }
    }
    layers.push(value.slice(start).trim());
    return layers.filter((layer) => layer.length > 0);
  };
  var URL_PATTERN = /^url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)$/;
  var parseUrlToken = (layer) => {
    const match = URL_PATTERN.exec(layer);
    if (match === null) return null;
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    return raw.length > 0 ? raw : null;
  };
  var looksLikeSvg = (url) => {
    const path = url.split("?")[0]?.split("#")[0] ?? "";
    return path.toLowerCase().endsWith(".svg");
  };
  var classifyBackgroundImage = (value) => {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "none") return { kind: "none" };
    const layers = splitLayers(trimmed);
    if (layers.length > 1) {
      return {
        kind: "multi-layer",
        code: DIAGNOSTIC_CODES.deferredMultiLayerBackground
      };
    }
    const layer = layers[0] ?? "";
    const url = parseUrlToken(layer);
    if (url !== null) {
      return looksLikeSvg(url) ? { kind: "vector", code: DIAGNOSTIC_CODES.deferredVector } : { kind: "raster", url };
    }
    if (layer.includes("gradient(")) return { kind: "gradient" };
    return { kind: "unknown", raw: layer };
  };
  var parsePositionPart = (part, free) => {
    const percent = /^(-?[\d.]+)%$/.exec(part);
    if (percent !== null) {
      const value = Number.parseFloat(percent[1] ?? "");
      return Number.isNaN(value) ? null : free * value / 100;
    }
    const px = /^(-?[\d.]+)px$/.exec(part);
    if (px !== null) {
      const value = Number.parseFloat(px[1] ?? "");
      return Number.isNaN(value) ? null : value;
    }
    return null;
  };
  var scaleFor = (fit, box, natural) => {
    const byWidth = box.w / natural.w;
    const byHeight = box.h / natural.h;
    switch (fit) {
      case "contain": {
        const s = Math.min(byWidth, byHeight);
        return { x: s, y: s };
      }
      case "cover": {
        const s = Math.max(byWidth, byHeight);
        return { x: s, y: s };
      }
      case "none":
        return { x: 1, y: 1 };
      case "scale-down": {
        const s = Math.min(1, Math.min(byWidth, byHeight));
        return { x: s, y: s };
      }
      /** `fill` — начальное значение CSS, сюда же попадает нераспознанное:
       *  это совпадает с тем, как повёл бы себя браузер с неизвестным
       *  ключевым словом. */
      default:
        return { x: byWidth, y: byHeight };
    }
  };
  var modeFor = (fit) => {
    switch (fit) {
      case "cover":
        return "fill";
      case "contain":
        return "fit";
      default:
        return "crop";
    }
  };
  var placementFor = (fit, position, box, natural) => {
    const scale = scaleFor(fit, box, natural);
    const freeX = box.w - natural.w * scale.x;
    const freeY = box.h - natural.h * scale.y;
    const parts = position.trim().split(/\s+/);
    const rawX = parts[0] ?? "";
    const rawY = parts[1] ?? parts[0] ?? "";
    return {
      mode: modeFor(fit),
      offsetX: parsePositionPart(rawX, freeX) ?? freeX / 2,
      offsetY: parsePositionPart(rawY, freeY) ?? freeY / 2,
      scaleX: scale.x,
      scaleY: scale.y
    };
  };
  var parseSizePart = (part, side) => {
    if (part === "auto") return "auto";
    const percent = /^(-?[\d.]+)%$/.exec(part);
    if (percent !== null) {
      const value = Number.parseFloat(percent[1] ?? "");
      return Number.isNaN(value) ? "auto" : side * value / 100;
    }
    const px = /^(-?[\d.]+)px$/.exec(part);
    if (px !== null) {
      const value = Number.parseFloat(px[1] ?? "");
      return Number.isNaN(value) ? "auto" : value;
    }
    return "auto";
  };
  var backgroundScaleFor = (size, origin, natural) => {
    const trimmed = size.trim();
    if (trimmed === "cover" || trimmed === "contain") {
      return scaleFor(trimmed, { w: origin.w, h: origin.h }, natural);
    }
    const parts = trimmed.split(/\s+/);
    const rawW = parseSizePart(parts[0] ?? "auto", origin.w);
    const rawH = parseSizePart(parts[1] ?? "auto", origin.h);
    if (rawW === "auto" && rawH === "auto") return { x: 1, y: 1 };
    if (rawH !== "auto" && rawW === "auto") {
      const s = rawH / natural.h;
      return { x: s, y: s };
    }
    if (rawW !== "auto" && rawH === "auto") {
      const s = rawW / natural.w;
      return { x: s, y: s };
    }
    if (rawW === "auto" || rawH === "auto") return { x: 1, y: 1 };
    return { x: rawW / natural.w, y: rawH / natural.h };
  };
  var repeatVerdict = (repeat) => {
    const value = repeat.trim();
    if (value === "repeat") return { tile: true, partial: false };
    if (value === "no-repeat") return { tile: false, partial: false };
    return { tile: false, partial: true };
  };
  var backgroundPlacementFor = (size, position, repeat, origin, natural) => {
    const scale = backgroundScaleFor(size, origin, natural);
    const freeX = origin.w - natural.w * scale.x;
    const freeY = origin.h - natural.h * scale.y;
    const parts = position.trim().split(/\s+/);
    const rawX = parts[0] ?? "";
    const rawY = parts[1] ?? parts[0] ?? "";
    const { tile } = repeatVerdict(repeat);
    const trimmedSize = size.trim();
    const mode = tile ? "tile" : trimmedSize === "cover" ? "fill" : trimmedSize === "contain" ? "fit" : "crop";
    return {
      mode,
      /** Сдвиг начала отсчёта прибавляется в конце: всё выше считалось
       *  ВНУТРИ бокса начала отсчёта, а наружу отдаются координаты узла. */
      offsetX: origin.x + (parsePositionPart(rawX, freeX) ?? freeX / 2),
      offsetY: origin.y + (parsePositionPart(rawY, freeY) ?? freeY / 2),
      scaleX: scale.x,
      scaleY: scale.y
    };
  };

  // src/css/stroke.ts
  var SIDES = ["Top", "Right", "Bottom", "Left"];
  var widthOf = (cs, side) => {
    const style = cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
    if (style === "none" || style === "hidden") return 0;
    return parsePx(cs.getPropertyValue(`border-${side.toLowerCase()}-width`));
  };
  var styleOf = (cs, side) => cs.getPropertyValue(`border-${side.toLowerCase()}-style`);
  var strokeStyleOf = (value) => {
    if (value === "dashed") return "dashed";
    if (value === "dotted") return "dotted";
    return "solid";
  };
  var readStroke = (cs) => {
    const weight = {
      top: widthOf(cs, "Top"),
      right: widthOf(cs, "Right"),
      bottom: widthOf(cs, "Bottom"),
      left: widthOf(cs, "Left")
    };
    if (weight.top === 0 && weight.right === 0 && weight.bottom === 0 && weight.left === 0) {
      return null;
    }
    for (const side of SIDES) {
      if (widthOf(cs, side) === 0) continue;
      const color = parseColor(cs.getPropertyValue(`border-${side.toLowerCase()}-color`));
      if (color !== null && color.a > 0) {
        return {
          color,
          weight,
          style: strokeStyleOf(styleOf(cs, side)),
          // Всегда 'inside': CSS рисует границу внутрь бокса. Значение
          // по умолчанию Figma ('CENTER') сдвинуло бы каждый элемент
          // с границей на половину толщины.
          align: "inside"
        };
      }
    }
    return null;
  };
  var hasNonSolidStroke = (cs) => SIDES.some((side) => widthOf(cs, side) > 0 && styleOf(cs, side) !== "solid");
  var hasMixedBorderColors = (cs) => {
    const visible = SIDES.filter((side) => widthOf(cs, side) > 0);
    const colors = new Set(
      visible.map((side) => cs.getPropertyValue(`border-${side.toLowerCase()}-color`))
    );
    return colors.size > 1;
  };

  // src/css/shadow.ts
  var splitTopLevel2 = (value) => {
    const parts = [];
    let depth = 0;
    let current = "";
    for (const char of value) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    if (current.trim() !== "") parts.push(current);
    return parts;
  };
  var extractColor = (input) => {
    const functional = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix|color)\([^)]*\)/i;
    const match = functional.exec(input);
    if (match !== null) {
      return {
        color: match[0],
        rest: input.slice(0, match.index) + input.slice(match.index + match[0].length)
      };
    }
    const hex = /#[0-9a-f]{3,8}\b/i.exec(input);
    if (hex !== null) {
      return {
        color: hex[0],
        rest: input.slice(0, hex.index) + input.slice(hex.index + hex[0].length)
      };
    }
    return { color: "", rest: input };
  };
  var parseOne = (raw) => {
    let input = raw.trim();
    if (input === "") return null;
    const isInset = /\binset\b/i.test(input);
    input = input.replace(/\binset\b/i, " ");
    const { color: colorText, rest } = extractColor(input);
    const color = parseColor(colorText);
    if (color === null) return null;
    const lengths = rest.trim().split(/\s+/).filter((token) => token !== "");
    const offsetXRaw = lengths[0];
    const offsetYRaw = lengths[1];
    if (offsetXRaw === void 0 || offsetYRaw === void 0) return null;
    return {
      kind: isInset ? "inner" : "outer",
      color,
      offsetX: parsePx(offsetXRaw),
      offsetY: parsePx(offsetYRaw),
      blur: lengths[2] === void 0 ? 0 : parsePx(lengths[2]),
      spread: lengths[3] === void 0 ? 0 : parsePx(lengths[3])
    };
  };
  var parseBoxShadow = (value) => {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === "none") return [];
    const shadows = [];
    for (const part of splitTopLevel2(trimmed)) {
      const shadow = parseOne(part);
      if (shadow !== null) shadows.push(shadow);
    }
    return shadows;
  };

  // src/css/transform.ts
  var parseMatrix = (value) => {
    const match = /^matrix\(([^)]+)\)$/.exec(value.trim());
    if (match?.[1] === void 0) return null;
    const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));
    if (parts.length !== 6 || parts.some((n) => Number.isNaN(n))) return null;
    const [a, b, c, d, e, f] = parts;
    return { a, b, c, d, e, f };
  };
  var hasSkew = (m) => {
    const lengthX = Math.hypot(m.a, m.b);
    const lengthY = Math.hypot(m.c, m.d);
    if (lengthX === 0 || lengthY === 0) return false;
    return Math.abs((m.a * m.c + m.b * m.d) / (lengthX * lengthY)) > 1e-6;
  };
  var decomposeMatrix = (m) => {
    const scaleX = Math.hypot(m.a, m.b);
    const determinant = m.a * m.d - m.b * m.c;
    return {
      angle: Math.atan2(m.b, m.a),
      scaleX,
      scaleY: scaleX === 0 ? 0 : determinant / scaleX,
      translateX: m.e,
      translateY: m.f
    };
  };
  var readOrigin = (cs) => {
    const parts = cs.transformOrigin.trim().split(/\s+/);
    return { x: parsePx(parts[0] ?? "0px"), y: parsePx(parts[1] ?? "0px") };
  };
  var appliesTransform = (cs) => /px$/.test(cs.width.trim()) && /px$/.test(cs.height.trim());
  var untransformedSize = (cs) => {
    const insideWidth = cs.boxSizing === "border-box";
    const extraX = parsePx(cs.paddingLeft) + parsePx(cs.paddingRight) + parsePx(cs.borderLeftWidth) + parsePx(cs.borderRightWidth);
    const extraY = parsePx(cs.paddingTop) + parsePx(cs.paddingBottom) + parsePx(cs.borderTopWidth) + parsePx(cs.borderBottomWidth);
    return {
      w: parsePx(cs.width) + (insideWidth ? 0 : extraX),
      h: parsePx(cs.height) + (insideWidth ? 0 : extraY)
    };
  };
  var IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  var multiplyMatrix = (outer, inner) => ({
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  });
  var invertMatrix = (m) => {
    const determinant = m.a * m.d - m.b * m.c;
    if (determinant === 0 || !Number.isFinite(determinant)) return null;
    return {
      a: m.d / determinant,
      b: -m.b / determinant,
      c: -m.c / determinant,
      d: m.a / determinant,
      e: (m.c * m.f - m.d * m.e) / determinant,
      f: (m.b * m.e - m.a * m.f) / determinant
    };
  };
  var applyLinear = (m, v) => ({
    x: m.a * v.x + m.c * v.y,
    y: m.b * v.x + m.d * v.y
  });
  var matrixAboutOrigin = (m, origin) => multiplyMatrix(
    multiplyMatrix(
      { a: 1, b: 0, c: 0, d: 1, e: origin.x, f: origin.y },
      m
    ),
    { a: 1, b: 0, c: 0, d: 1, e: -origin.x, f: -origin.y }
  );
  var originUnderMatrix = (el, total, size) => {
    const corners = [
      [0, 0],
      [size.w, 0],
      [size.w, size.h],
      [0, size.h]
    ];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const [cx, cy] of corners) {
      minX = Math.min(minX, total.a * cx + total.c * cy);
      minY = Math.min(minY, total.b * cx + total.d * cy);
    }
    const rect = el.getBoundingClientRect();
    return { x: rect.left - minX, y: rect.top - minY };
  };
  var localOffset = (args) => {
    const inParentAxes = applyLinear(args.ancestorInverse, {
      x: args.screenOrigin.x - args.parentOrigin.x,
      y: args.screenOrigin.y - args.parentOrigin.y
    });
    return {
      x: inParentAxes.x - args.ownMatrix.e,
      y: inParentAxes.y - args.ownMatrix.f
    };
  };

  // src/layout.ts
  var gapValue = (value) => parsePx(value);
  var ALIGN_MAP = {
    "flex-start": "start",
    start: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
    stretch: "stretch",
    baseline: "baseline"
  };
  var JUSTIFY_MAP = {
    "flex-start": "start",
    start: "start",
    normal: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
    "space-between": "space-between",
    "space-around": "space-around",
    "space-evenly": "space-evenly"
  };
  var modeOf = (cs) => {
    const display = cs.display;
    if (display === "grid" || display === "inline-grid") return "column";
    if (display !== "flex" && display !== "inline-flex") return "none";
    return cs.flexDirection.startsWith("column") ? "column" : "row";
  };
  var readLayout = (cs) => {
    const mode = modeOf(cs);
    const gap = mode === "column" ? gapValue(cs.rowGap) : gapValue(cs.columnGap);
    const alignRaw = cs.alignItems;
    const align = alignRaw === "normal" ? mode === "none" ? "start" : "stretch" : ALIGN_MAP[alignRaw] ?? "start";
    return {
      mode,
      gap,
      padding: {
        top: parsePx(cs.paddingTop),
        right: parsePx(cs.paddingRight),
        bottom: parsePx(cs.paddingBottom),
        left: parsePx(cs.paddingLeft)
      },
      align,
      justify: JUSTIFY_MAP[cs.justifyContent] ?? "start",
      wrap: cs.flexWrap.startsWith("wrap")
    };
  };
  var isReversed = (cs) => cs.flexDirection.endsWith("-reverse");

  // src/probe.ts
  var readProbe = (el, cs, parentCs) => {
    const zIndexRaw = cs.zIndex;
    const parentDisplay = parentCs === null ? "" : parentCs.display;
    return {
      id: "",
      position: cs.position,
      zIndex: zIndexRaw === "auto" ? "auto" : Number.parseInt(zIndexRaw, 10),
      opacity: Number.parseFloat(cs.opacity),
      hasTransform: cs.transform !== "none",
      hasFilter: cs.filter !== "none" || cs.backdropFilter !== "none",
      hasMixBlendMode: cs.mixBlendMode !== "normal",
      isIsolated: cs.isolation === "isolate" || cs.contain.includes("paint"),
      isFloat: cs.float !== "none",
      isInline: cs.display.startsWith("inline"),
      parentIsFlexOrGrid: /flex|grid/.test(parentDisplay)
    };
  };

  // src/stacking.ts
  var isPositioned = (p) => p.position !== "static";
  var establishesStackingContext = (p) => {
    if (p.position === "fixed" || p.position === "sticky") return true;
    if (isPositioned(p) && p.zIndex !== "auto") return true;
    if (p.parentIsFlexOrGrid && p.zIndex !== "auto") return true;
    if (p.opacity < 1) return true;
    if (p.hasTransform) return true;
    if (p.hasFilter) return true;
    if (p.hasMixBlendMode) return true;
    if (p.isIsolated) return true;
    return false;
  };
  var isStackingParticipant = (p) => isPositioned(p) || p.parentIsFlexOrGrid && p.zIndex !== "auto";
  var isStackingParticipantExported = isStackingParticipant;
  var emptyGroups = () => ({
    negative: [],
    flow: [],
    float: [],
    inline: [],
    auto: [],
    positive: []
  });
  var bucketOf = (p) => {
    const z = p.zIndex;
    const zMatters = isPositioned(p) || p.parentIsFlexOrGrid;
    if (zMatters && typeof z === "number" && z < 0) return "negative";
    if (zMatters && typeof z === "number" && z > 0) return "positive";
    if (isPositioned(p)) return "auto";
    if (zMatters && typeof z === "number" && z === 0) return "auto";
    if (p.isFloat) return "float";
    if (p.isInline) return "inline";
    return "flow";
  };
  var zValue = (p) => p.zIndex === "auto" ? 0 : p.zIndex;
  var byZIndex = (items) => items.map((item, index) => ({ item, index })).sort((a, b) => zValue(a.item) - zValue(b.item) || a.index - b.index).map(({ item }) => item);
  var resolvePaintOrder = (root) => {
    const order = /* @__PURE__ */ new Map();
    let counter = 0;
    const emit = (p) => {
      order.set(p.id, counter);
      counter += 1;
    };
    const collectInto = (node, groups) => {
      for (const child of node.children) {
        if (establishesStackingContext(child) || isStackingParticipant(child)) {
          groups[bucketOf(child)].push(child);
          continue;
        }
        groups[bucketOf(child)].push(child);
        collectInto(child, groups);
      }
    };
    const paintFlowNode = (p) => {
      emit(p);
    };
    const paintUnit = (p) => {
      emit(p);
      const groups = emptyGroups();
      collectInto(p, groups);
      paintGroups(groups);
    };
    const paintInFlow = (p) => {
      if (establishesStackingContext(p)) paintUnit(p);
      else paintFlowNode(p);
    };
    const paintGroups = (groups) => {
      for (const child of byZIndex(groups.negative)) paintUnit(child);
      for (const child of groups.flow) paintInFlow(child);
      for (const child of groups.float) paintInFlow(child);
      for (const child of groups.inline) paintInFlow(child);
      for (const child of byZIndex(groups.auto)) paintUnit(child);
      for (const child of byZIndex(groups.positive)) paintUnit(child);
    };
    paintUnit(root);
    return order;
  };
  var findApproximatedOrder = (root) => {
    const approximated = [];
    const hasParticipantInside = (p) => p.children.some(
      (child) => establishesStackingContext(child) || isStackingParticipantExported(child) || hasParticipantInside(child)
    );
    const visit = (p) => {
      if (p.position !== "static" && p.zIndex === "auto" && !establishesStackingContext(p) && hasParticipantInside(p)) {
        approximated.push(p.id);
      }
      for (const child of p.children) visit(child);
    };
    visit(root);
    return approximated;
  };
  var findInterleaved = (root, order) => {
    const interleaved = [];
    const subtreeIds = (p, out) => {
      out.add(p.id);
      for (const child of p.children) subtreeIds(child, out);
      return out;
    };
    const all = [];
    const flatten = (p) => {
      all.push(p);
      for (const child of p.children) flatten(child);
    };
    flatten(root);
    const canOverlap = (p) => establishesStackingContext(p) || isStackingParticipantExported(p);
    for (const node of all) {
      const own = order.get(node.id);
      if (own === void 0) continue;
      const ids = subtreeIds(node, /* @__PURE__ */ new Set());
      let min = own;
      let max = own;
      for (const id of ids) {
        const value = order.get(id);
        if (value === void 0) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (max - min + 1 === ids.size) continue;
      const intruder = all.find((other) => {
        if (ids.has(other.id)) return false;
        const value = order.get(other.id);
        if (value === void 0) return false;
        return value > min && value < max && canOverlap(other);
      });
      if (intruder !== void 0) interleaved.push(node.id);
    }
    return [...new Set(interleaved)];
  };

  // src/text.ts
  var ALIGN_MAP2 = {
    left: "left",
    start: "left",
    center: "center",
    right: "right",
    end: "right",
    justify: "justify"
  };
  var decorationOf = (cs) => {
    const line = cs.textDecorationLine;
    if (line.includes("underline")) return "underline";
    if (line.includes("line-through")) return "strikethrough";
    return "none";
  };
  var lineHeightOf = (cs, fontSize) => {
    if (cs.lineHeight === "normal") return Math.round(fontSize * 1.2 * 100) / 100;
    return parsePx(cs.lineHeight);
  };
  var parseFontStack = (value) => value.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter((part) => part !== "");
  var GENERIC_FAMILIES = /* @__PURE__ */ new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong"
  ]);
  var PROBE_TEXT = "mmmmmwwwwwiiiii0123 \u041C\u0416\u0429";
  var PROBE_FALLBACKS = ["monospace", "serif", "sans-serif"];
  var availability = /* @__PURE__ */ new Map();
  var probeCtx;
  var measure = (font) => {
    if (probeCtx === void 0) {
      probeCtx = document.createElement("canvas").getContext("2d");
    }
    if (probeCtx === null) return null;
    probeCtx.font = font;
    return probeCtx.measureText(PROBE_TEXT).width;
  };
  var quoted = (family) => `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  var isFamilyAvailable = (family, fontSize) => {
    if (GENERIC_FAMILIES.has(family.toLowerCase())) return true;
    const key = `${family}|${fontSize}`;
    const cached = availability.get(key);
    if (cached !== void 0) return cached;
    let available = false;
    for (const fallback of PROBE_FALLBACKS) {
      const base = measure(`${fontSize}px ${fallback}`);
      const probe = measure(`${fontSize}px ${quoted(family)}, ${fallback}`);
      if (base === null || probe === null) {
        available = true;
        break;
      }
      if (probe !== base) {
        available = true;
        break;
      }
    }
    availability.set(key, available);
    return available;
  };
  var findUsedFamily = (stack, fontSize) => {
    if (typeof document === "undefined") return stack[0] ?? "sans-serif";
    for (const family of stack) {
      if (isFamilyAvailable(family, fontSize)) return family;
    }
    return stack[0] ?? "sans-serif";
  };
  var COLLAPSING_WHITE_SPACE = /* @__PURE__ */ new Set(["normal", "nowrap"]);
  var collapseWhiteSpace = (text, cs) => COLLAPSING_WHITE_SPACE.has(cs.whiteSpace) ? text.replace(/\s+/g, " ") : text;
  var trimAtLineBreaks = (text, cs, lineBefore, lineAfter) => {
    if (!COLLAPSING_WHITE_SPACE.has(cs.whiteSpace)) return text;
    const head = lineBefore ? text.replace(/^ +/, "") : text;
    return lineAfter ? head.replace(/ +$/, "") : head;
  };
  var applyTextTransform = (text, cs) => {
    switch (cs.textTransform) {
      case "uppercase":
        return text.toLocaleUpperCase();
      case "lowercase":
        return text.toLocaleLowerCase();
      case "capitalize":
        return text.replace(
          new RegExp("(^|\\s)(\\p{L})", "gu"),
          (_, sep, ch) => sep + ch.toLocaleUpperCase()
        );
      default:
        return text;
    }
  };
  var weightOf = (cs) => {
    const parsed = Number.parseInt(cs.fontWeight, 10);
    return Number.isNaN(parsed) ? 400 : parsed;
  };
  var ownText = (el) => {
    let out = "";
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      out += node.textContent ?? "";
    }
    return out;
  };
  var sliceForRect = (node, rect, from) => {
    const full = node.textContent ?? "";
    const probe = document.createRange();
    let end = from;
    while (end < full.length) {
      probe.setStart(node, from);
      probe.setEnd(node, end + 1);
      const candidate = probe.getBoundingClientRect();
      if (candidate.bottom > rect.bottom + 0.5) break;
      end += 1;
    }
    probe.detach();
    return full.slice(from, end);
  };
  var readLines = (el, cs, origin) => {
    const lines = [];
    for (const node of el.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const content = node.textContent;
      if (content === null || content.trim() === "") continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0
      );
      let cursor = 0;
      for (const [index, rect] of rects.entries()) {
        const raw = sliceForRect(node, rect, cursor);
        cursor += raw.length;
        const visible = trimAtLineBreaks(
          collapseWhiteSpace(raw, cs),
          cs,
          index > 0,
          index < rects.length - 1
        );
        lines.push({
          x: rect.left - origin.x,
          y: rect.top - origin.y,
          w: rect.width,
          h: rect.height,
          // Преобразование применяется и к строкам, и к рану — инвариант
          // контракта сверяет их конкатенации между собой.
          text: applyTextTransform(visible, cs)
        });
      }
      range.detach();
    }
    return lines;
  };
  var readText = (el, cs, origin) => {
    const own = ownText(el);
    if (own.trim() === "") return { kind: "none" };
    const fontSize = parsePx(cs.fontSize);
    const stack = parseFontStack(cs.fontFamily);
    const color = parseColor(cs.color);
    const run = {
      text: applyTextTransform(collapseWhiteSpace(own, cs), cs),
      fontStack: stack.length > 0 ? stack : ["sans-serif"],
      usedFamily: findUsedFamily(stack, fontSize),
      fontWeight: weightOf(cs),
      fontStyle: cs.fontStyle === "italic" ? "italic" : "normal",
      fontSize,
      letterSpacing: cs.letterSpacing === "normal" ? 0 : parsePx(cs.letterSpacing),
      color: color ?? { r: 0, g: 0, b: 0, a: 1 },
      decoration: decorationOf(cs),
      shadows: parseBoxShadow(cs.textShadow)
    };
    const lines = readLines(el, cs, origin);
    if (lines.length === 0) return { kind: "lost", sample: own.slice(0, 40) };
    return {
      kind: "text",
      text: {
        runs: [run],
        lines,
        lineHeight: lineHeightOf(cs, fontSize),
        align: ALIGN_MAP2[cs.textAlign] ?? "left"
      }
    };
  };
  var hasFontFallback = (cs) => {
    const stack = parseFontStack(cs.fontFamily);
    const first = stack[0];
    if (first === void 0) return false;
    return findUsedFamily(stack, parsePx(cs.fontSize)) !== first;
  };

  // src/walk.ts
  var createIdAllocator = () => {
    let counter = 0;
    return () => {
      const id = `n${counter}`;
      counter += 1;
      return id;
    };
  };
  var SKIPPED_TAGS = /* @__PURE__ */ new Set([
    "SCRIPT",
    "STYLE",
    "META",
    "LINK",
    "TITLE",
    "HEAD",
    "NOSCRIPT",
    "TEMPLATE",
    "BR"
  ]);
  var isRendered = (el, cs) => {
    if (SKIPPED_TAGS.has(el.tagName)) return false;
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  var ALIGN_SELF = {
    "flex-start": "start",
    start: "start",
    center: "center",
    "flex-end": "end",
    end: "end",
    stretch: "stretch",
    baseline: "baseline"
  };
  var readSelfLayout = (cs) => {
    const positioning = cs.position === "absolute" ? "absolute" : cs.position === "fixed" ? "fixed" : cs.position === "sticky" ? "sticky" : cs.float !== "none" ? "float" : "flow";
    const rawAlign = cs.alignSelf;
    return {
      positioning,
      align: rawAlign === "auto" ? null : ALIGN_SELF[rawAlign] ?? null,
      grow: Number.parseFloat(cs.flexGrow) || 0,
      shrink: Number.isNaN(Number.parseFloat(cs.flexShrink)) ? 1 : Number.parseFloat(cs.flexShrink)
    };
  };
  var naturalSizeOf = (url) => {
    const fromData = sizeFromDataUrl(url);
    if (fromData !== null) return fromData;
    const probe = new Image();
    probe.src = url;
    if (!probe.complete || probe.naturalWidth === 0) return null;
    return { w: probe.naturalWidth, h: probe.naturalHeight };
  };
  var originBoxOf = (cs, box) => {
    const origin = cs.backgroundOrigin;
    if (origin === "border-box") return { x: 0, y: 0, w: box.w, h: box.h };
    const px = (value) => Number.parseFloat(value) || 0;
    let left = px(cs.borderLeftWidth);
    let top = px(cs.borderTopWidth);
    let right = px(cs.borderRightWidth);
    let bottom = px(cs.borderBottomWidth);
    if (origin === "content-box") {
      left += px(cs.paddingLeft);
      top += px(cs.paddingTop);
      right += px(cs.paddingRight);
      bottom += px(cs.paddingBottom);
    }
    return {
      x: left,
      y: top,
      w: Math.max(0, box.w - left - right),
      h: Math.max(0, box.h - top - bottom)
    };
  };
  var readFills = (cs, box, sink, id, requests2, screenId) => {
    const fills = [];
    const background = parseColor(cs.backgroundColor);
    if (background === null) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.colorUnparsed,
        `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0440\u0430\u0437\u043E\u0431\u0440\u0430\u0442\u044C background-color: "${cs.backgroundColor}"`,
        id,
        false
      );
    } else if (!isInvisible(background)) {
      fills.push({ kind: "solid", color: background });
    }
    if (cs.backgroundImage !== "none") {
      const verdict = classifyBackgroundImage(cs.backgroundImage);
      if (verdict.kind === "gradient") {
        const gradient = parseLinearGradient(cs.backgroundImage, box);
        if (gradient !== null) fills.push({ kind: "gradient", gradient });
      } else if (verdict.kind === "raster") {
        const resolved = new URL(verdict.url, document.baseURI).href;
        const natural = naturalSizeOf(resolved);
        if (natural === null) {
          sink.report(
            "warning",
            DIAGNOSTIC_CODES.imageUnreadable,
            `\u0420\u0430\u0437\u043C\u0435\u0440 \u0444\u043E\u043D\u043E\u0432\u043E\u0433\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D: ${resolved}`,
            id,
            false
          );
        } else {
          const origin = originBoxOf(cs, box);
          if (repeatVerdict(cs.backgroundRepeat).partial) {
            sink.report(
              "info",
              DIAGNOSTIC_CODES.deferredRepeatMode,
              `background-repeat: ${cs.backgroundRepeat} \u043D\u0435 \u0432\u044B\u0440\u0430\u0436\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u043D\u0438\u043C \u0440\u0435\u0436\u0438\u043C\u043E\u043C \u043D\u0430 \u043E\u0431\u0435 \u043E\u0441\u0438 \u0438 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0451\u043D \u0431\u0435\u0437 \u043F\u043E\u0432\u0442\u043E\u0440\u0430.`,
              id,
              false
            );
          }
          fills.push({
            kind: "image",
            ref: {
              assetId: requests2.request(resolved, natural.w, natural.h, id, screenId),
              placement: backgroundPlacementFor(
                cs.backgroundSize,
                cs.backgroundPosition,
                cs.backgroundRepeat,
                origin,
                natural
              )
            }
          });
        }
      }
    }
    return fills;
  };
  var BLEND_MODES = /* @__PURE__ */ new Set([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity"
  ]);
  var readStyle = (cs, box, sink, id, requests2, screenId) => {
    if (isEllipticalCorner(cs)) {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.ellipticalCorner,
        "\u042D\u043B\u043B\u0438\u043F\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u0440\u0430\u0434\u0438\u0443\u0441 \u0443\u0433\u043B\u0430 \u0441\u0432\u0435\u0434\u0451\u043D \u043A \u0433\u043E\u0440\u0438\u0437\u043E\u043D\u0442\u0430\u043B\u044C\u043D\u043E\u043C\u0443: \u0432 Figma \u044D\u043B\u043B\u0438\u043F\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0443\u0433\u043B\u043E\u0432 \u043D\u0435\u0442.",
        id,
        false
      );
    }
    if (hasMixedBorderColors(cs)) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.mixedBorderColors,
        "\u0413\u0440\u0430\u043D\u0438\u0446\u044B \u0440\u0430\u0437\u043D\u044B\u0445 \u0446\u0432\u0435\u0442\u043E\u0432 \u0441\u0432\u0435\u0434\u0435\u043D\u044B \u043A \u043E\u0434\u043D\u043E\u043C\u0443: Figma \u0434\u0435\u0440\u0436\u0438\u0442 \u043E\u0434\u0438\u043D \u0446\u0432\u0435\u0442 \u043E\u0431\u0432\u043E\u0434\u043A\u0438 \u043D\u0430 \u0443\u0437\u0435\u043B.",
        id,
        false
      );
    }
    if (hasNonSolidStroke(cs)) {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.strokeStyleFlattened,
        "\u0421\u0442\u0438\u043B\u044C \u0433\u0440\u0430\u043D\u0438\u0446\u044B \u043D\u0435 \u0432\u043E\u0441\u043F\u0440\u043E\u0438\u0437\u0432\u043E\u0434\u0438\u0442\u0441\u044F \u0440\u0435\u043D\u0434\u0435\u0440\u0435\u0440\u043E\u043C \u043F\u043B\u0430\u043D\u0430 1 \u043B\u0438\u0431\u043E \u043D\u0435\u0432\u044B\u0440\u0430\u0437\u0438\u043C \u0432 Figma.",
        id,
        false
      );
    }
    const rawBlend = cs.mixBlendMode;
    const blend = BLEND_MODES.has(rawBlend) ? rawBlend : "normal";
    return {
      fills: readFills(cs, box, sink, id, requests2, screenId),
      stroke: readStroke(cs),
      corner: readCorner(cs),
      shadows: parseBoxShadow(cs.boxShadow),
      // СОБСТВЕННАЯ непрозрачность, не композитная: плагин вкладывает узлы,
      // и Figma перемножает так же, как браузер. Запекать вниз запрещено.
      opacity: Number.parseFloat(cs.opacity),
      blend,
      /** Два размытия разведены намеренно: `filter: blur()` размывает САМ
       *  слой и переносится, `backdrop-filter: blur()` размывает то, что за
       *  элементом, и остаётся отложенным — у плоского рендерера «за
       *  элементом» не существует, проверить перенос нечем. Поле остаётся
       *  `null`, когда размытия нет вовсе: пустой объект `{0,0}` заставил бы
       *  инвариант требовать диагностику там, где нечего откладывать. */
      blur: (() => {
        const layer = blurRadius(cs.filter);
        const background = blurRadius(cs.backdropFilter);
        return layer > 0 || background > 0 ? { layer, background } : null;
      })(),
      clip: cs.overflowX === "hidden" || cs.overflowY === "hidden" || cs.overflowX === "clip" || cs.overflowY === "clip"
    };
  };
  var blurRadius = (value) => {
    const match = /blur\(\s*([\d.]+)px\s*\)/.exec(value);
    if (match?.[1] === void 0) return 0;
    return Number.parseFloat(match[1]);
  };
  var reportGaps = (el, cs, sink, id) => {
    if (cs.backgroundImage !== "none") {
      const rect = el.getBoundingClientRect();
      const verdict = classifyBackgroundImage(cs.backgroundImage);
      switch (verdict.kind) {
        case "gradient": {
          const linear = parseLinearGradient(cs.backgroundImage, {
            w: rect.width,
            h: rect.height
          });
          if (linear === null) {
            const repeating = cs.backgroundImage.includes("repeating-");
            sink.report(
              repeating ? "warning" : "info",
              repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient : DIAGNOSTIC_CODES.deferredGradient,
              `background-image "${cs.backgroundImage.slice(0, 60)}" \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F: \u0432 \u044D\u0442\u043E\u043C \u043F\u043B\u0430\u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0430\u043D \u0442\u043E\u043B\u044C\u043A\u043E linear-gradient.`,
              id,
              false
            );
          }
          break;
        }
        case "vector":
          sink.report(
            "info",
            verdict.code,
            "\u0412\u0435\u043A\u0442\u043E\u0440\u043D\u044B\u0439 \u0444\u043E\u043D (SVG) \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u0440\u0430\u0441\u0442\u0440\u043E\u043C.",
            id,
            false
          );
          break;
        case "multi-layer":
          sink.report(
            "info",
            verdict.code,
            "\u041D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u043B\u043E\u0451\u0432 \u0444\u043E\u043D\u0430: \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0451\u043D \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043B\u0443\u0447\u0430\u0439 \u043E\u0434\u043D\u043E\u0433\u043E \u0441\u043B\u043E\u044F.",
            id,
            false
          );
          break;
        case "unknown":
          sink.report(
            "warning",
            DIAGNOSTIC_CODES.deferredGradient,
            `\u0424\u043E\u043D\u043E\u0432\u043E\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 "${verdict.raw.slice(0, 60)}" \u043D\u0435 \u0440\u0430\u0441\u043F\u043E\u0437\u043D\u0430\u043D\u043E.`,
            id,
            false
          );
          break;
        case "raster":
          break;
        case "none":
          break;
      }
    }
    if (cs.transform !== "none") {
      const matrix = parseMatrix(cs.transform);
      if (matrix === null) {
        sink.report(
          "error",
          DIAGNOSTIC_CODES.unsupportedTransform3d,
          `transform "${cs.transform}" \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F: \u0442\u0440\u0451\u0445\u043C\u0435\u0440\u043D\u044B\u0445 \u0442\u0440\u0430\u043D\u0441\u0444\u043E\u0440\u043C \u0432 Figma \u043D\u0435\u0442 \u0444\u0438\u0437\u0438\u0447\u0435\u0441\u043A\u0438.`,
          id,
          false
        );
      } else if (hasSkew(matrix)) {
        sink.report(
          "error",
          DIAGNOSTIC_CODES.unsupportedTransform3d,
          `transform "${cs.transform}" \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0441\u0434\u0432\u0438\u0433, \u043A\u043E\u0442\u043E\u0440\u043E\u0433\u043E \u0432 Figma \u043D\u0435\u0442.`,
          id,
          false
        );
      }
    }
    const bgBlur = blurRadius(cs.backdropFilter);
    if (bgBlur > 0) {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.deferredBlur,
        `backdrop-filter: blur(${bgBlur}px) \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F: \u0440\u0435\u043D\u0434\u0435\u0440\u0435\u0440 \u043F\u043B\u044E\u0449\u0438\u0442 \u0434\u0435\u0440\u0435\u0432\u043E, \u0438 \u0444\u043E\u043D\u0430 \u0437\u0430 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u043C \u0443 \u043D\u0435\u0433\u043E \u043D\u0435\u0442.`,
        id,
        false
      );
    }
    const hasNonBlur = (value) => value !== "none" && value.replace(/blur\([^)]*\)/g, "").trim() !== "";
    if (hasNonBlur(cs.filter)) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.unsupportedFilter,
        `filter "${cs.filter}" \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0444\u0443\u043D\u043A\u0446\u0438\u0438 \u043A\u0440\u043E\u043C\u0435 \u0440\u0430\u0437\u043C\u044B\u0442\u0438\u044F: Figma \u0438\u0445 \u043D\u0435 \u0438\u043C\u0435\u0435\u0442.`,
        id,
        false
      );
    }
    if (hasNonBlur(cs.backdropFilter)) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.unsupportedFilter,
        `backdrop-filter "${cs.backdropFilter}" \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0444\u0443\u043D\u043A\u0446\u0438\u0438 \u043A\u0440\u043E\u043C\u0435 \u0440\u0430\u0437\u043C\u044B\u0442\u0438\u044F.`,
        id,
        false
      );
    }
    if (cs.clipPath !== "none") {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.unsupportedClipPath,
        `clip-path "${cs.clipPath}" \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F.`,
        id,
        false
      );
    }
    if (cs.position === "sticky" || cs.position === "fixed") {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.stickyFlattened,
        `position: ${cs.position} \u0441\u043D\u044F\u0442 \u0432 \u0442\u0435\u043A\u0443\u0449\u0435\u043C \u0441\u043A\u0440\u043E\u043B\u043B-\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0438.`,
        id,
        false
      );
    }
    if (cs.display === "grid" || cs.display === "inline-grid") {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.gridFlattened,
        "CSS grid \u0441\u0432\u0435\u0434\u0451\u043D \u043A \u043A\u043E\u043B\u043E\u043D\u043A\u0435: \u0432 Figma \u043D\u0435\u0442 \u0434\u0432\u0443\u043C\u0435\u0440\u043D\u043E\u0433\u043E auto-layout.",
        id,
        false
      );
    }
    if (el.namespaceURI === "http://www.w3.org/2000/svg") {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.deferredVector,
        "\u0412\u0435\u043A\u0442\u043E\u0440\u043D\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u0432 \u044D\u0442\u043E\u043C \u043F\u043B\u0430\u043D\u0435.",
        id,
        false
      );
    }
    for (const pseudo of ["::before", "::after"]) {
      const content = window.getComputedStyle(el, pseudo).content;
      if (content !== "none" && content !== "normal" && content !== "") {
        sink.report(
          "info",
          DIAGNOSTIC_CODES.deferredPseudoElement,
          `\u041F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442 ${pseudo} \u0441 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u044B\u043C ${content} \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F.`,
          id,
          false
        );
      }
    }
  };
  var placeholderFor = (el, sink, id) => {
    if (el.tagName === "CANVAS") {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.unsupportedCanvas,
        "\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 <canvas> \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F.",
        id,
        true
      );
      return { code: DIAGNOSTIC_CODES.unsupportedCanvas, label: "canvas" };
    }
    if (el.tagName === "VIDEO") {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.unsupportedVideo,
        "\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 <video> \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F: \u043A\u0430\u0434\u0440 \u0432\u0438\u0434\u0435\u043E \u2014 \u043D\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B, \u0438 \u0432\u044B\u0434\u0430\u0432\u0430\u0442\u044C \u043E\u0434\u0438\u043D \u043C\u043E\u043C\u0435\u043D\u0442 \u0432\u0440\u0435\u043C\u0435\u043D\u0438 \u0437\u0430 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u043D\u0435\u0432\u0435\u0440\u043D\u043E.",
        id,
        true
      );
      return { code: DIAGNOSTIC_CODES.unsupportedVideo, label: "video" };
    }
    if (el.tagName === "IFRAME") {
      const frame = el;
      let sameOrigin = false;
      try {
        sameOrigin = frame.contentDocument !== null;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        sink.report(
          "warning",
          DIAGNOSTIC_CODES.unsupportedCrossOriginIframe,
          "\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 iframe \u0441 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
          id,
          true
        );
        return { code: DIAGNOSTIC_CODES.unsupportedCrossOriginIframe, label: "iframe" };
      }
    }
    return null;
  };
  var readImage = (el, cs, box, ctx, id) => {
    if (el.tagName !== "IMG") return { kind: "not-image" };
    const img = el;
    if (img.currentSrc === "" || img.naturalWidth === 0 || img.naturalHeight === 0) {
      ctx.sink.report(
        "warning",
        DIAGNOSTIC_CODES.imageUnreadable,
        `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A <img> \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D: "${img.getAttribute("src") ?? ""}".`,
        id,
        true
      );
      return { kind: "broken", label: "img" };
    }
    const natural = { w: img.naturalWidth, h: img.naturalHeight };
    return {
      kind: "ref",
      ref: {
        assetId: ctx.requests.request(img.currentSrc, natural.w, natural.h, id, ctx.screenId),
        placement: placementFor(cs.objectFit, cs.objectPosition, box, natural)
      }
    };
  };
  var buildNode = (el, parentCs, ctx) => {
    const cs = window.getComputedStyle(el);
    if (!isRendered(el, cs)) return null;
    const id = ctx.allocId();
    reportGaps(el, cs, ctx.sink, id);
    const ownMatrixRaw = parseMatrix(cs.transform);
    const rawRect = el.getBoundingClientRect();
    const boxReadable = appliesTransform(cs);
    const usable = ownMatrixRaw !== null && !hasSkew(ownMatrixRaw) && boxReadable;
    const origin = readOrigin(cs);
    const ownMatrix = usable && ownMatrixRaw !== null ? matrixAboutOrigin(ownMatrixRaw, origin) : IDENTITY_MATRIX;
    const size = boxReadable ? untransformedSize(cs) : { w: rawRect.width, h: rawRect.height };
    const ownIsIdentity = ownMatrix === IDENTITY_MATRIX;
    const total = ownIsIdentity ? ctx.ancestorMatrix : multiplyMatrix(ctx.ancestorMatrix, ownMatrix);
    const totalInverse = ownIsIdentity ? ctx.ancestorInverse : invertMatrix(total);
    const screenOrigin = originUnderMatrix(el, total, size);
    const local = ctx.ancestorInverse === null ? { x: 0, y: 0 } : localOffset({
      screenOrigin,
      parentOrigin: ctx.parentOrigin,
      ancestorInverse: ctx.ancestorInverse,
      ownMatrix
    });
    const box = { x: local.x, y: local.y, w: size.w, h: size.h };
    const transform = usable && ownMatrixRaw !== null ? { ...decomposeMatrix(ownMatrixRaw), originX: origin.x, originY: origin.y } : null;
    const children = [];
    const childProbes = [];
    const brokenTransform = ownMatrixRaw !== null && !usable;
    const ordered = isReversed(cs) ? [...el.children].reverse() : [...el.children];
    const childCtx = {
      ...ctx,
      ancestorMatrix: total,
      ancestorInverse: invertMatrix(total),
      parentOrigin: screenOrigin,
      insideBrokenTransform: ctx.insideBrokenTransform || brokenTransform
    };
    for (const child of ordered) {
      const built = buildNode(child, cs, childCtx);
      if (built === null) continue;
      children.push(built.node);
      childProbes.push(built.probe);
    }
    const base = {
      id,
      sourceTag: el.tagName.toLowerCase(),
      name: el.tagName.toLowerCase(),
      /** Координаты родителя. Прокрутка сюда больше не прибавляется: она
       *  входит в положение КОРНЯ и наследуется вложенностью, а прибавленная
       *  на каждом уровне сложилась бы столько раз, какова глубина. Корню её
       *  добавляет `walkDocument` после обхода. */
      rect: box,
      // Заполняется вторым проходом: требует готового дерева.
      paintOrder: -1,
      isStackingContext: false,
      transform,
      layout: readLayout(cs),
      selfLayout: readSelfLayout(cs),
      style: readStyle(cs, box, ctx.sink, id, ctx.requests, ctx.screenId),
      children
    };
    if (ctx.insideBrokenTransform) {
      ctx.sink.report(
        "warning",
        DIAGNOSTIC_CODES.transformDescendant,
        "\u0423\u0437\u0435\u043B \u043B\u0435\u0436\u0438\u0442 \u0432\u043D\u0443\u0442\u0440\u0438 \u043F\u0440\u0435\u0434\u043A\u0430 \u0441 \u043D\u0435\u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u043C\u043E\u0439 \u0442\u0440\u0430\u043D\u0441\u0444\u043E\u0440\u043C\u043E\u0439 (\u0441\u043A\u043E\u0441 \u0438\u043B\u0438 \u0442\u0440\u0451\u0445\u043C\u0435\u0440\u043D\u0430\u044F): \u0435\u0451 \u043D\u0435\u0442 \u0432 \u043D\u0430\u043A\u043E\u043F\u043B\u0435\u043D\u043D\u043E\u0439 \u043C\u0430\u0442\u0440\u0438\u0446\u0435, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0443\u0437\u043B\u0430 \u0443\u043D\u0430\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u043B\u043E \u043E\u0448\u0438\u0431\u043A\u0443 \u043F\u0440\u0435\u0434\u043A\u0430.",
        id,
        false
      );
    }
    const placeholder = placeholderFor(el, ctx.sink, id);
    const image = readImage(el, cs, box, ctx, id);
    let node;
    if (image.kind === "ref") {
      node = { ...base, kind: "image", image: image.ref };
    } else if (image.kind === "broken") {
      node = {
        ...base,
        kind: "placeholder",
        placeholder: { code: DIAGNOSTIC_CODES.imageUnreadable, label: image.label }
      };
    } else if (placeholder !== null) {
      node = { ...base, kind: "placeholder", placeholder };
    } else {
      const text = readText(el, cs, screenOrigin);
      if (text.kind === "text") {
        if (hasFontFallback(cs)) {
          const stack = parseFontStack(cs.fontFamily);
          ctx.sink.report(
            "error",
            DIAGNOSTIC_CODES.fontFallback,
            `\u041E\u0431\u044A\u044F\u0432\u043B\u0435\u043D "${stack[0] ?? "?"}", \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0440\u0438\u0441\u043E\u0432\u0430\u043B "${text.text.runs[0]?.usedFamily ?? "?"}". \u041C\u0435\u0442\u0440\u0438\u043A\u0438 \u0441\u0442\u0440\u043E\u043A \u2014 \u043E\u0442 \u0444\u0430\u043A\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0433\u043E \u0448\u0440\u0438\u0444\u0442\u0430.`,
            id,
            false
          );
        }
        node = { ...base, kind: "text", text: text.text };
      } else {
        if (text.kind === "lost") {
          ctx.sink.report(
            "warning",
            DIAGNOSTIC_CODES.textLost,
            `\u0422\u0435\u043A\u0441\u0442 "${text.sample}" \u043D\u0435 \u0434\u0430\u043B \u043D\u0438 \u043E\u0434\u043D\u043E\u0433\u043E \u0431\u043E\u043A\u0441\u0430 \u0441\u0442\u0440\u043E\u043A\u0438 \u0438 \u043F\u043E\u0442\u0435\u0440\u044F\u043D.`,
            id,
            false
          );
        }
        node = { ...base, kind: "frame" };
      }
    }
    const probe = {
      ...readProbe(el, cs, parentCs),
      id,
      children: childProbes
    };
    return { node, probe };
  };
  var applyPaintOrder = (node, order, contexts) => {
    const resolved = order.get(node.id);
    if (resolved === void 0) {
      throw new Error(
        `\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438 \u043D\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u0443\u0437\u043B\u0430 ${node.id} (${node.sourceTag}). \u0414\u0435\u0440\u0435\u0432\u043E \u0443\u0437\u043B\u043E\u0432 \u0438 \u0434\u0435\u0440\u0435\u0432\u043E \u043F\u0440\u043E\u0431 \u0440\u0430\u0441\u0441\u0438\u043D\u0445\u0440\u043E\u043D\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u044B \u2014 \u044D\u0442\u043E \u0431\u0430\u0433 \u0441\u0435\u0440\u0438\u0430\u043B\u0438\u0437\u0430\u0442\u043E\u0440\u0430.`
      );
    }
    node.paintOrder = resolved;
    node.isStackingContext = contexts.has(node.id);
    for (const child of node.children) applyPaintOrder(child, order, contexts);
  };
  var collectStackingContexts = (probe, out) => {
    if (establishesStackingContext(probe)) out.add(probe.id);
    for (const child of probe.children) collectStackingContexts(child, out);
  };
  var collectFonts = (node) => {
    const seen = /* @__PURE__ */ new Map();
    const visit = (current) => {
      if (current.kind === "text") {
        for (const run of current.text.runs) {
          const key = `${run.usedFamily}|${run.fontWeight}|${run.fontStyle}`;
          if (!seen.has(key)) {
            seen.set(key, {
              family: run.usedFamily,
              weight: run.fontWeight,
              style: run.fontStyle
            });
          }
        }
      }
      for (const child of current.children) visit(child);
    };
    visit(node);
    return [...seen.values()];
  };
  var walkDocument = (sink, allocId, requests2, screenId) => {
    const ctx = {
      sink,
      requests: requests2,
      screenId,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      allocId,
      insideBrokenTransform: false,
      ancestorMatrix: IDENTITY_MATRIX,
      ancestorInverse: IDENTITY_MATRIX,
      parentOrigin: { x: 0, y: 0 }
    };
    const built = buildNode(document.body, null, ctx);
    if (built === null) return null;
    built.node.rect = {
      ...built.node.rect,
      x: built.node.rect.x + window.scrollX,
      y: built.node.rect.y + window.scrollY
    };
    const htmlStyle = window.getComputedStyle(document.documentElement);
    const htmlBackground = parseColor(htmlStyle.backgroundColor);
    if (htmlBackground !== null && !isInvisible(htmlBackground) && built.node.style.fills.length === 0) {
      built.node.style.fills = [{ kind: "solid", color: htmlBackground }];
      sink.report(
        "info",
        DIAGNOSTIC_CODES.pageBackgroundMoved,
        `\u0424\u043E\u043D \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D \u043D\u0430 <html> \u0438 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0451\u043D \u043D\u0430 \u043A\u043E\u0440\u043D\u0435\u0432\u043E\u0439 \u0443\u0437\u0435\u043B: rgb(${htmlBackground.r},${htmlBackground.g},${htmlBackground.b}).`,
        built.node.id,
        false
      );
    }
    const order = resolvePaintOrder(built.probe);
    const contexts = /* @__PURE__ */ new Set();
    collectStackingContexts(built.probe, contexts);
    applyPaintOrder(built.node, order, contexts);
    for (const id of findApproximatedOrder(built.probe)) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.paintOrderApproximated,
        "\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438 \u043F\u0440\u0438\u0431\u043B\u0438\u0436\u0451\u043D: \u0443 \u044D\u0442\u043E\u0433\u043E \u0443\u0437\u043B\u0430 position \u0437\u0430\u0434\u0430\u043D, \u0430 z-index \u0440\u0430\u0432\u0435\u043D auto, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u043E CSS \u0435\u0433\u043E \u043F\u043E\u0437\u0438\u0446\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043F\u043E\u0442\u043E\u043C\u043A\u0438 \u0434\u043E\u043B\u0436\u043D\u044B \u0443\u0447\u0430\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u044C \u0432 \u0441\u0442\u0435\u043A\u0438\u043D\u0433\u0435 \u043F\u0440\u0435\u0434\u043A\u0430, \u0430 \u043D\u0435 \u0435\u0433\u043E \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u043E\u043C. \u0420\u0435\u0437\u043E\u043B\u0432\u0435\u0440 \u0441\u0447\u0438\u0442\u0430\u0435\u0442 \u0443\u0437\u0435\u043B \u0430\u0442\u043E\u043C\u0430\u0440\u043D\u044B\u043C \u2014 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u043B\u0438\u0447\u0430\u0442\u044C\u0441\u044F.",
        id,
        false
      );
    }
    for (const id of findInterleaved(built.probe, order)) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.paintOrderInterleaved,
        "\u041F\u043E\u0434\u0434\u0435\u0440\u0435\u0432\u043E \u043A\u0440\u0430\u0441\u0438\u0442\u0441\u044F \u0441 \u0440\u0430\u0437\u0440\u044B\u0432\u043E\u043C: \u0434\u0435\u0440\u0435\u0432\u043E Figma \u0442\u0430\u043A\u043E\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0432\u044B\u0440\u0430\u0437\u0438\u0442\u044C \u043D\u0435 \u043C\u043E\u0436\u0435\u0442, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0442\u0430\u043C z-\u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0437\u0430\u0434\u0430\u0451\u0442\u0441\u044F \u043F\u043E\u0440\u044F\u0434\u043A\u043E\u043C \u0441\u0440\u0435\u0434\u0438 \u0441\u0438\u0431\u043B\u0438\u043D\u0433\u043E\u0432.",
        id,
        false
      );
    }
    return built.node;
  };

  // src/serialize.ts
  var serializeScreen = (options) => {
    const sink = new DiagnosticSink(options.id);
    const root = walkDocument(sink, options.allocId, options.requests, options.id);
    if (root === null) {
      throw new Error("\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 \u043F\u0443\u0441\u0442: <body> \u043D\u0435 \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u0430\u043D.");
    }
    return {
      screen: {
        id: options.id,
        name: options.name,
        width: window.innerWidth,
        /** Высота фрейма макета: высота содержимого, но не меньше высоты
         *  вьюпорта. Скриншот для pixel-diff приводится к этому числу,
         *  а не наоборот — иначе короткая страница, где скриншот выше
         *  содержимого, давала бы ложное расхождение. */
        height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
        dpr: window.devicePixelRatio,
        scroll: { x: window.scrollX, y: window.scrollY },
        root,
        screenshotId: null
      },
      report: sink.drain(),
      fonts: collectFonts(root),
      assetRequests: options.requests.drain()
    };
  };
  var emptyBundle = () => ({
    format: "w2f",
    version: IR_VERSION,
    capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
    url: window.location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    screens: [],
    assets: [],
    fonts: [],
    tokens: { variables: [], textStyles: [], paintStyles: [] },
    report: []
  });

  // src/assets.ts
  var AssetRequests = class {
    byUrl = /* @__PURE__ */ new Map();
    items = [];
    counter = 0;
    request(url, naturalWidth, naturalHeight, nodeId, screenId) {
      const existing = this.byUrl.get(url);
      if (existing !== void 0) return existing;
      const id = `a${this.counter}`;
      this.counter += 1;
      this.byUrl.set(url, id);
      this.items.push({ id, url, naturalWidth, naturalHeight, nodeId, screenId });
      return id;
    }
    drain() {
      return [...this.items];
    }
  };

  // src/resolve-assets.ts
  var MAX_SIDE = 4096;
  var NATIVE_TYPES = /* @__PURE__ */ new Set(["image/png", "image/jpeg", "image/gif"]);
  var toBase64 = (bytes) => {
    const CHUNK = 32768;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  };
  var extensionFor = (mimeType) => mimeType === "image/jpeg" ? "jpg" : mimeType === "image/gif" ? "gif" : "png";
  var resolveAssets = async (requests2) => {
    const assets = [];
    const base64 = {};
    const report = [];
    const complain = (request, code, message, level, needsPlaceholder) => {
      report.push({
        level,
        code,
        message,
        nodeId: request.nodeId,
        screenId: request.screenId,
        needsPlaceholder
      });
    };
    for (const request of requests2) {
      let blob;
      try {
        const response = await fetch(request.url);
        if (!response.ok) {
          complain(
            request,
            DIAGNOSTIC_CODES.imageUnreadable,
            `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043E\u0442\u0432\u0435\u0442\u0438\u043B ${response.status}: ${request.url}`,
            "warning",
            true
          );
          continue;
        }
        blob = await response.blob();
      } catch (error) {
        complain(
          request,
          DIAGNOSTIC_CODES.imageUnreadable,
          `\u0411\u0430\u0439\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B (${String(error)}): ${request.url}`,
          "warning",
          true
        );
        continue;
      }
      const mimeType = blob.type.split(";")[0]?.trim() ?? "";
      if (mimeType === "image/svg+xml") {
        complain(
          request,
          DIAGNOSTIC_CODES.deferredVector,
          `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u043E\u0442\u0434\u0430\u043B SVG, \u0432\u0435\u043A\u0442\u043E\u0440 \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u0440\u0430\u0441\u0442\u0440\u043E\u043C: ${request.url}`,
          "info",
          true
        );
        continue;
      }
      let bitmap;
      try {
        bitmap = await createImageBitmap(blob);
      } catch (error) {
        complain(
          request,
          DIAGNOSTIC_CODES.imageUnreadable,
          `\u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u043D\u0435 \u0434\u0435\u043A\u043E\u0434\u0438\u0440\u0443\u0435\u0442\u0441\u044F (${String(error)}): ${request.url}`,
          "warning",
          true
        );
        continue;
      }
      const longest = Math.max(bitmap.width, bitmap.height);
      const scale = longest > MAX_SIDE ? MAX_SIDE / longest : 1;
      const needsRecode = !NATIVE_TYPES.has(mimeType);
      const needsRescale = scale < 1;
      let bytes;
      let width = bitmap.width;
      let height = bitmap.height;
      let outType = mimeType;
      if (needsRecode || needsRescale) {
        width = Math.max(1, Math.round(bitmap.width * scale));
        height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (context === null) {
          complain(
            request,
            DIAGNOSTIC_CODES.imageUnreadable,
            `\u041A\u0430\u043D\u0432\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430, \u043D\u043E\u0440\u043C\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u043D\u0430: ${request.url}`,
            "warning",
            true
          );
          bitmap.close();
          continue;
        }
        context.drawImage(bitmap, 0, 0, width, height);
        const recoded = await canvas.convertToBlob({ type: "image/png" });
        bytes = new Uint8Array(await recoded.arrayBuffer());
        outType = "image/png";
        if (needsRescale) {
          complain(
            request,
            DIAGNOSTIC_CODES.imageRescaled,
            `\u0423\u0436\u0430\u0442\u043E \u0441 ${bitmap.width}\xD7${bitmap.height} \u0434\u043E ${width}\xD7${height}: Figma \u043D\u0435 \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u0442 \u0441\u0442\u043E\u0440\u043E\u043D\u0443 \u0431\u043E\u043B\u044C\u0448\u0435 ${MAX_SIDE}px.`,
            "info",
            false
          );
        }
        if (needsRecode) {
          complain(
            request,
            DIAGNOSTIC_CODES.imageRecoded,
            `\u0424\u043E\u0440\u043C\u0430\u0442 ${mimeType} \u043F\u0435\u0440\u0435\u0443\u043F\u0430\u043A\u043E\u0432\u0430\u043D \u0432 PNG: Figma \u043F\u0440\u0438\u043D\u0438\u043C\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E PNG, JPEG \u0438 GIF.`,
            "info",
            false
          );
        }
      } else {
        bytes = new Uint8Array(await blob.arrayBuffer());
      }
      bitmap.close();
      assets.push({
        id: request.id,
        mimeType: outType,
        width,
        height,
        path: `assets/${request.id}.${extensionFor(outType)}`
      });
      base64[request.id] = toBase64(bytes);
    }
    return { assets, base64, report };
  };

  // src/global.ts
  var allocator = null;
  var requests = null;
  var beginCapture = () => {
    allocator = createIdAllocator();
    requests = new AssetRequests();
  };
  var captureScreen = (id, name) => {
    if (allocator === null) allocator = createIdAllocator();
    if (requests === null) requests = new AssetRequests();
    return serializeScreen({ id, name, allocId: allocator, requests });
  };
  var resolvePendingAssets = async () => {
    if (requests === null) return { assets: [], base64: {}, report: [] };
    return resolveAssets(requests.drain());
  };
  var api = {
    beginCapture,
    captureScreen,
    emptyBundle,
    resolvePendingAssets,
    sizeFromDataUrl
  };
  window.__w2f = api;
})();
//# sourceMappingURL=serializer.global.js.map