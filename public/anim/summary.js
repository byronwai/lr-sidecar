const bandNames = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
const initials = ['R', 'O', 'Y', 'G', 'A', 'B', 'P', 'M'];
export const calibrationLabels = {
  ShadowTint: 'Shadows Tint', RedHue: 'Red Primary Hue', RedSaturation: 'Red Primary Saturation',
  GreenHue: 'Green Primary Hue', GreenSaturation: 'Green Primary Saturation',
  BlueHue: 'Blue Primary Hue', BlueSaturation: 'Blue Primary Saturation'
};
const number = (value, digits = 2) => Number(value).toLocaleString('en-US', {
  useGrouping: false, maximumFractionDigits: digits
}).replace(/^-/, '−');
const signed = (value, digits = 2) => `${Number(value) > 0 ? '+' : ''}${number(value, digits)}`;
function amounts(settings, names, local = false) {
  return names.flatMap(name => {
    const value = Number(settings[(local ? 'Local' : '') + name] || 0);
    return value ? [`${name.replace('2012', '')} ${signed(value)}`] : [];
  });
}

export function globalSummary(g) {
  const lines = [], identity = [];
  if (g.CameraProfile) identity.push(g.CameraProfile);
  if (g.ProcessVersion) identity.push(`PV ${g.ProcessVersion}`);
  if (g.Temperature) identity.push(`WB ${g.Temperature}K${Number(g.Tint) ? ` / ${signed(g.Tint)}` : ''}`);
  if (identity.length) lines.push(identity.join(' · '));
  const basic = amounts(g, ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012']);
  if (basic.length) lines.push(basic.join(' · '));
  const calibration = Object.entries(calibrationLabels).filter(([key]) => Number(g[key]))
    .map(([key,label]) => `${label} ${signed(g[key])}`);
  if (calibration.length) lines.push(calibration.join(' · '));
  const presence = amounts(g, ['Texture', 'Clarity2012', 'Dehaze', 'Vibrance', 'Saturation']);
  if (g.HasCrop) {
    presence.push(`crop ${number(100 * ((g.CropRight ?? 1) - (g.CropLeft ?? 0)), 1)}%`);
    if (Number(g.CropAngle)) presence.push(`straighten ${number(g.CropAngle)}°`);
  }
  if (presence.length) lines.push(presence.join(' · '));
  for (const [field, label] of [['Hue', 'hue'], ['Saturation', 'sat'], ['Luminance', 'lum']]) {
    const changes = bandNames.flatMap((band, i) => {
      const value = Number(g[`${field}Adjustment${band}`] || 0);
      return value ? [`${initials[i]}${signed(value)}`] : [];
    });
    if (changes.length) lines.push(`HSL ${label}: ${changes.join(' ')}`);
  }
  const grades = [];
  for (const [name, hue, sat, light] of [
    ['shadows', 'SplitToningShadowHue', 'SplitToningShadowSaturation', 'ColorGradeShadowLum'],
    ['midtones', 'ColorGradeMidtoneHue', 'ColorGradeMidtoneSat', 'ColorGradeMidtoneLum'],
    ['highlights', 'SplitToningHighlightHue', 'SplitToningHighlightSaturation', 'ColorGradeHighlightLum'],
    ['global', 'ColorGradeGlobalHue', 'ColorGradeGlobalSat', 'ColorGradeGlobalLum']
  ]) {
    if (Number(g[sat]) || Number(g[light])) {
      grades.push(`${name}${Number(g[sat]) ? ` ${number(g[hue] || 0, 0)}° / ${number(g[sat])}` : ''}${Number(g[light]) ? ` lum ${signed(g[light])}` : ''}`);
    }
  }
  if (grades.length) {
    if (Number(g.SplitToningBalance)) grades.push(`balance ${signed(g.SplitToningBalance)}`);
    if (Number(g.ColorGradeBlending)) grades.push(`blend ${number(g.ColorGradeBlending)}`);
    lines.push(`Split / grade: ${grades.join(' · ')}`);
  }
  const curves = ['ToneCurvePV2012', 'ToneCurvePV2012Red', 'ToneCurvePV2012Green', 'ToneCurvePV2012Blue']
    .filter(key => g[key]?.some(point => { const [x, y] = String(point).split(/[,\s]+/).map(Number); return x !== y; }));
  if (curves.length) lines.push(`Curves: ${curves.map(key => `${key.replace('ToneCurvePV2012', '') || 'RGB'} ${g[key].length} pts`).join(' · ')}`);
  return lines;
}

export function maskExpression(masks, nameFor) {
  return masks.map((mask, index) => {
    const operation = Number(mask.MaskBlendMode);
    const operator = operation === 1 ? ' − ' : operation === 2 ? ' ∩ ' : ' ∪ ';
    const name = `${mask.MaskInverted === true ? '¬' : ''}${nameFor(mask)}`;
    if (index) return operator + name;
    return (operation === 1 ? 'full − ' : operation === 2 ? 'full ∩ ' : '') + name;
  }).join('');
}

export function correctionSummary(c) {
  const masks = c.masks.filter(m => m.MaskActive !== false);
  const expression = maskExpression(masks, m => ({
    'Mask/Image': m.MaskName || 'AI', 'Mask/Gradient': 'linear', 'Mask/CircularGradient': 'radial',
    'Mask/Paint': 'paint', 'Mask/RangeMask': Number(m.CorrectionRangeMask?.Type) === 2 ? 'luma range' : 'colour range'
  }[m.What] || m.What));
  const edits = amounts(c, ['Exposure2012', 'Contrast2012', 'Highlights2012', 'Shadows2012', 'Whites2012', 'Blacks2012',
    'Saturation', 'Temperature', 'Tint', 'Texture', 'Clarity2012', 'Dehaze', 'Glow'], true);
  if (Number(c.LocalToningSaturation)) edits.push(`Toning ${number(c.LocalToningHue || 0)}° / ${signed(c.LocalToningSaturation)}`);
  for (const name of ['MainCurve', 'RedCurve', 'GreenCurve', 'BlueCurve']) {
    if (c[name]) edits.push(`${name.replace('Main', 'RGB').replace('Curve', '')} curve ${c[name].length} pts`);
  }
  const name = `${c.name}${c.CorrectionActive === false ? ' (inactive)' : ''}`;
  return `${name}: ${expression || 'empty'} → ${edits.join(' · ') || 'no nonzero adjustments'}`;
}
