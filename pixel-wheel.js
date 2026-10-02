/* A native pixel-art name wheel. The renderer never chooses a winner or changes
   the wheel state: angle zero remains the right-hand edge of the first segment. */
(function (root) {
  'use strict';

  var SIZE = 192, CX = 96, CY = 100, RADIUS = 77, TAU = Math.PI * 2;
  var COLORS = ['#8edac7', '#c8afea', '#edc27f', '#96c8ed', '#efaaba', '#b9d58c', '#98dbdf', '#e3bd9f'];
  var cache;

  function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function shade(color, amount) { return color.map(function (v) { return Math.round(v * amount); }); }
  function pixelCircle(ctx, x, y, radius, color) {
    ctx.fillStyle = color;
    for (var dy = -radius; dy <= radius; dy++) {
      var half = Math.floor(Math.sqrt(radius * radius - dy * dy));
      ctx.fillRect(x - half, y + dy, half * 2 + 1, 1);
    }
  }
  function square(ctx, x, y, size, color) { ctx.fillStyle = color; ctx.fillRect(x, y, size, size); }
  function createCache() {
    var frame = document.createElement('canvas'), disk = document.createElement('canvas');
    frame.width = disk.width = SIZE; frame.height = disk.height = SIZE;
    var fc = frame.getContext('2d'), dc = disk.getContext('2d');
    pixelCircle(fc, CX, CY + 3, 88, '#11182d');
    pixelCircle(fc, CX, CY, 88, '#11182d');
    pixelCircle(fc, CX, CY, 86, '#455179');
    pixelCircle(fc, CX, CY, 84, '#ffe2a0');
    pixelCircle(fc, CX, CY, 82, '#b68b45');
    pixelCircle(fc, CX, CY, 80, '#202b4d');
    pixelCircle(fc, CX, CY, 78, '#566183');
    // Individually placed pixel rivets make the frame read like an RPG item.
    for (var i = 0; i < 12; i++) {
      var a = i * TAU / 12, x = Math.round(CX + Math.cos(a) * 83), y = Math.round(CY + Math.sin(a) * 83);
      square(fc, x - 2, y - 2, 5, '#282640');
      square(fc, x - 1, y - 1, 3, '#e9c36f');
      square(fc, x - 1, y - 1, 1, '#fff2bb');
    }
    var pixels = [], image = dc.createImageData(SIZE, SIZE);
    for (var py = 0; py < SIZE; py++) {
      for (var px = 0; px < SIZE; px++) {
        var dx = px - CX, dy = py - CY, r = Math.sqrt(dx * dx + dy * dy);
        if (r <= RADIUS) pixels.push({ offset: (py * SIZE + px) * 4, theta: Math.atan2(dy, dx), radius: r });
      }
    }
    var palette = COLORS.map(function (color) { var c = rgb(color); return [c, shade(c, 0.85)]; });
    return { frame: frame, disk: disk, context: dc, image: image, pixels: pixels, palette: palette, lastKey: '' };
  }
  function paintDisk(c, count, angle) {
    var key = count + ':' + angle;
    if (key === c.lastKey) return;
    c.lastKey = key;
    var step = count ? TAU / count : TAU, data = c.image.data;
    for (var p = 0; p < c.pixels.length; p++) {
      var cell = c.pixels[p], delta = ((cell.theta - angle) % TAU + TAU) % TAU;
      var segment = Math.floor(delta / step), paletteIndex = segment % COLORS.length;
      if (count > 1 && segment === count - 1 && paletteIndex === 0) paletteIndex = 3;
      var edge = Math.min(delta % step, step - delta % step) * cell.radius;
      var color = !count ? [30, 43, 71]
        : count > 1 && edge < 0.55 ? [62, 67, 95]
          : c.palette[paletteIndex][cell.radius > RADIUS - 3 ? 1 : 0];
      var o = cell.offset;
      data[o] = color[0]; data[o + 1] = color[1]; data[o + 2] = color[2]; data[o + 3] = 255;
    }
    c.context.putImageData(c.image, 0, 0);
  }
  function clip(ctx, value, width) {
    var chars = Array.from(String(value));
    if (ctx.measureText(chars.join('')).width <= width) return chars.join('');
    while (chars.length && ctx.measureText(chars.join('') + '…').width > width) chars.pop();
    return chars.join('') + '…';
  }
  function ornaments(ctx, scale, showHub) {
    ctx.save(); ctx.scale(scale, scale);
    // A square-stepped gold hub, with a mint crystal in the centre.
    if (showHub) {
      pixelCircle(ctx, CX, CY + 1, 11, '#17213b');
      pixelCircle(ctx, CX, CY, 10, '#ffe2a0');
      pixelCircle(ctx, CX, CY, 8, '#ba8c45');
      pixelCircle(ctx, CX, CY, 6, '#273755');
      square(ctx, CX - 2, CY - 4, 5, '#8ee5d4');
      square(ctx, CX - 4, CY - 2, 9, '#8ee5d4');
      square(ctx, CX - 2, CY, 5, '#56a9b0');
      square(ctx, CX - 2, CY - 2, 2, '#edfff0');
    }
    // The selector is fixed at exactly 12 o'clock, as wheelLandingAngle expects.
    ctx.fillStyle = '#151d34';
    ctx.fillRect(CX - 10, 7, 21, 8);
    for (var y = 15; y <= 30; y += 2) {
      var half = 10 - (y - 15) / 2;
      ctx.fillRect(CX - half, y, half * 2 + 1, 2);
    }
    ctx.fillStyle = '#ffe39a'; ctx.fillRect(CX - 7, 10, 15, 5);
    for (var sy = 15; sy <= 26; sy += 2) {
      var sh = 7 - (sy - 15) / 2;
      ctx.fillStyle = sy < 20 ? '#f6c766' : '#de9850';
      ctx.fillRect(CX - sh, sy, sh * 2 + 1, 2);
    }
    ctx.fillStyle = '#fff2bf'; ctx.fillRect(CX - 5, 11, 11, 2);
    ctx.restore();
  }
  function draw(canvas, options) {
    if (!canvas || !canvas.width || !canvas.height) return;
    options = options || {};
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!cache) cache = createCache();
    var names = Array.isArray(options.names) ? options.names : [], count = names.length;
    var angle = Number.isFinite(options.angle) ? options.angle : 0;
    var side = Math.min(canvas.width, canvas.height), scale = side / SIZE;
    var x = (canvas.width - side) / 2, y = (canvas.height - side) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    paintDisk(cache, count, angle);
    ctx.drawImage(cache.frame, x, y, side, side);
    ctx.drawImage(cache.disk, x, y, side, side);
    ctx.save(); ctx.translate(x, y);
    var dpr = canvas.width / (parseFloat(canvas.style.width) || canvas.width);
    var cx = CX * scale, cy = CY * scale, radius = RADIUS * scale;
    ctx.textBaseline = 'middle';
    if (count) {
      var step = TAU / count;
      var fontSize = Math.max(7 * dpr, Math.min(24 * dpr, radius * 0.125, radius * step * 0.37));
      var fontFamily = 'px ui-monospace, "Cascadia Mono", "Segoe UI", monospace';
      ctx.font = '700 ' + fontSize + fontFamily;
      ctx.fillStyle = '#19233d';
      for (var i = 0; i < count; i++) {
        var mid = angle + (i + 0.5) * step;
        var normalized = ((mid % TAU) + TAU) % TAU;
        var leftSide = normalized > Math.PI / 2 && normalized < Math.PI * 1.5;
        ctx.save();
        var maxWidth = radius * (count === 1 ? 1.4 : 0.63);
        var measured = ctx.measureText(String(names[i])).width;
        if (measured > maxWidth) ctx.font = '700 ' + fontSize * Math.max(0.74, maxWidth / measured) + fontFamily;
        if (count === 1) {
          ctx.translate(cx, cy - radius * 0.28);
          ctx.textAlign = 'center';
        } else {
          ctx.translate(cx + Math.cos(mid) * radius * 0.87, cy + Math.sin(mid) * radius * 0.87);
          ctx.rotate(mid + (leftSide ? Math.PI : 0));
          ctx.textAlign = leftSide ? 'left' : 'right';
        }
        ctx.fillText(clip(ctx, names[i], maxWidth), 0, 0);
        ctx.restore();
      }
    } else {
      ctx.textAlign = 'center'; ctx.fillStyle = '#ffe1a0';
      ctx.font = '700 ' + Math.max(12 * dpr, radius * 0.12) + 'px ui-monospace, monospace';
      var hasRoster = Number(options.totalNames) > 0;
      var round = Number(options.round) || 1;
      ctx.fillText(hasRoster ? 'Round ' + round + ' complete' : 'Your party awaits', cx, cy - radius * 0.08);
      ctx.fillStyle = '#b9cde0';
      ctx.font = '600 ' + Math.max(9 * dpr, radius * 0.075) + 'px ui-monospace, monospace';
      ctx.fillText(hasRoster ? 'Spin to start round ' + (round + 1) : 'Add student names below', cx, cy + radius * 0.11);
    }
    ornaments(ctx, scale, !!count);
    ctx.restore();
    canvas.dataset.pixelWheel = 'ready';
    canvas.setAttribute('aria-label', count ? 'Name wheel with ' + count + (count === 1 ? ' student' : ' students') + '. Activate to spin.'
      : Number(options.totalNames) > 0 ? 'Round complete. Activate to start the next round.' : 'Name wheel. Add student names to begin.');
  }
  root.PixelWheel = Object.freeze({ draw: draw });
})(window);
