// Mirrors the apex.* tokens in tailwind.config.js / --apex-* in index.css.
// Plain hex (not CSS vars) so callers can do `${C.green}18` alpha-suffix tricks.
export const APEX_COLORS = {
  bg:      '#EEF1F6',
  surface: '#FFFFFF',
  card:    '#F8F9FC',
  border:  '#DCDFE6',
  accent:  '#0E6B4F',
  gold:    '#C9A24B',
  text:    '#14171F',
  muted:   '#5B6472',
  green:   '#12805F',
  red:     '#B0263B',
  yellow:  '#C9A24B',
};
