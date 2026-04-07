// Global series/category color mappings for TGA
(function () {
  if (typeof window === 'undefined') return;

  window.TGA_CATEGORY_COLORS = {
    openwheel: '#6b9fd4',
    stockcar:  '#c47a3a',
    endurance: '#4a9e6b',
    touring:   '#8b68b8'
  };

  window.TGA_SERIES_COLORS = {
    F1:            '#e10600',
    INDYCAR:       '#ff8700',
    SUPER_FORMULA: '#1e88e5',
    F2:            '#00a19b',
    F3:            '#0071c2',
    FREC:          '#5b8def',
    F4_IT:         '#40c463',
    SMP_F4_RU:     '#6f42c1',

    NASCAR_CUP:    '#ffb400',
    NOAPS:         '#ff6b6b',
    NASCAR_TRUCK:  '#ff922b',
    ARCA:          '#ffa94d',
    NASCAR_MODIFIED:'#fd7e14',

    WEC:           '#2f9e44',
    ELMS:          '#0ca678',
    IMSA:          '#20c997',

    GTWCE_END:     '#845ef7',
    GTWCE_SPRINT:  '#7950f2',
    PSC:           '#adb5bd',
    DTM:           '#e8590c',
    SUPER_GT:      '#f783ac',
    SUPERCARS:     '#ff4d6d'
  };

  window.TGA_SERIES_SHORT = {
    'F1': 'F1', 'INDYCAR': 'IndyCar', 'SUPER_FORMULA': 'Super Formula', 'F2': 'F2', 'F3': 'F3',
    'FREC': 'F Regional', 'F4_IT': 'F4', 'SMP_F4_RU': 'F4 RU',
    'NASCAR_CUP': 'Cup', 'NOAPS': 'NOAPS', 'NASCAR_TRUCK': 'Trucks',
    'ARCA': 'ARCA', 'NASCAR_MODIFIED': 'Modified',
    'WEC': 'WEC', 'ELMS': 'ELMS', 'IMSA': 'IMSA',
    'GTWCE_END': 'GT WC End', 'GTWCE_SPRINT': 'GT WC', 'PSC': 'PSC',
    'DTM': 'DTM', 'SUPER_GT': 'Super GT', 'SUPERCARS': 'Supercars'
  };
})();

