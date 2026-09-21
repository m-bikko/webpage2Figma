"use strict";
var H2DSerializer = (() => {
  // ../ir/src/version.ts
  var IR_VERSION = 3;

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
    /** Векторный элемент не удалось собрать самодостаточно: клон не
     *  повторил оригинал или сериализация дала пустую строку. Узел
     *  обязан стать заглушкой, а не пустым фреймом — иначе иконка
     *  исчезает неотличимо от «её тут и не было». */
    vectorUnreadable: "fidelity.vector-unreadable",
    /** Идентификатор внутри SVG встречается в документе раньше: браузер
     *  разрешал ссылки в чужой элемент, а захват — в свой. Расхождение
     *  реально и обязано быть названо. */
    vectorIdCollision: "fidelity.vector-id-collision",
    /** Figma разобрала SVG в размер, не равный боксу узла. Поправить
     *  `resize` нельзя: изменение размера рамки не масштабирует её
     *  содержимое, — поэтому факт называется, а не скрывается. */
    vectorResized: "fidelity.vector-resized",
    /** `<foreignObject>` внутри SVG: там лежит HTML, а не векторная
     *  разметка. Наш рендерер его нарисует — это браузер, — но импортёр
     *  Figma векторных узлов из HTML не делает, и содержимое пропадёт
     *  именно на той стороне, где результат некому сверить. */
    deferredForeignObject: "deferred.foreign-object",
    /** Узел перенесён к предку, потому что по CSS он участвует в
     *  стекинге предка, а не родителя. Меняется ИЕРАРХИЯ, и молчать об
     *  этом нельзя: дизайнер вправе знать, почему слой лежит не там,
     *  где элемент в разметке. */
    paintOrderHoisted: "fidelity.paint-order-hoisted",
    /** Радиальный градиент построен по соглашению, выведенному из
     *  линейного, но для радиального замером не подтверждённому.
     *  Попадает в список «требует сверки глазами»: выдавать вывод за
     *  измерение в этом проекте нельзя. */
    gradientUnverified: "fidelity.gradient-unverified",
    /** Auto-layout не применён, и названа причина. Молчать нельзя: без
     *  него узел приезжает набором коробок с абсолютными координатами,
     *  и дизайнер вправе знать, что именно в вёрстке этому помешало. */
    autoLayoutRejected: "fidelity.auto-layout-rejected",
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

  // src/css/clip.ts
  var parseSide = (raw, basis) => {
    const value = raw.trim();
    const percent = /^(-?\d*\.?\d+)%$/.exec(value);
    if (percent?.[1] !== void 0) {
      return Number.parseFloat(percent[1]) / 100 * basis;
    }
    const px2 = /^(-?\d*\.?\d+)px$/.exec(value);
    if (px2?.[1] !== void 0) return Number.parseFloat(px2[1]);
    return null;
  };
  var clipsAwayEverything = (clipPath, box) => {
    const match = /^inset\(([^)]*)\)$/.exec(clipPath.trim());
    if (match?.[1] === void 0) return false;
    const sides = match[1].split(/\s+round\s+/)[0]?.trim().split(/\s+/) ?? [];
    if (sides.length === 0 || sides.length > 4) return false;
    const [a, b, c, d] = sides;
    const top = a;
    const right = sides.length === 1 ? a : b;
    const bottom = sides.length <= 2 ? a : c;
    const left = sides.length === 1 ? a : sides.length === 4 ? d : b;
    if (top === void 0 || right === void 0 || bottom === void 0 || left === void 0) return false;
    const t = parseSide(top, box.h);
    const r = parseSide(right, box.w);
    const bo = parseSide(bottom, box.h);
    const l = parseSide(left, box.w);
    if (t === null || r === null || bo === null || l === null) return false;
    return box.w - l - r <= 0.25 || box.h - t - bo <= 0.25;
  };

  // src/css/length.ts
  var parsePx = (value) => {
    const match = /^(-?\d*\.?\d+)px$/.exec(value.trim());
    if (match?.[1] === void 0) return 0;
    return Number.parseFloat(match[1]);
  };

  // src/css/corner.ts
  var parsePercent = (value) => {
    const match = /^(-?\d*\.?\d+)%$/.exec(value.trim());
    return match?.[1] === void 0 ? null : Number.parseFloat(match[1]) / 100;
  };
  var radiiOf = (value, box) => {
    const parts = value.trim().split(/\s+/);
    const first = parts[0] ?? "0px";
    const second = parts[1] ?? first;
    const resolve = (raw, basis) => {
      const percent = parsePercent(raw);
      return percent === null ? parsePx(raw) : percent * basis;
    };
    return { x: resolve(first, box.w), y: resolve(second, box.h) };
  };
  var readCorner = (cs, box) => ({
    tl: radiiOf(cs.borderTopLeftRadius, box).x,
    tr: radiiOf(cs.borderTopRightRadius, box).x,
    br: radiiOf(cs.borderBottomRightRadius, box).x,
    bl: radiiOf(cs.borderBottomLeftRadius, box).x
  });
  var isEllipticalCorner = (cs, box) => [
    cs.borderTopLeftRadius,
    cs.borderTopRightRadius,
    cs.borderBottomRightRadius,
    cs.borderBottomLeftRadius
  ].some((value) => {
    const { x, y } = radiiOf(value, box);
    return Math.abs(x - y) > 0.5;
  });

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
    const px2 = /^(-?[\d.]+)px$/.exec(text);
    if (px2?.[1] !== void 0) return Number.parseFloat(px2[1]) / length;
    return null;
  };
  var resolveOffsets = (raws) => {
    const offsets = raws.map((stop) => stop.offset);
    if (offsets[0] === null) offsets[0] = 0;
    const last = offsets.length - 1;
    if (offsets[last] === null) offsets[last] = 1;
    let index2 = 0;
    while (index2 < offsets.length) {
      if (offsets[index2] !== null) {
        index2 += 1;
        continue;
      }
      let end = index2;
      while (end < offsets.length && offsets[end] === null) end += 1;
      const before = offsets[index2 - 1] ?? 0;
      const after = offsets[end] ?? 1;
      const gapCount = end - index2 + 1;
      for (let step = 0; step < end - index2; step += 1) {
        offsets[index2 + step] = before + (after - before) * (step + 1) / gapCount;
      }
      index2 = end;
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
  var SIZE_KEYWORDS = /* @__PURE__ */ new Set([
    "closest-side",
    "farthest-side",
    "closest-corner",
    "farthest-corner"
  ]);
  var POSITION_KEYWORDS = {
    left: 0,
    top: 0,
    center: 0.5,
    right: 1,
    bottom: 1
  };
  var positionPart = (raw, basis) => {
    const text = raw.trim().toLowerCase();
    const keyword = POSITION_KEYWORDS[text];
    if (keyword !== void 0) return keyword;
    const pct = /^(-?[\d.]+)%$/.exec(text);
    if (pct?.[1] !== void 0) return Number.parseFloat(pct[1]) / 100;
    const px2 = /^(-?[\d.]+)px$/.exec(text);
    if (px2?.[1] !== void 0) return Number.parseFloat(px2[1]) / basis;
    return null;
  };
  var parseRadialSpec = (raw, box) => {
    const text = raw.trim().toLowerCase();
    if (text === "") return null;
    const [before, after] = text.split(/\s+at\s+/);
    if (before === void 0) return null;
    let center = { x: 0.5, y: 0.5 };
    if (after !== void 0) {
      const parts = after.trim().split(/\s+/);
      const first = parts[0];
      if (first === void 0) return null;
      const x = positionPart(first, box.w);
      const y = parts[1] === void 0 ? 0.5 : positionPart(parts[1], box.h);
      if (x === null || y === null) return null;
      center = { x, y };
    }
    const words = before.trim() === "" ? [] : before.trim().split(/\s+/);
    let shape = "ellipse";
    const lengths = [];
    let keyword = null;
    for (const word of words) {
      if (word === "circle") {
        shape = "circle";
        continue;
      }
      if (word === "ellipse") {
        shape = "ellipse";
        continue;
      }
      if (SIZE_KEYWORDS.has(word)) {
        keyword = { kind: "keyword", value: word };
        continue;
      }
      const px2 = /^(-?[\d.]+)px$/.exec(word);
      if (px2?.[1] !== void 0) {
        lengths.push(Number.parseFloat(px2[1]));
        continue;
      }
      const pct = /^(-?[\d.]+)%$/.exec(word);
      if (pct?.[1] !== void 0) {
        const basis = lengths.length === 0 ? box.w : box.h;
        lengths.push(Number.parseFloat(pct[1]) / 100 * basis);
        continue;
      }
      if (after === void 0) return null;
      return null;
    }
    if (words.length === 0 && after === void 0) return null;
    if (lengths.length > 0) {
      const rx = lengths[0];
      if (rx === void 0) return null;
      const ry = lengths[1] ?? rx;
      return { shape, size: { kind: "explicit", rx, ry }, center };
    }
    return {
      shape,
      size: keyword ?? { kind: "keyword", value: "farthest-corner" },
      center
    };
  };
  var radiiFor = (spec, box) => {
    if (spec.size.kind === "explicit") {
      return { rx: spec.size.rx, ry: spec.size.ry };
    }
    const cx = spec.center.x * box.w;
    const cy = spec.center.y * box.h;
    const left = Math.abs(cx);
    const right = Math.abs(box.w - cx);
    const top = Math.abs(cy);
    const bottom = Math.abs(box.h - cy);
    const closestSide = spec.shape === "circle" ? { rx: Math.min(left, right, top, bottom), ry: Math.min(left, right, top, bottom) } : { rx: Math.min(left, right), ry: Math.min(top, bottom) };
    const farthestSide = spec.shape === "circle" ? { rx: Math.max(left, right, top, bottom), ry: Math.max(left, right, top, bottom) } : { rx: Math.max(left, right), ry: Math.max(top, bottom) };
    if (spec.size.value === "closest-side") return closestSide;
    if (spec.size.value === "farthest-side") return farthestSide;
    const corner = spec.size.value === "closest-corner" ? { dx: Math.min(left, right), dy: Math.min(top, bottom) } : { dx: Math.max(left, right), dy: Math.max(top, bottom) };
    if (spec.shape === "circle") {
      const r = Math.hypot(corner.dx, corner.dy);
      return { rx: r, ry: r };
    }
    const base = spec.size.value === "closest-corner" ? closestSide : farthestSide;
    if (base.rx === 0 || base.ry === 0) return base;
    const scale = Math.hypot(corner.dx / base.rx, corner.dy / base.ry);
    return { rx: base.rx * scale, ry: base.ry * scale };
  };
  var parseRadialGradient = (value, box) => {
    const text = value.trim();
    if (!/^radial-gradient\(/i.test(text)) return null;
    if (box.w <= 0 || box.h <= 0) return null;
    const inner = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
    const args = splitTopLevel(inner);
    if (args.length === 0) return null;
    const firstArg = args[0];
    if (firstArg === void 0) return null;
    const spec = parseRadialSpec(firstArg, box) ?? {
      shape: "ellipse",
      size: { kind: "keyword", value: "farthest-corner" },
      center: { x: 0.5, y: 0.5 }
    };
    const stopArgs = parseRadialSpec(firstArg, box) === null ? args : args.slice(1);
    if (stopArgs.length < 2) return null;
    const { rx, ry } = radiiFor(spec, box);
    if (rx <= 0 || ry <= 0) return null;
    const raws = [];
    for (const arg of stopArgs) {
      const { color: colorText, position } = splitStop(arg);
      const color = parseColor(colorText);
      if (color === null) return null;
      raws.push({ color, offset: parsePosition(position, rx) });
    }
    return {
      kind: "radial",
      center: spec.center,
      radius: { x: rx / box.w, y: ry / box.h },
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
    const px2 = /^(-?[\d.]+)px$/.exec(part);
    if (px2 !== null) {
      const value = Number.parseFloat(px2[1] ?? "");
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
    const px2 = /^(-?[\d.]+)px$/.exec(part);
    if (px2 !== null) {
      const value = Number.parseFloat(px2[1] ?? "");
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

  // src/counters.ts
  var parsePairs = (value, fallback) => {
    if (value === "none" || value === "" || value === "normal") return [];
    const parts = value.trim().split(/\s+/);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      if (name === void 0) continue;
      const next = parts[i + 1];
      const parsed = next === void 0 ? Number.NaN : Number.parseInt(next, 10);
      if (Number.isFinite(parsed)) {
        out.push([name, parsed]);
        i += 1;
      } else {
        out.push([name, fallback]);
      }
    }
    return out;
  };
  var applyReset = (state, value) => {
    for (const [name, start] of parsePairs(value, 0)) {
      const stack = state.get(name) ?? [];
      stack.push(start);
      state.set(name, stack);
    }
  };
  var applyIncrement = (state, value) => {
    for (const [name, delta] of parsePairs(value, 1)) {
      const stack = state.get(name);
      if (stack === void 0 || stack.length === 0) {
        state.set(name, [delta]);
        continue;
      }
      stack[stack.length - 1] = (stack[stack.length - 1] ?? 0) + delta;
    }
  };
  var snapshot = (state) => {
    const out = /* @__PURE__ */ new Map();
    for (const [name, stack] of state) {
      const top = stack[stack.length - 1];
      if (top !== void 0) out.set(name, top);
    }
    return out;
  };
  var allOf = (state) => {
    const out = /* @__PURE__ */ new Map();
    for (const [name, stack] of state) out.set(name, [...stack]);
    return out;
  };
  var computeCounters = (root) => {
    const map = /* @__PURE__ */ new WeakMap();
    const state = /* @__PURE__ */ new Map();
    const visit = (el) => {
      const cs = window.getComputedStyle(el);
      applyReset(state, cs.counterReset);
      applyIncrement(state, cs.counterIncrement);
      const beforeCs = window.getComputedStyle(el, "::before");
      applyReset(state, beforeCs.counterReset);
      applyIncrement(state, beforeCs.counterIncrement);
      const before = { top: snapshot(state), chain: allOf(state) };
      const depths = /* @__PURE__ */ new Map();
      for (const [name, stack] of state) depths.set(name, stack.length);
      for (const child of el.children) visit(child);
      for (const [name, stack] of state) {
        const depth = depths.get(name) ?? 0;
        if (stack.length > depth) stack.length = depth;
        if (stack.length === 0) state.delete(name);
      }
      const afterCs = window.getComputedStyle(el, "::after");
      applyReset(state, afterCs.counterReset);
      applyIncrement(state, afterCs.counterIncrement);
      const after = { top: snapshot(state), chain: allOf(state) };
      map.set(el, { before, after });
    };
    visit(root);
    return map;
  };
  var ROMAN = [
    [1e3, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  var roman = (value) => {
    if (value <= 0 || value > 3999) return String(value);
    let left = value;
    let out = "";
    for (const [amount, letters] of ROMAN) {
      while (left >= amount) {
        out += letters;
        left -= amount;
      }
    }
    return out;
  };
  var alpha = (value) => {
    if (value <= 0) return String(value);
    let left = value;
    let out = "";
    while (left > 0) {
      const rest = (left - 1) % 26;
      out = String.fromCharCode(97 + rest) + out;
      left = Math.floor((left - 1) / 26);
    }
    return out;
  };
  var formatCounter = (value, style) => {
    switch (style.trim()) {
      case "decimal-leading-zero":
        return value < 10 && value >= 0 ? `0${value}` : String(value);
      case "lower-alpha":
      case "lower-latin":
        return alpha(value);
      case "upper-alpha":
      case "upper-latin":
        return alpha(value).toUpperCase();
      case "lower-roman":
        return roman(value);
      case "upper-roman":
        return roman(value).toUpperCase();
      default:
        return String(value);
    }
  };

  // src/hoist.ts
  var overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  var index = (root) => {
    const map = /* @__PURE__ */ new Map();
    const visit = (node, at, path) => {
      const abs = {
        x: at.x + node.rect.x,
        y: at.y + node.rect.y,
        w: node.rect.w,
        h: node.rect.h
      };
      map.set(node.id, { node, abs, path });
      const next = [...path, node];
      for (const child of node.children) visit(child, { x: abs.x, y: abs.y }, next);
    };
    visit(root, { x: 0, y: 0 }, []);
    return map;
  };
  var descendantsOf = (node) => {
    const out = [];
    const visit = (current) => {
      for (const child of current.children) {
        out.push(child);
        visit(child);
      }
    };
    visit(node);
    return out;
  };
  var nestedOrder = (root) => {
    const out = /* @__PURE__ */ new Map();
    let counter = 0;
    const visit = (node) => {
      out.set(node.id, counter);
      counter += 1;
      for (const child of [...node.children].sort(
        (a, b) => a.paintOrder - b.paintOrder
      )) visit(child);
    };
    visit(root);
    return out;
  };
  var needsHoist = (subject, nested, all) => {
    const mine = nested.get(subject.node.id);
    if (mine === void 0) return false;
    const inside = new Set(
      [subject.node, ...descendantsOf(subject.node)].map((node) => node.id)
    );
    return all.some((other) => {
      if (inside.has(other.node.id)) return false;
      const theirs = nested.get(other.node.id);
      if (theirs === void 0) return false;
      if (theirs <= mine) return false;
      if (other.node.paintOrder >= subject.node.paintOrder) return false;
      return overlaps(other.abs, subject.abs);
    });
  };
  var targetFor = (path) => {
    for (let i = path.length - 1; i >= 0; i -= 1) {
      const candidate = path[i];
      if (candidate === void 0) continue;
      if (candidate.isStackingContext || i === 0) return candidate;
    }
    return null;
  };
  var hoistEscaped = (root) => {
    const hoisted = [];
    const blocked = /* @__PURE__ */ new Set();
    for (let pass = 0; pass < 4; pass += 1) {
      const placed = index(root);
      const all = [...placed.values()];
      const nested = nestedOrder(root);
      const moves = [];
      for (const entry of all) {
        const parent = entry.path[entry.path.length - 1];
        if (parent === void 0) continue;
        if (blocked.has(entry.node.id)) continue;
        if (!needsHoist(entry, nested, all)) continue;
        const target = targetFor(entry.path);
        if (target === null || target.id === parent.id) continue;
        const fromIndex = entry.path.findIndex((node) => node.id === target.id);
        if (fromIndex < 0) continue;
        const between = entry.path.slice(fromIndex + 1);
        if (between.some((node) => node.transform !== null)) {
          blocked.add(entry.node.id);
          continue;
        }
        const offset = between.reduce(
          (acc, node) => ({ x: acc.x + node.rect.x, y: acc.y + node.rect.y }),
          { x: 0, y: 0 }
        );
        moves.push({ node: entry.node, from: parent, to: target, offset });
      }
      if (moves.length === 0) break;
      for (const move of moves) {
        const at = move.from.children.indexOf(move.node);
        if (at < 0) continue;
        move.from.children.splice(at, 1);
        move.node.rect = {
          ...move.node.rect,
          x: move.node.rect.x + move.offset.x,
          y: move.node.rect.y + move.offset.y
        };
        move.to.children.push(move.node);
        hoisted.push({ id: move.node.id, toId: move.to.id });
      }
    }
    const finalPlaced = index(root);
    const finalNested = nestedOrder(root);
    const finalAll = [...finalPlaced.values()];
    const stillWrong = [];
    for (const entry of finalAll) {
      if (blocked.has(entry.node.id)) continue;
      if (needsHoist(entry, finalNested, finalAll)) stillWrong.push(entry.node.id);
    }
    return { root, hoisted, blockedByTransform: [...blocked], stillWrong };
  };

  // src/pseudo.ts
  var px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  var expandContent = (content, counters, host) => {
    const parts = splitContentParts(content);
    if (parts.length === 0) return null;
    let out = "";
    for (const part of parts) {
      const literal = quotedLiteral(part);
      if (literal !== null) {
        out += literal;
        continue;
      }
      const single = /^counter\(\s*([\w-]+)\s*(?:,\s*([\w-]+)\s*)?\)$/.exec(part);
      if (single?.[1] !== void 0) {
        const value = counters.top.get(single[1]) ?? 0;
        out += formatCounter(value, single[2] ?? "decimal");
        continue;
      }
      const nested = /^counters\(\s*([\w-]+)\s*,\s*("[^"]*")\s*(?:,\s*([\w-]+)\s*)?\)$/.exec(part);
      if (nested?.[1] !== void 0 && nested[2] !== void 0) {
        const chain = counters.chain.get(nested[1]) ?? [0];
        const separator = quotedLiteral(nested[2]) ?? "";
        out += chain.map((value) => formatCounter(value, nested[3] ?? "decimal")).join(separator);
        continue;
      }
      const attribute = /^attr\(\s*([\w-]+)\s*\)$/.exec(part);
      if (attribute?.[1] !== void 0) {
        out += host.getAttribute(attribute[1]) ?? "";
        continue;
      }
      return null;
    }
    return out;
  };
  var splitContentParts = (content) => {
    const parts = [];
    let current = "";
    let inQuotes = false;
    let depth = 0;
    for (const ch of content.trim()) {
      if (ch === '"') {
        inQuotes = !inQuotes;
        current += ch;
        continue;
      }
      if (!inQuotes && ch === "(") depth += 1;
      if (!inQuotes && ch === ")") depth -= 1;
      if (!inQuotes && depth === 0 && /\s/.test(ch)) {
        if (current !== "") {
          parts.push(current);
          current = "";
        }
        continue;
      }
      current += ch;
    }
    if (current !== "") parts.push(current);
    return parts;
  };
  var quotedLiteral = (part) => {
    const text = part.trim();
    if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return null;
    return text.slice(1, -1).replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\(.)/g, "$1");
  };
  var literalOf = (content) => {
    const trimmed = content.trim();
    if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return null;
    if (trimmed.length < 2) return null;
    return trimmed.slice(1, -1).replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\(.)/g, "$1");
  };
  var hasVisibleText = (value) => (
    // eslint-disable-next-line no-control-regex
    value.replace(/[\s ​-‍⁠﻿\u0000-\u001f]/g, "") !== ""
  );
  var isPaintedColor = (color) => color !== null && color.a > 0;
  var DECORATION = {
    underline: "underline",
    "line-through": "strikethrough"
  };
  var decorationOf = (cs) => {
    const line = cs.textDecorationLine;
    for (const [key, value] of Object.entries(DECORATION)) {
      if (line.includes(key)) return value;
    }
    return "none";
  };
  var containingBlockOf = (host, cs, hostCs) => {
    const hostRect = host.getBoundingClientRect();
    if (hostCs.transform !== "none") return null;
    if (cs.position === "fixed") {
      return { x: 0, y: 0, hostX: hostRect.left, hostY: hostRect.top };
    }
    if (hostCs.position !== "static") {
      return {
        x: hostRect.left + (Number.parseFloat(hostCs.borderLeftWidth) || 0),
        y: hostRect.top + (Number.parseFloat(hostCs.borderTopWidth) || 0),
        hostX: hostRect.left,
        hostY: hostRect.top
      };
    }
    const parent = host.offsetParent;
    if (parent === null) return null;
    const parentCs = window.getComputedStyle(parent);
    if (parentCs.transform !== "none") return null;
    const parentRect = parent.getBoundingClientRect();
    return {
      x: parentRect.left + (Number.parseFloat(parentCs.borderLeftWidth) || 0),
      y: parentRect.top + (Number.parseFloat(parentCs.borderTopWidth) || 0),
      hostX: hostRect.left,
      hostY: hostRect.top
    };
  };
  var readPseudo = (host, hostCs, which, counters) => {
    const cs = window.getComputedStyle(host, which);
    const content = cs.content;
    if (content === "none" || content === "normal" || content === "") {
      return { kind: "absent" };
    }
    if (cs.display === "none" || Number.parseFloat(cs.opacity) === 0) {
      return { kind: "absent" };
    }
    const background = parseColor(cs.backgroundColor);
    const borderWidth = Math.max(
      px(cs.borderTopWidth) ?? 0,
      px(cs.borderRightWidth) ?? 0,
      px(cs.borderBottomWidth) ?? 0,
      px(cs.borderLeftWidth) ?? 0
    );
    const hasPaint = isPaintedColor(background) || borderWidth > 0 && isPaintedColor(parseColor(cs.borderTopColor)) || cs.backgroundImage !== "none" || cs.boxShadow !== "none";
    const literal = counters === null ? literalOf(content) : expandContent(content, counters, host);
    const visibleText = literal !== null && hasVisibleText(literal);
    const generated = literal === null && content.trim() !== '""';
    if (!hasPaint && !visibleText && !generated) return { kind: "empty" };
    const positioned = cs.position === "absolute" || cs.position === "fixed";
    if (!positioned) {
      return { kind: "refused", refusal: { reason: "flow" }, hasPaint };
    }
    const container = containingBlockOf(host, cs, hostCs);
    if (container === null) {
      return { kind: "refused", refusal: { reason: "containing-block" }, hasPaint };
    }
    const left = px(cs.left);
    const top = px(cs.top);
    const width = px(cs.width);
    const height = px(cs.height);
    if (left === null || top === null || width === null || height === null) {
      return { kind: "refused", refusal: { reason: "flow" }, hasPaint };
    }
    if (generated && !hasPaint) {
      return {
        kind: "refused",
        refusal: { reason: "generated", content: content.trim() },
        hasPaint
      };
    }
    const padX = (px(cs.paddingLeft) ?? 0) + (px(cs.paddingRight) ?? 0);
    const padY = (px(cs.paddingTop) ?? 0) + (px(cs.paddingBottom) ?? 0);
    const borderX = (px(cs.borderLeftWidth) ?? 0) + (px(cs.borderRightWidth) ?? 0);
    const borderY = (px(cs.borderTopWidth) ?? 0) + (px(cs.borderBottomWidth) ?? 0);
    const box = {
      x: container.x + left - container.hostX,
      y: container.y + top - container.hostY,
      w: width + padX + borderX,
      h: height + padY + borderY
    };
    if (generated) {
      return {
        kind: "node",
        box,
        text: null,
        lostText: { reason: "generated", content: content.trim() }
      };
    }
    if (!visibleText || literal === null) return { kind: "node", box, text: null };
    const lineHeight = px(cs.lineHeight) ?? (px(cs.fontSize) ?? 16) * 1.2;
    if (height > lineHeight * 1.5) {
      if (hasPaint) {
        return {
          kind: "node",
          box,
          text: null,
          lostText: { reason: "multiline", content: literal }
        };
      }
      return {
        kind: "refused",
        refusal: { reason: "multiline", content: literal },
        hasPaint
      };
    }
    const color = parseColor(cs.color) ?? { r: 0, g: 0, b: 0, a: 1 };
    const run = {
      text: literal,
      fontStack: cs.fontFamily.split(",").map((name) => name.trim().replace(/^["']|["']$/g, "")),
      usedFamily: cs.fontFamily.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "sans-serif",
      fontWeight: Number.parseInt(cs.fontWeight, 10) || 400,
      fontStyle: cs.fontStyle === "italic" ? "italic" : "normal",
      fontSize: px(cs.fontSize) ?? 16,
      letterSpacing: px(cs.letterSpacing) ?? 0,
      color,
      decoration: decorationOf(cs),
      shadows: []
    };
    const align = ["left", "right", "center", "justify"].find((value) => cs.textAlign === value) ?? "left";
    return {
      kind: "node",
      box,
      text: { characters: literal, run, lineHeight, align }
    };
  };

  // src/vector.ts
  var SVG_NS = "http://www.w3.org/2000/svg";
  var PRESENTATION = [
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-opacity",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-dasharray",
    "stroke-dashoffset",
    "opacity",
    "clip-rule"
  ];
  var STOP_PRESENTATION = ["stop-color", "stop-opacity", "opacity"];
  var NON_PAINTING = /* @__PURE__ */ new Set([
    "defs",
    "lineargradient",
    "radialgradient",
    "clippath",
    "mask",
    "filter",
    "title",
    "desc",
    "metadata",
    "style",
    "script",
    "symbol",
    "marker",
    "pattern",
    "switch",
    "animate",
    "animatetransform",
    "animatemotion",
    "set"
  ]);
  var stripPx = (value) => /^-?[\d.]+px$/.test(value) ? value.slice(0, -2) : value;
  var unquoteIri = (value) => value.replace(/url\(\s*["']([^"']*)["']\s*\)/g, "url($1)");
  var REFERENCING = [
    "href",
    "xlink:href",
    "fill",
    "stroke",
    "clip-path",
    "mask",
    "filter",
    "marker-start",
    "marker-mid",
    "marker-end"
  ];
  var useTarget = (el) => {
    const raw = el.getAttribute("href") ?? el.getAttribute("xlink:href");
    return raw !== null && raw.startsWith("#") ? raw.slice(1) : null;
  };
  var resolveUses = (clone, source) => {
    const doc = source.ownerDocument;
    const defs = clone.ownerDocument.createElementNS(SVG_NS, "defs");
    const brought = /* @__PURE__ */ new Set();
    let pending = Array.from(clone.querySelectorAll("use"));
    for (let depth = 0; depth < 4 && pending.length > 0; depth += 1) {
      const next = [];
      for (const use of pending) {
        const id = useTarget(use);
        if (id === null || brought.has(id)) continue;
        if (clone.querySelector(`#${CSS.escape(id)}`) !== null) {
          brought.add(id);
          continue;
        }
        const referenced = doc.getElementById(id);
        if (referenced === null) continue;
        brought.add(id);
        const copy = referenced.cloneNode(true);
        defs.appendChild(copy);
        next.push(...Array.from(copy.querySelectorAll("use")));
      }
      pending = next;
    }
    if (defs.childNodes.length > 0) clone.insertBefore(defs, clone.firstChild);
  };
  var namespaceIds = (clone, prefix) => {
    const renamed = /* @__PURE__ */ new Map();
    const all = [clone, ...Array.from(clone.querySelectorAll("*"))];
    for (const el of all) {
      const id = el.getAttribute("id");
      if (id === null || id === "") continue;
      const fresh = `${prefix}-${id}`;
      renamed.set(id, fresh);
      el.setAttribute("id", fresh);
    }
    if (renamed.size === 0) return;
    for (const el of all) {
      for (const attribute of REFERENCING) {
        const value = el.getAttribute(attribute);
        if (value === null || !value.includes("#")) continue;
        let next = value;
        for (const [from, to] of renamed) {
          next = next.split(`url(#${from})`).join(`url(#${to})`).split(`url("#${from}")`).join(`url("#${to}")`);
          if (next === `#${from}`) next = `#${to}`;
        }
        if (next !== value) el.setAttribute(attribute, next);
      }
    }
  };
  var readVector = (el, size, prefix) => {
    if (el.namespaceURI !== SVG_NS || el.tagName.toLowerCase() !== "svg") return null;
    const clone = el.cloneNode(true);
    const originals = [el, ...Array.from(el.querySelectorAll("*"))];
    const clones = [clone, ...Array.from(clone.querySelectorAll("*"))];
    if (originals.length !== clones.length) return null;
    const collisions = [];
    for (const source of originals) {
      const own = source.getAttribute("id");
      if (own === null || own === "") continue;
      if (source.ownerDocument.getElementById(own) !== source) collisions.push(own);
    }
    for (let i = 0; i < originals.length; i += 1) {
      const source = originals[i];
      const target = clones[i];
      if (source === void 0 || target === void 0) continue;
      const tag = source.tagName.toLowerCase();
      const computed = window.getComputedStyle(source);
      const properties = tag === "stop" ? STOP_PRESENTATION : NON_PAINTING.has(tag) ? [] : PRESENTATION;
      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        if (value === "") continue;
        target.setAttribute(property, unquoteIri(stripPx(value)));
      }
      target.removeAttribute("style");
      target.removeAttribute("class");
    }
    resolveUses(clone, el);
    namespaceIds(clone, prefix);
    clone.setAttribute("width", String(size.w));
    clone.setAttribute("height", String(size.h));
    if (!clone.hasAttribute("viewBox")) {
      clone.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
    }
    clone.setAttribute("xmlns", SVG_NS);
    const svg = new XMLSerializer().serializeToString(clone);
    return svg.length > 0 ? { source: { svg }, collidingIds: collisions } : null;
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
    if (display === "grid" || display === "inline-grid") return "grid";
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
  var isPseudoContext = (p) => isStackingParticipant(p) && !establishesStackingContext(p);
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
  var byZIndex = (items) => items.map((item, index2) => ({ item, index: index2 })).sort((a, b) => zValue(a.item) - zValue(b.item) || a.index - b.index).map(({ item }) => item);
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
          if (isPseudoContext(child)) collectEscaping(child, groups);
          continue;
        }
        groups[bucketOf(child)].push(child);
        collectInto(child, groups);
      }
    };
    const collectEscaping = (node, groups) => {
      for (const child of node.children) {
        if (establishesStackingContext(child) || isStackingParticipant(child)) {
          groups[bucketOf(child)].push(child);
          if (isPseudoContext(child)) collectEscaping(child, groups);
          continue;
        }
        collectEscaping(child, groups);
      }
    };
    const collectLocal = (node, groups) => {
      for (const child of node.children) {
        if (establishesStackingContext(child) || isStackingParticipant(child)) continue;
        groups[bucketOf(child)].push(child);
        collectLocal(child, groups);
      }
    };
    const paintFlowNode = (p) => {
      emit(p);
    };
    const paintUnit = (p) => {
      emit(p);
      const groups = emptyGroups();
      if (isPseudoContext(p)) collectLocal(p, groups);
      else collectInto(p, groups);
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

  // src/text.ts
  var ALIGN_MAP2 = {
    left: "left",
    start: "left",
    center: "center",
    right: "right",
    end: "right",
    justify: "justify"
  };
  var decorationOf2 = (cs) => {
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
      for (const [index2, rect] of rects.entries()) {
        const raw = sliceForRect(node, rect, cursor);
        cursor += raw.length;
        const visible = trimAtLineBreaks(
          collapseWhiteSpace(raw, cs),
          cs,
          index2 > 0,
          index2 < rects.length - 1
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
      decoration: decorationOf2(cs),
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
    if (rect.width <= 0 && rect.height <= 0) return false;
    return !clipsAwayEverything(cs.clipPath, { w: rect.width, h: rect.height });
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
    const px2 = (value) => Number.parseFloat(value) || 0;
    const margin = {
      top: px2(cs.marginTop),
      right: px2(cs.marginRight),
      bottom: px2(cs.marginBottom),
      left: px2(cs.marginLeft)
    };
    return {
      positioning,
      align: rawAlign === "auto" ? null : ALIGN_SELF[rawAlign] ?? null,
      grow: Number.parseFloat(cs.flexGrow) || 0,
      shrink: Number.isNaN(Number.parseFloat(cs.flexShrink)) ? 1 : Number.parseFloat(cs.flexShrink),
      margin,
      marginAuto: {
        horizontal: margin.left > 0 && Math.abs(margin.left - margin.right) < 0.5,
        vertical: margin.top > 0 && Math.abs(margin.top - margin.bottom) < 0.5
      }
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
    const px2 = (value) => Number.parseFloat(value) || 0;
    let left = px2(cs.borderLeftWidth);
    let top = px2(cs.borderTopWidth);
    let right = px2(cs.borderRightWidth);
    let bottom = px2(cs.borderBottomWidth);
    if (origin === "content-box") {
      left += px2(cs.paddingLeft);
      top += px2(cs.paddingTop);
      right += px2(cs.paddingRight);
      bottom += px2(cs.paddingBottom);
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
        const gradient = parseLinearGradient(cs.backgroundImage, box) ?? parseRadialGradient(cs.backgroundImage, box);
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
    if (isEllipticalCorner(cs, box)) {
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
      corner: readCorner(cs, box),
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
          const box = { w: rect.width, h: rect.height };
          const parsed = parseLinearGradient(cs.backgroundImage, box) ?? parseRadialGradient(cs.backgroundImage, box);
          if (parsed === null) {
            const repeating = cs.backgroundImage.includes("repeating-");
            sink.report(
              repeating ? "warning" : "info",
              repeating ? DIAGNOSTIC_CODES.unsupportedRepeatingGradient : DIAGNOSTIC_CODES.deferredGradient,
              `background-image "${cs.backgroundImage.slice(0, 60)}" \u043D\u0435 \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u0442\u0441\u044F: \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0430\u043D\u044B linear-gradient \u0438 radial-gradient, \u043A\u043E\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0439 \u2014 \u043D\u0435\u0442, \u0435\u0433\u043E \u043D\u0435\u0447\u0435\u043C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C (\u0432 SVG \u0442\u0430\u043A\u043E\u0433\u043E \u0433\u0440\u0430\u0434\u0438\u0435\u043D\u0442\u0430 \u043D\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442).`,
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
  var SVG_NS2 = "http://www.w3.org/2000/svg";
  var buildPseudo = (el, hostCs, which, hostBox, ctx, hostId) => {
    const values = ctx.counters.get(el);
    const read = readPseudo(
      el,
      hostCs,
      which,
      which === "::before" ? values?.before ?? null : values?.after ?? null
    );
    if (read.kind === "absent" || read.kind === "empty") return null;
    if (read.kind === "refused") {
      reportPseudoRefusal(read, which, ctx.sink, hostId);
      return null;
    }
    const id = ctx.allocId();
    const cs = window.getComputedStyle(el, which);
    const borderLeft = Number.parseFloat(hostCs.borderLeftWidth) || 0;
    const borderTop = Number.parseFloat(hostCs.borderTopWidth) || 0;
    const rect = {
      x: borderLeft + read.box.x,
      y: borderTop + read.box.y,
      w: read.box.w,
      h: read.box.h
    };
    const inset = (side) => (Number.parseFloat(cs.getPropertyValue(`padding-${side}`)) || 0) + (Number.parseFloat(cs.getPropertyValue(`border-${side}-width`)) || 0);
    const contentInset = {
      top: inset("top"),
      right: inset("right"),
      bottom: inset("bottom"),
      left: inset("left")
    };
    const base = {
      id,
      /** Имя говорит, откуда узел взялся: в панели слоёв Figma иначе
       *  появится безымянная коробка, которой нет в разметке. */
      sourceTag: which === "::before" ? "before" : "after",
      name: which,
      rect,
      paintOrder: -1,
      isStackingContext: false,
      transform: null,
      layout: readLayout(cs),
      selfLayout: readSelfLayout(cs),
      style: readStyle(cs, rect, ctx.sink, id, ctx.requests, ctx.screenId),
      children: []
    };
    if (read.lostText !== void 0) {
      reportPseudoRefusal(
        { refusal: read.lostText, hasPaint: true },
        which,
        ctx.sink,
        hostId
      );
    }
    const node = read.text === null ? { ...base, kind: "frame" } : {
      ...base,
      kind: "text",
      text: {
        runs: [read.text.run],
        /** Строка одна — это проверено при разборе, а не
         *  предположено: многострочный псевдоэлемент сюда не
         *  доходит. Но лежит она в CONTENT box, а не в боксе узла:
         *  у бейджа с `padding: 2px 6px` текст иначе уехал бы в
         *  левый верхний угол своей же подложки. */
        lines: [{
          x: contentInset.left,
          y: contentInset.top,
          w: rect.w - contentInset.left - contentInset.right,
          h: rect.h - contentInset.top - contentInset.bottom,
          text: read.text.characters
        }],
        lineHeight: read.text.lineHeight,
        align: read.text.align
      }
    };
    const probe = {
      ...readProbe(el, cs, hostCs),
      id,
      children: []
    };
    return { node, probe };
  };
  var reportPseudoRefusal = (read, which, sink, hostId) => {
    const { refusal } = read;
    if (refusal.reason === "multiline") {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.deferredPseudoElement,
        `\u041F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442 ${which} \u043D\u0435\u0441\u0451\u0442 \u0442\u0435\u043A\u0441\u0442 "${refusal.content.slice(0, 40)}" \u0432 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0442\u0440\u043E\u043A. \u0411\u043E\u043A\u0441\u043E\u0432 \u0441\u0442\u0440\u043E\u043A \u0443 \u043F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u043D\u0435\u0442, \u0438 \u043C\u0435\u0441\u0442\u043E \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u043E\u0432 \u0432\u0437\u044F\u0442\u044C \u043D\u0435\u043E\u0442\u043A\u0443\u0434\u0430 \u2014 \u043F\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0439 \u043D\u0430\u0443\u0433\u0430\u0434 \u0442\u0435\u043A\u0441\u0442 \u0432\u044B\u0433\u043B\u044F\u0434\u0435\u043B \u0431\u044B \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0451\u043D\u043D\u044B\u043C.`,
        hostId,
        false
      );
      return;
    }
    if (refusal.reason === "generated") {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.deferredPseudoElement,
        `\u041F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442 ${which} \u043D\u0435\u0441\u0451\u0442 \u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 ${refusal.content.slice(0, 40)}. \u0412\u044B\u0447\u0438\u0441\u043B\u0435\u043D\u043D\u044B\u0439 \u0441\u0442\u0438\u043B\u044C \u043E\u0442\u0434\u0430\u0451\u0442 \u0435\u0433\u043E \u043A\u0430\u043A \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E, \u0431\u0435\u0437 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F: \u043D\u043E\u043C\u0435\u0440 \u0441\u0447\u0451\u0442\u0447\u0438\u043A\u0430 \u0438\u043B\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435 \u0430\u0442\u0440\u0438\u0431\u0443\u0442\u0430 \u0432\u0437\u044F\u0442\u044C \u043D\u0435\u043E\u0442\u043A\u0443\u0434\u0430, \u0430 \u043F\u043E\u0434\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u0430\u044F \u0434\u043E\u0433\u0430\u0434\u043A\u0430 \u043D\u0430\u043F\u0438\u0441\u0430\u043B\u0430 \u0431\u044B \u0432 \u043C\u0430\u043A\u0435\u0442\u0435 \u043D\u0435\u0432\u0435\u0440\u043D\u043E\u0435 \u0447\u0438\u0441\u043B\u043E.`,
        hostId,
        false
      );
      return;
    }
    if (refusal.reason === "containing-block") {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.deferredPseudoElement,
        `\u041F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442 ${which} \u043F\u043E\u0437\u0438\u0446\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D \u043D\u0435 \u043E\u0442 \u0441\u0432\u043E\u0435\u0433\u043E \u0445\u043E\u0437\u044F\u0438\u043D\u0430 (position: fixed \u0438\u043B\u0438 \u0445\u043E\u0437\u044F\u0438\u043D \u043D\u0435 \u043F\u043E\u0437\u0438\u0446\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D), \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0435\u0433\u043E \u043A\u043E\u043E\u0440\u0434\u0438\u043D\u0430\u0442\u044B \u043E\u0442\u0441\u0447\u0438\u0442\u0430\u043D\u044B \u043E\u0442 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u0438 \u0441\u043B\u043E\u0436\u0438\u0442\u044C \u0438\u0445 \u043D\u0435 \u0441 \u0447\u0435\u043C.`,
        hostId,
        false
      );
      return;
    }
    sink.report(
      read.hasPaint ? "warning" : "info",
      DIAGNOSTIC_CODES.deferredPseudoElement,
      `\u041F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442 ${which} \u0441\u0442\u043E\u0438\u0442 \u0432 \u043F\u043E\u0442\u043E\u043A\u0435, \u0430 \u043D\u0435 \u043F\u043E\u0437\u0438\u0446\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D. \u0423 \u043F\u0441\u0435\u0432\u0434\u043E\u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u043D\u0435\u0442 \u0443\u0437\u043B\u0430 \u0432 DOM, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0435\u0433\u043E \u0440\u0430\u0437\u043C\u0435\u0440 \u0438 \u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0432 \u043F\u043E\u0442\u043E\u043A\u0435 \u0438\u0437\u043C\u0435\u0440\u0438\u0442\u044C \u043D\u0435\u0447\u0435\u043C: \u0432\u044B\u0447\u0438\u0441\u043B\u0435\u043D\u043D\u044B\u0439 \u0441\u0442\u0438\u043B\u044C \u043E\u0442\u0434\u0430\u0451\u0442 \u0438\u0445 \u043A\u0430\u043A auto.`,
      hostId,
      false
    );
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
    const isVectorRoot = el.namespaceURI === SVG_NS2 && el.tagName.toLowerCase() === "svg";
    const vector = isVectorRoot ? readVector(el, size, id) : null;
    const ordered = isVectorRoot ? [] : isReversed(cs) ? [...el.children].reverse() : [...el.children];
    const childCtx = {
      ...ctx,
      ancestorMatrix: total,
      ancestorInverse: invertMatrix(total),
      parentOrigin: screenOrigin,
      insideBrokenTransform: ctx.insideBrokenTransform || brokenTransform
    };
    const pseudoBefore = buildPseudo(el, cs, "::before", box, ctx, id);
    if (pseudoBefore !== null) {
      children.push(pseudoBefore.node);
      childProbes.push(pseudoBefore.probe);
    }
    for (const child of ordered) {
      const built = buildNode(child, cs, childCtx);
      if (built === null) continue;
      children.push(built.node);
      childProbes.push(built.probe);
    }
    const pseudoAfter = buildPseudo(el, cs, "::after", box, ctx, id);
    if (pseudoAfter !== null) {
      children.push(pseudoAfter.node);
      childProbes.push(pseudoAfter.probe);
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
    if (isVectorRoot) {
      if (vector === null) {
        ctx.sink.report(
          "warning",
          DIAGNOSTIC_CODES.vectorUnreadable,
          "\u0412\u0435\u043A\u0442\u043E\u0440\u043D\u044B\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0431\u0440\u0430\u0442\u044C \u0441\u0430\u043C\u043E\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E.",
          id,
          true
        );
        node = {
          ...base,
          kind: "placeholder",
          placeholder: { code: DIAGNOSTIC_CODES.vectorUnreadable, label: "svg" }
        };
      } else {
        if (el.querySelector("foreignObject") !== null) {
          ctx.sink.report(
            "warning",
            DIAGNOSTIC_CODES.deferredForeignObject,
            "<foreignObject> \u0432\u043D\u0443\u0442\u0440\u0438 SVG: HTML \u0432\u043D\u0443\u0442\u0440\u0438 \u0432\u0435\u043A\u0442\u043E\u0440\u0430 \u043F\u0440\u0438\u0435\u0434\u0435\u0442 \u0432 Figma \u043F\u0443\u0441\u0442\u044B\u043C, \u0445\u043E\u0442\u044F \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435 \u043E\u043D \u0432\u0438\u0434\u0435\u043D.",
            id,
            false
          );
        }
        if (vector.collidingIds.length > 0) {
          ctx.sink.report(
            "warning",
            DIAGNOSTIC_CODES.vectorIdCollision,
            `\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440\u044B ${vector.collidingIds.join(", ")} \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u044E\u0442\u0441\u044F \u0432 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0435 \u0432\u044B\u0448\u0435 \u043F\u043E \u043F\u043E\u0440\u044F\u0434\u043A\u0443: \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u043B \u0441\u0441\u044B\u043B\u043A\u0438 \u0432 \u0447\u0443\u0436\u043E\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442. \u0417\u0430\u0445\u0432\u0430\u0442 \u0441\u0434\u0435\u043B\u0430\u043D \u0441\u0430\u043C\u043E\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u044B\u043C \u0438 \u0440\u0438\u0441\u0443\u0435\u0442 \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u043D\u043E\u0435 \u0432 \u044D\u0442\u043E\u0439 \u0440\u0430\u0437\u043C\u0435\u0442\u043A\u0435, \u0430 \u043D\u0435 \u0442\u043E, \u0447\u0442\u043E \u043F\u043E\u043A\u0430\u0437\u0430\u043B\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430.`,
            id,
            false
          );
        }
        node = { ...base, kind: "vector", vector: vector.source };
      }
    } else if (image.kind === "ref") {
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
      /** Считается от `<html>`, а не от `<body>`: `counter-reset` на
       *  корневом элементе — обычное дело, и начав с тела, мы потеряли
       *  бы созданный там счётчик. */
      counters: computeCounters(document.documentElement),
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
    const lifted = hoistEscaped(built.node);
    for (const move of lifted.hoisted) {
      sink.report(
        "info",
        DIAGNOSTIC_CODES.paintOrderHoisted,
        `\u0423\u0437\u0435\u043B \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0451\u043D \u043A \u043F\u0440\u0435\u0434\u043A\u0443 "${move.toId}": \u043F\u043E CSS \u0443 \u0435\u0433\u043E \u0440\u043E\u0434\u0438\u0442\u0435\u043B\u044F position \u0437\u0430\u0434\u0430\u043D, \u0430 z-index \u0440\u0430\u0432\u0435\u043D auto, \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0443\u0437\u0435\u043B \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 \u0441\u0442\u0435\u043A\u0438\u043D\u0433\u0435 \u043F\u0440\u0435\u0434\u043A\u0430 \u0438 \u043A\u0440\u0430\u0441\u0438\u0442\u0441\u044F \u043F\u043E\u0437\u0436\u0435 \u0441\u043E\u0441\u0435\u0434\u0435\u0439 \u0440\u043E\u0434\u0438\u0442\u0435\u043B\u044F. \u0412\u044B\u0440\u0430\u0437\u0438\u0442\u044C \u044D\u0442\u043E \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C\u044E \u043D\u0435\u043B\u044C\u0437\u044F \u2014 \u043D\u0438 \u0432 SVG, \u043D\u0438 \u0432 Figma, \u2014 \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C \u0438\u0435\u0440\u0430\u0440\u0445\u0438\u044F \u0441\u043B\u043E\u0451\u0432, \u0430 \u043D\u0435 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0440\u044F\u0434\u043E\u043A.`,
        move.id,
        false
      );
    }
    for (const id of lifted.blockedByTransform) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.paintOrderApproximated,
        "\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438 \u043F\u0440\u0438\u0431\u043B\u0438\u0436\u0451\u043D: \u0443\u0437\u0435\u043B \u0434\u043E\u043B\u0436\u0435\u043D \u0443\u0447\u0430\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u044C \u0432 \u0441\u0442\u0435\u043A\u0438\u043D\u0433\u0435 \u043F\u0440\u0435\u0434\u043A\u0430, \u043D\u043E \u043D\u0430 \u043F\u0443\u0442\u0438 \u043A \u043D\u0435\u043C\u0443 \u0435\u0441\u0442\u044C \u0442\u0440\u0430\u043D\u0441\u0444\u043E\u0440\u043C\u0430, \u0438 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0443\u0437\u0435\u043B \u0431\u0435\u0437 \u0438\u0441\u043A\u0430\u0436\u0435\u043D\u0438\u044F \u043A\u043E\u043E\u0440\u0434\u0438\u043D\u0430\u0442 \u043D\u0435\u043B\u044C\u0437\u044F. \u041E\u043D \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u043D\u0430 \u043C\u0435\u0441\u0442\u0435 \u2014 \u043F\u043E\u0440\u044F\u0434\u043E\u043A \u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u043B\u0438\u0447\u0430\u0442\u044C\u0441\u044F.",
        id,
        false
      );
    }
    for (const id of lifted.stillWrong) {
      sink.report(
        "warning",
        DIAGNOSTIC_CODES.paintOrderInterleaved,
        "\u041F\u043E\u0440\u044F\u0434\u043E\u043A \u043E\u0442\u0440\u0438\u0441\u043E\u0432\u043A\u0438 \u043E\u0441\u0442\u0430\u043B\u0441\u044F \u043D\u0435\u0432\u0435\u0440\u043D\u044B\u043C: \u044D\u0442\u043E\u0442 \u0443\u0437\u0435\u043B \u043E\u0431\u044F\u0437\u0430\u043D \u043A\u0440\u0430\u0441\u0438\u0442\u044C\u0441\u044F \u0438\u043D\u0430\u0447\u0435, \u0447\u0435\u043C \u0435\u0433\u043E \u043D\u0430\u0440\u0438\u0441\u0443\u0435\u0442 \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0435 \u0434\u0435\u0440\u0435\u0432\u043E, \u0430 \u043F\u0435\u0440\u0435\u043D\u0435\u0441\u0442\u0438 \u0435\u0433\u043E \u043D\u0435\u043A\u0443\u0434\u0430 \u2014 \u0432 Figma z-\u043F\u043E\u0440\u044F\u0434\u043E\u043A \u0437\u0430\u0434\u0430\u0451\u0442\u0441\u044F \u043F\u043E\u0440\u044F\u0434\u043A\u043E\u043C \u0441\u0440\u0435\u0434\u0438 \u0441\u0438\u0431\u043B\u0438\u043D\u0433\u043E\u0432, \u0438 \u0442\u0430\u043A\u043E\u0435 \u0440\u0430\u0441\u043F\u043E\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C\u044E \u043D\u0435 \u0432\u044B\u0440\u0430\u0436\u0430\u0435\u0442\u0441\u044F.",
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