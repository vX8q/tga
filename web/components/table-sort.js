// Table sorting helpers — registered on window.TGA and kept as globals for backward compat.
window.TGA = window.TGA || {};
function makeTableSortable(tableEl, rows, escapeFn, getRowClass) {
  if (!tableEl || !rows || rows.length === 0) return;
  var thead = tableEl.querySelector('thead');
  var tbody = tableEl.querySelector('tbody');
  if (!thead || !tbody) return;
  var headerRows = thead.querySelectorAll('tr');
  var headerRow = headerRows.length > 1 ? headerRows[headerRows.length - 1] : headerRows[0];
  var ths = headerRow.querySelectorAll('th');
  // Cell can be a plain value (escaped) or { html: true, value: '...', text?: '...' } for pre-built safe HTML.
  // text is used for sorting when present; otherwise tags are stripped from value.
  function getCellHtml(cell) {
    if (cell != null && typeof cell === 'object' && cell.html === true && typeof cell.value === 'string') {
      return cell.value;
    }
    return escapeFn(cell);
  }
  function getSortValue(cell) {
    if (cell == null) return '';
    if (typeof cell === 'object' && cell.html === true) {
      if (cell.text != null && typeof cell.text === 'string') return cell.text.trim();
      return (cell.value || '').replace(/<[^>]+>/g, '').trim();
    }
    return String(cell).trim();
  }
  var rowsCopy = rows.map(function (r) { return r.slice(); });
  function renderBody(arr) {
    var isQualMerged = tableEl.classList.contains('qual-merged-table');
    tbody.innerHTML = arr.map(function (row) {
      var cls = getRowClass ? getRowClass(row) : '';
      var cellsHtml = row.map(function (cell, ci) {
        var c = getCellHtml(cell);
        var cellCls = '';
        if (isQualMerged) {
          if (cell == null || String(cell).trim() === '—') cellCls = 'qual-so-empty';
          else if (ci === 8) cellCls = 'qual-so-pos';
        }
        return '<td' + (cellCls ? ' class=\"' + cellCls + '\"' : '') + '>' + c + '</td>';
      }).join('');
      return '<tr' + (cls ? ' class=\"' + cls + '\"' : '') + '>' + cellsHtml + '</tr>';
    }).join('');
  }
  function isNumeric(val) {
    if (val == null || val === '') return false;
    var s = String(val).trim();
    if (/^-?\d+\.?\d*$/.test(s)) return true;
    if (/^\d{1,2}:\d{2}\.\d+$/.test(s)) return true;
    return false;
  }
  function parseNum(val) {
    if (val == null || val === '') return 0;
    var s = String(val).trim().replace(',', '.');
    var m = s.match(/^(\d{1,2}):(\d{2})\.(\d+)$/);
    if (m) return parseInt(m[1], 10) * 60 + parseFloat(m[2] + '.' + m[3]);
    return parseFloat(s) || 0;
  }
  renderBody(rowsCopy);
  for (var c = 0; c < ths.length; c++) {
    (function (colIndex) {
      var dir = 1;
      ths[colIndex].classList.add('sortable');
      ths[colIndex].addEventListener('click', function () {
        // Колонка числовая, если все непустые значения — числа (пустые/"—" допустимы)
        var hasAnyNumeric = rowsCopy.some(function (row) { return colIndex < row.length && isNumeric(getSortValue(row[colIndex])); });
        var numeric = hasAnyNumeric && rowsCopy.every(function (row) {
          var v = colIndex < row.length ? getSortValue(row[colIndex]) : '';
          return v === '' || v === '—' || isNumeric(v);
        });
        rowsCopy.sort(function (a, b) {
          var va = colIndex < a.length ? a[colIndex] : '';
          var vb = colIndex < b.length ? b[colIndex] : '';
          var sa = getSortValue(va);
          var sb = getSortValue(vb);
          if (numeric) {
            var emptyA = (sa === '' || sa === '—');
            var emptyB = (sb === '' || sb === '—');
            if (emptyA && emptyB) return 0;
            if (emptyA) return dir;
            if (emptyB) return -dir;
            return dir * (parseNum(sa) - parseNum(sb));
          }
          return dir * sa.localeCompare(sb, undefined, { numeric: true });
        });
        [].forEach.call(ths, function (th) { th.classList.remove('sort-asc', 'sort-desc'); });
        ths[colIndex].classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
        dir = -dir;
        renderBody(rowsCopy);
      });
    })(c);
  }
}

// Простой сортировщик для уже готовых таблиц (используем для расписаний / Full Schedule)
function makeSimpleTableSortable(tableEl) {
  if (!tableEl || tableEl._simpleSortable) return;
  var thead = tableEl.querySelector('thead');
  var tbody = tableEl.querySelector('tbody');
  if (!thead || !tbody) return;
  // Full Schedule использует группирующие строки weekend-hdr; сортировка ломает их.
  // Для таблиц с такими строками сортировку не включаем.
  if (tableEl.classList.contains('sched-compact') &&
      tbody.querySelector('.weekend-hdr')) {
    return;
  }
  tableEl._simpleSortable = true;
  var ths = thead.querySelectorAll('th');

  function getCellText(row, colIndex) {
    var cell = row.cells[colIndex];
    return cell ? cell.textContent.trim() : '';
  }

  [].forEach.call(ths, function (th, colIndex) {
    var dir = 1;
    th.classList.add('sortable');
    th.addEventListener('click', function () {
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function (a, b) {
        var ta = getCellText(a, colIndex);
        var tb = getCellText(b, colIndex);
        var na = parseFloat(ta.replace(/[^\d.-]/g, ''));
        var nb = parseFloat(tb.replace(/[^\d.-]/g, ''));
        var aNum = !isNaN(na) && ta !== '';
        var bNum = !isNaN(nb) && tb !== '';
        // Числовая сортировка: все числовые значения идут перед пустыми/прочерками
        // независимо от направления сортировки.
        if (aNum && bNum) return dir * (na - nb);
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return 1;
        return dir * ta.localeCompare(tb, undefined, { numeric: true });
      });
      rows.forEach(function (row) { tbody.appendChild(row); });
      [].forEach.call(ths, function (th2) { th2.classList.remove('sort-asc', 'sort-desc'); });
      th.classList.add(dir === 1 ? 'sort-asc' : 'sort-desc');
      dir = -dir;
    });
  });
}

window.TGA.makeTableSortable = makeTableSortable;
window.TGA.makeSimpleTableSortable = makeSimpleTableSortable;

