// Series list page: uses window.TGA (t, esc, categories, countryHtml, loadGlobalSchedule) at call time.
(function () {
  if (typeof window === 'undefined') return;
  window.TGA = window.TGA || {};

  function renderList(container) {
    var t = window.TGA.t;
    var esc = window.TGA.esc;
    var categories = window.TGA.categories;
    var countryHtml = window.TGA.countryHtml;
    var loadGlobalSchedule = window.TGA.loadGlobalSchedule;
    if (!t || !esc || !categories || !loadGlobalSchedule) return;

    if (container._listLoaded) return;
    container.textContent = '';
    var loadingP = document.createElement('p');
    loadingP.className = 'loading';
    loadingP.textContent = t('loading');
    container.appendChild(loadingP);

    var fetchJSON = window.TGA && window.TGA.fetchJSON;
    if (!fetchJSON) fetchJSON = function (url) { return fetch(url).then(function (r) { return r.json(); }); };

    var maxAttempts = 10;
    var retryDelayMs = 1000;

    function loadSeries(attempt) {
      fetchJSON('/api/series')
      .then(function (data) {
        if (!Array.isArray(data) || data.length === 0) {
          if (attempt + 1 < maxAttempts) {
            setTimeout(function () { loadSeries(attempt + 1); }, retryDelayMs);
            return;
          }
          container.textContent = '';
          var noSeriesP = document.createElement('p');
          noSeriesP.className = 'loading';
          noSeriesP.textContent = t('error.no_series');
          container.appendChild(noSeriesP);
          return;
        }

        var byId = {};
        data.forEach(function (s) {
          byId[s.id] = s;
        });
        if (!byId['NOAPS'] && byId['NASCAR_XFINITY']) {
          byId['NOAPS'] = Object.assign({}, byId['NASCAR_XFINITY'], { id: 'NOAPS' });
        }

        function card(s) {
          var country = s.id === 'PSC' ? 'Europe' : s.country;
          var slug = (s.id || '').toLowerCase().replace(/_+/g, '-');
          return (
            '<a href="/series/' + encodeURIComponent(slug) + '" class="series-card">' +
              '<h3>' + esc(s.name) + '</h3>' +
              '<div class="meta">' + esc(s.season) + ' · ' + (countryHtml ? countryHtml(country) : esc(country || '')) + '</div>' +
            '</a>'
          );
        }

        var html = '';
        categories.forEach(function (cat, idx) {
          var series = cat.ids.map(function (id) { return byId[id]; }).filter(Boolean);
          if (series.length === 0) return;

          var cardsHtml = series.map(card).join('');
          var idAttr = 'category-' + cat.key;

          html +=
            '<div class="category-block" data-category="' + esc(cat.key) + '">' +
              '<button type="button" class="category-btn" aria-expanded="false" aria-controls="' + idAttr + '" id="btn-' + idAttr + '">' +
                '<span class="category-btn-title">' + esc(t('cat.' + cat.key)) + '</span>' +
                '<span class="category-btn-icon" aria-hidden="true"></span>' +
              '</button>' +
              '<div class="category-content" id="' + idAttr + '" role="region" aria-labelledby="btn-' + idAttr + '">' +
                '<div class="series-grid">' + cardsHtml + '</div>' +
              '</div>' +
            '</div>';
        });

        container.innerHTML = html;
        container._listLoaded = true;
        loadGlobalSchedule(data);

        var oldHandler = container._categoryClick;
        if (oldHandler) container.removeEventListener('click', oldHandler);
        container._categoryClick = function (e) {
          var btn = e.target && e.target.closest && e.target.closest('.category-btn');
          if (!btn || !btn.closest) return;
          var block = btn.closest('.category-block');
          if (!block) return;
          var content = block.querySelector('.category-content');
          if (!content) return;
          var willExpand = !block.classList.contains('expanded');

          if (willExpand) {
            block.classList.add('expanded');
            btn.setAttribute('aria-expanded', 'true');
            content.style.height = content.scrollHeight + 'px';
            var onEnd = function () {
              content.removeEventListener('transitionend', onEnd);
              if (block.classList.contains('expanded')) content.style.height = 'auto';
            };
            content.addEventListener('transitionend', onEnd);
          } else {
            content.style.height = content.getBoundingClientRect().height + 'px';
            content.getBoundingClientRect();
            content.style.height = '0';
            block.classList.remove('expanded');
            btn.setAttribute('aria-expanded', 'false');
          }

          btn.blur();
        };
        container.addEventListener('click', container._categoryClick);
      })
      .catch(function () {
        if (attempt + 1 < maxAttempts) {
          setTimeout(function () { loadSeries(attempt + 1); }, retryDelayMs);
        } else {
          container.textContent = '';
          var errP = document.createElement('p');
          errP.className = 'loading';
          errP.textContent = t('error.load_series') || 'Error loading series.';
          container.appendChild(errP);
        }
      });
    }

    loadSeries(0);
  }

  window.TGA.renderList = renderList;
})();
