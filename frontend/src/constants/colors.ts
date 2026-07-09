// Mirrors the apex.* tokens in tailwind.config.js / --apex-* in index.css.
// Plain hex (not CSS vars) so callers can do `${C.green}18` alpha-suffix tricks.
export const APEX_COLORS = {
  bg:      '#FAF6F1',
  surface: '#FFFFFF',
  card:    '#FFF8F2',
  border:  '#E8D5C4',
  accent:  '#FF8C42',
  text:    '#2C1810',
  muted:   '#8B6F47',
  green:   '#2D8A4A',
  red:     '#DC2626',
  yellow:  '#F5A623',
};
